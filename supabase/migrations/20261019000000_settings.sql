-- v2 Faz 5: Ayarlar v2 — hesaplar, anahtar kelimeler, ücret preset'leri, görünüm, kısayollar
-- Hepsi kullanıcıya özel ve Supabase'de: Chrome ve masaüstü aynı ayarları görür.

-- ---------------------------------------------------------------- kaynak ayarları
alter table public.sources
  add column muted  boolean not null default false,   -- kartları akışta gösterme (sinyal yine işlenir)
  add column notify boolean not null default false;   -- yeni gönderide bildirim

-- ---------------------------------------------------------------- ortak hesap havuzu
-- Founder'ın herkesle paylaştığı önerilen hesap/kanal listesi (izlemek için XFlux izleyicisi kurulur
-- ya da Telegram kanalına katılınır). CSV ile içe/dışa aktarılır.
create table public.shared_accounts (
  id          uuid primary key default gen_random_uuid(),
  platform    text not null check (platform in ('x', 'telegram')),
  handle      text not null check (char_length(handle) between 1 and 100),
  title       text,
  note        text,
  created_by  uuid references public.profiles (id) on delete set null default auth.uid(),
  created_at  timestamptz not null default now(),
  unique (platform, handle)
);
alter table public.shared_accounts enable row level security;
create policy "okuma" on public.shared_accounts for select using (public.my_role() is not null);
create policy "founder yazar" on public.shared_accounts for all using (public.is_founder()) with check (public.is_founder());

-- ---------------------------------------------------------------- anahtar kelimeler
create type public.keyword_match as enum ('partial', 'word', 'regex');

create table public.keywords (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  pattern     text not null check (char_length(pattern) between 1 and 200),
  match       public.keyword_match not null default 'partial',
  color       text check (color is null or color ~ '^#[0-9a-fA-F]{6}$'),
  sound       boolean not null default false,
  notify      boolean not null default false,
  muted       boolean not null default false,
  created_at  timestamptz not null default now(),
  unique (user_id, pattern, match)
);
alter table public.keywords enable row level security;
create policy "okuma" on public.keywords for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "yazma" on public.keywords for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);

-- ---------------------------------------------------------------- ücret preset'leri (P1–P3 × alım/satım/deploy)
create table public.fee_presets (
  user_id       uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  slot          smallint not null check (slot between 1 and 3),
  kind          text not null check (kind in ('buy', 'sell', 'deploy')),
  priority_sol  numeric not null check (priority_sol >= 0 and priority_sol <= 0.1),
  tip_sol       numeric not null check (tip_sol >= 0 and tip_sol <= 0.1),
  slippage      numeric check (slippage is null or (slippage >= 1 and slippage <= 100)), -- null = otomatik
  anti_mev      boolean not null default true,
  updated_at    timestamptz not null default now(),
  primary key (user_id, slot, kind)
);
alter table public.fee_presets enable row level security;
create policy "okuma" on public.fee_presets for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
create policy "yazma" on public.fee_presets for all using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());

-- ---------------------------------------------------------------- arayüz ayarları
create table public.ui_settings (
  user_id     uuid primary key references public.profiles (id) on delete cascade default auth.uid(),
  theme       jsonb not null default '{}'::jsonb,   -- { preset, colors: { bg, surface, accent, text, muted, border } }
  keybinds    jsonb not null default '{}'::jsonb,   -- { eylem: "F1" }
  layout      jsonb not null default '{}'::jsonb,   -- deploy formu yerleşimi vb.
  updated_at  timestamptz not null default now()
);
alter table public.ui_settings enable row level security;
create policy "okuma" on public.ui_settings for select using (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.ui_settings for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);

alter publication supabase_realtime add table public.keywords, public.fee_presets, public.ui_settings;

-- Emrin ücret preset'i (arayüz o anki etkin preset'i, otomatik mod kuraldaki preset'i yazar)
alter table public.orders add column preset smallint check (preset is null or preset between 1 and 3);
