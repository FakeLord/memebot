-- MemeBot — ilk şema
-- Roller: founder (her şey + kullanıcı yönetimi), developer (işlem + teşhis), assistant (izleme)
-- Güvenlik: tüm tablolarda RLS açık. Açık kayıt kapalı; yeni profil varsayılan olarak PASİF.

create type public.app_role as enum ('founder', 'developer', 'assistant');
create type public.trade_mode as enum ('watch', 'manual', 'auto');
create type public.order_side as enum ('buy', 'sell');
create type public.order_status as enum ('created', 'submitted', 'pending', 'processed', 'confirmed', 'failed', 'expired');
create type public.safety_result as enum ('pass', 'warn', 'fail');

-- ---------------------------------------------------------------- profiller
create table public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  username    text not null unique,
  role        public.app_role not null default 'assistant',
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Supabase'de bir kullanıcı oluşunca profili PASİF açılır; founder aktifleştirir.
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, username)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'username', split_part(new.email, '@', 1)));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Aktif kullanıcının rolü; pasif ya da profilsizse NULL döner → hiçbir politikadan geçemez.
create function public.my_role() returns public.app_role
language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid() and is_active
$$;

create function public.is_founder() returns boolean
language sql stable as $$ select coalesce(public.my_role() = 'founder', false) $$;

create function public.can_trade() returns boolean
language sql stable as $$ select coalesce(public.my_role() in ('founder', 'developer'), false) $$;

alter table public.profiles enable row level security;
create policy "profil: kendi satırı veya founder" on public.profiles
  for select using (id = auth.uid() or public.is_founder());
create policy "profil: sadece founder günceller" on public.profiles
  for update using (public.is_founder()) with check (public.is_founder());

-- ---------------------------------------------------------------- global ayarlar
create table public.app_settings (
  key         text primary key,
  value       jsonb not null,
  updated_by  uuid references public.profiles (id),
  updated_at  timestamptz not null default now()
);
alter table public.app_settings enable row level security;
create policy "ayar: aktif herkes okur" on public.app_settings
  for select using (public.my_role() is not null);
create policy "ayar: founder yazar" on public.app_settings
  for all using (public.is_founder()) with check (public.is_founder());

insert into public.app_settings (key, value) values
  ('kill_switch', 'false'::jsonb),
  ('min_app_version', '"0.1.0"'::jsonb);

-- ---------------------------------------------------------------- sinyal kaynakları
create table public.sources (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  type        text not null default 'telegram' check (type in ('telegram', 'x')),
  chat_id     text not null,
  title       text not null,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (user_id, type, chat_id)
);

-- ---------------------------------------------------------------- sinyaller
create table public.signals (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  source_id    uuid references public.sources (id) on delete set null,
  mint         text not null,
  raw_text     text,
  msg_ts       timestamptz,
  received_at  timestamptz not null default now()
);
create index signals_user_received_idx on public.signals (user_id, received_at desc);

-- Dedupe: aynı mint aynı kullanıcı için tek kayıt, tekrar gelirse sayaç artar.
create table public.signal_hits (
  user_id        uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  mint           text not null,
  first_seen_at  timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  hit_count      integer not null default 1,
  primary key (user_id, mint)
);

-- ---------------------------------------------------------------- güvenlik kontrolleri (ortak önbellek)
create table public.safety_checks (
  id          uuid primary key default gen_random_uuid(),
  mint        text not null,
  result      public.safety_result not null,
  reasons     jsonb not null default '[]'::jsonb,
  raw         jsonb,
  checked_by  uuid references public.profiles (id) default auth.uid(),
  checked_at  timestamptz not null default now()
);
create index safety_checks_mint_idx on public.safety_checks (mint, checked_at desc);

-- ---------------------------------------------------------------- kurallar
create table public.rules (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  name            text not null default 'Varsayılan',
  mode            public.trade_mode not null default 'manual',
  thresholds      jsonb not null default '{}'::jsonb,
  limits          jsonb not null default '{}'::jsonb,
  tp_sl_template  jsonb not null default '[]'::jsonb,
  is_active       boolean not null default true,
  updated_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------- emirler
create table public.orders (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  idempotency_key  text not null unique,
  side             public.order_side not null,
  mint             text not null,
  wallet           text not null,
  amount_in        text not null,          -- en küçük birim (lamport / token raw)
  status           public.order_status not null default 'created',
  is_dry_run       boolean not null default true,
  gmgn_order_id    text,
  tx_hash          text,
  error_code       text,
  request          jsonb,
  report           jsonb,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index orders_user_created_idx on public.orders (user_id, created_at desc);

-- ---------------------------------------------------------------- pozisyonlar
create table public.positions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  mint         text not null,
  wallet       text not null,
  entry_price  numeric,
  amount_raw   text,
  status       text not null default 'open' check (status in ('open', 'closed')),
  is_dry_run   boolean not null default true,
  pnl_usd      numeric,
  opened_at    timestamptz not null default now(),
  closed_at    timestamptz
);

-- ---------------------------------------------------------------- motor kilidi
-- Aynı kullanıcı iki bilgisayarda açıksa sadece biri işlem motorunu çalıştırır.
create table public.engine_leases (
  user_id       uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  machine_id    text not null,
  heartbeat_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- denetim kaydı
create table public.audit_log (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.profiles (id) on delete set null default auth.uid(),
  action      text not null,
  detail      jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- RLS
alter table public.sources        enable row level security;
alter table public.signals        enable row level security;
alter table public.signal_hits    enable row level security;
alter table public.safety_checks  enable row level security;
alter table public.rules          enable row level security;
alter table public.orders         enable row level security;
alter table public.positions      enable row level security;
alter table public.engine_leases  enable row level security;
alter table public.audit_log      enable row level security;

-- Kendi verisini okur; founder herkesinkini okur.
create policy "okuma" on public.sources     for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.signals     for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.signal_hits for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.rules       for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.orders      for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.positions   for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.audit_log   for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "okuma" on public.engine_leases for select using (user_id = auth.uid() and public.my_role() is not null);

-- Sinyal izleme: tüm aktif roller kendi kaynak/sinyallerini yazabilir.
create policy "yazma" on public.sources     for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.signals     for insert with check (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.signal_hits for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.engine_leases for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.audit_log   for insert with check (user_id = auth.uid() and public.my_role() is not null);

-- İşlemle ilgili tablolar: sadece founder ve developer yazar. Assistant izler.
create policy "yazma" on public.rules     for all using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());
create policy "yazma" on public.orders    for all using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());
create policy "yazma" on public.positions for all using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());

-- Güvenlik kontrolleri ortak önbellek: aktif herkes okur ve ekler.
create policy "okuma" on public.safety_checks for select using (public.my_role() is not null);
create policy "yazma" on public.safety_checks for insert with check (public.my_role() is not null);

-- Canlı akış için realtime yayını
alter publication supabase_realtime add table public.signals, public.signal_hits, public.orders, public.positions, public.app_settings;
