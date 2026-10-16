-- v2 Faz 2: MemeBot Engine
-- İş yapan mantık (GMGN, Telegram, X, karar ve emir motoru, takip) tek bir sunucu sürecine taşındı.
-- Arayüz sadece niyet yazar (emir, komut); motor service_role ile çalıştırır ve sonucu yazar.

-- ---------------------------------------------------------------- emir durumu
-- 'sending': motor emri üstlendi, GMGN'e gönderiyor. Motor bu durumda durursa emir başarısız sayılır
-- (otomatik tekrar YOK). Yeni değer bu dosyada kullanılmaz (aynı işlemde kullanılamaz).
alter type public.order_status add value if not exists 'sending' after 'created';

-- Cüzdanı motor doldurur (işlem cüzdanı motorda saklanır)
alter table public.orders alter column wallet drop not null;

-- Arayüz emri sadece "created" olarak ekleyebilir; sonrasını yalnızca motor günceller.
drop policy "yazma" on public.orders;
create policy "ekleme" on public.orders
  for insert with check (
    user_id = auth.uid() and public.can_trade()
    and status = 'created' and gmgn_order_id is null and tx_hash is null and report is null and error_code is null
  );

-- Pozisyonları yalnızca motor açar/kapatır.
drop policy "yazma" on public.positions;

-- Canlı fiyat (motor 15 sn'de bir yazar)
alter table public.positions
  add column last_price_usd numeric,
  add column price_at timestamptz;

-- Motorun işlediği sinyaller (motor kapalıyken gelenler açılışta işlenir)
alter table public.signals add column processed_at timestamptz;
create index signals_unprocessed_idx on public.signals (received_at) where processed_at is null;

-- ---------------------------------------------------------------- motor durumu (tek satır)
create table public.engine_status (
  id               text primary key default 'main',
  instance_id      text not null,
  version          text,
  host             text,
  started_at       timestamptz,
  heartbeat_at     timestamptz not null default now(),
  public_key       jsonb,          -- mühürlü zarf için RSA-OAEP açık anahtarı (JWK)
  gmgn_latency_ms  integer
);
alter table public.engine_status enable row level security;
create policy "okuma" on public.engine_status for select using (public.my_role() is not null);

-- Tek motor kuralı: kayıt yoksa ya da mevcut motor 'p_ttl_sec' saniyedir sessizse devralır.
create function public.engine_claim(p_instance text, p_ttl_sec integer default 30) returns boolean
language sql security definer set search_path = public as $$
  with up as (
    insert into public.engine_status as s (id, instance_id, heartbeat_at)
    values ('main', p_instance, now())
    on conflict (id) do update
      set instance_id = excluded.instance_id, heartbeat_at = now()
      where s.instance_id = p_instance or s.heartbeat_at < now() - make_interval(secs => p_ttl_sec)
    returning 1
  ) select exists (select 1 from up)
$$;
revoke execute on function public.engine_claim(text, integer) from public, anon, authenticated;
grant execute on function public.engine_claim(text, integer) to service_role;

-- ---------------------------------------------------------------- kullanıcı başına motor durumu
create table public.engine_user_state (
  user_id     uuid primary key references public.profiles (id) on delete cascade,
  gmgn        jsonb not null default '{}'::jsonb,   -- { configured, plan, wallet }
  telegram    jsonb not null default '{}'::jsonb,   -- bağlantı durumu
  x           jsonb not null default '{}'::jsonb,   -- XFlux yoklama durumu, izleyiciler
  pipeline    jsonb not null default '{}'::jsonb,   -- karar motoru durumu, son hata
  notice      text,                                  -- otomatik mod bildirimi
  updated_at  timestamptz not null default now()
);
alter table public.engine_user_state enable row level security;
create policy "okuma" on public.engine_user_state
  for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));

-- ---------------------------------------------------------------- komutlar
create type public.command_status as enum ('pending', 'running', 'done', 'failed');

create table public.engine_commands (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  kind         text not null check (kind ~ '^[a-z]+(\.[a-z_]+)+$'),
  payload      jsonb,                 -- şifreli alanlar motor açtıktan sonra silinir
  status       public.command_status not null default 'pending',
  result       jsonb,
  error        text,
  created_at   timestamptz not null default now(),
  finished_at  timestamptz
);
create index engine_commands_pending_idx on public.engine_commands (created_at) where status = 'pending';
create index engine_commands_user_idx on public.engine_commands (user_id, created_at desc);

alter table public.engine_commands enable row level security;
create policy "okuma" on public.engine_commands
  for select using (user_id = auth.uid() and public.my_role() is not null);
create policy "ekleme" on public.engine_commands
  for insert with check (
    user_id = auth.uid() and public.my_role() is not null
    and status = 'pending' and result is null and error is null and finished_at is null
  );

-- ---------------------------------------------------------------- motorun sinyal kaydı
-- record_signal ile aynı kurallar; kullanıcı oturum yerine parametreyle gelir. Sadece motor çağırır.
create function public.engine_record_signal(
  p_user_id   uuid,
  p_source_id uuid,
  p_msg_id    bigint,
  p_mint      text,
  p_raw_text  text,
  p_msg_ts    timestamptz
) returns table (is_new boolean, hit_count integer)
language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare
  v_inserted uuid;
  v_hits integer;
begin
  if not exists (select 1 from public.profiles p where p.id = p_user_id and p.is_active) then
    raise exception 'inactive';
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id and s.user_id = p_user_id) then
    raise exception 'unknown source';
  end if;
  if p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    raise exception 'invalid mint';
  end if;

  insert into public.signals (user_id, source_id, msg_id, mint, raw_text, msg_ts)
  values (p_user_id, p_source_id, p_msg_id, p_mint, left(p_raw_text, 4000), p_msg_ts)
  on conflict (user_id, source_id, msg_id, mint) where msg_id is not null do nothing
  returning id into v_inserted;

  if v_inserted is null then
    select h.hit_count into v_hits from public.signal_hits h where h.user_id = p_user_id and h.mint = p_mint;
    return query select false, coalesce(v_hits, 0);
    return;
  end if;

  insert into public.signal_hits as h (user_id, mint)
  values (p_user_id, p_mint)
  on conflict (user_id, mint) do update
    set hit_count = h.hit_count + 1, last_seen_at = now()
  returning h.hit_count into v_hits;

  return query select true, v_hits;
end $$;
revoke execute on function public.engine_record_signal(uuid, uuid, bigint, text, text, timestamptz) from public, anon, authenticated;
grant execute on function public.engine_record_signal(uuid, uuid, bigint, text, text, timestamptz) to service_role;

-- Eski çoklu bilgisayar kilidi artık kullanılmıyor (tek motor var)
drop table public.engine_leases;

-- 0.1.x sürümleri motorla çalışamaz
update public.app_settings set value = '"0.2.0"'::jsonb where key = 'min_app_version';

alter publication supabase_realtime add table public.engine_status, public.engine_user_state, public.engine_commands, public.sources, public.rules;
