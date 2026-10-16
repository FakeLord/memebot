-- v2 Faz 6: Token deploy (GMGN create_token)
-- Arayüz "deploy.submit" komutu gönderir; motor doğrular, deneme modunda sadece kaydeder (GMGN'e GÖNDERMEZ),
-- gerçek modda GMGN'e gönderip emri izler. Aynı form iki kez gönderilemez (idempotency_key).

create type public.deploy_status as enum ('simulated', 'sending', 'submitted', 'confirmed', 'failed');

create table public.deploys (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade,
  idempotency_key  text not null unique,
  feed_item_id     uuid references public.feed_items (id) on delete set null,
  platform         text not null check (platform in ('pump', 'bonk', 'bags')),
  name             text not null,
  symbol           text not null,
  is_dry_run       boolean not null,
  status           public.deploy_status not null,
  request          jsonb,             -- GMGN'e giden (ya da deneme modunda gidecek olan) istek; görsel kısaltılmış
  gmgn_order_id    text,
  mint             text,
  tx_hash          text,
  error            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index deploys_user_idx on public.deploys (user_id, created_at desc);

alter table public.deploys enable row level security;
create policy "okuma" on public.deploys
  for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
-- Yazma yalnızca motor (service_role)

alter publication supabase_realtime add table public.deploys;
