-- v2 Faz 4: Canlı akış (gönderi kartları + öneri ızgarası)
-- Motor izlenen kaynakların TÜM gönderilerini buraya yazar (sadece adres içerenleri değil).
-- Aynı gönderi tek kart: (kullanıcı, platform, dış kimlik) tekil. 7 günden eski kartlar motor tarafından silinir.

create table public.feed_items (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles (id) on delete cascade,
  source_id    uuid references public.sources (id) on delete set null,
  platform     text not null check (platform in ('telegram', 'x')),
  external_id  text not null,                        -- tweet kimliği / "sohbet:mesaj" (METİN: 19 hane JS sayısına sığmaz)
  author       jsonb not null default '{}'::jsonb,   -- { name, handle, avatar, verified, followers }
  text         text not null default '',
  media        jsonb not null default '[]'::jsonb,   -- [{ type: photo|video, url }]
  kind         text not null default 'post' check (kind in ('post', 'reply', 'quote', 'repost')),
  ref          jsonb,                                -- yanıtlanan / alıntılanan gönderi { author, text }
  url          text,                                 -- orijinal gönderi
  mints        text[] not null default '{}',         -- gönderideki token adresleri
  tickers      text[] not null default '{}',         -- $TICKER'lar
  suggestions  jsonb,                                -- GMGN aramasından eşleşen token'lar (motor doldurur)
  hidden       boolean not null default false,
  pinned       boolean not null default false,
  posted_at    timestamptz,
  received_at  timestamptz not null default now(),
  unique (user_id, platform, external_id)
);
create index feed_items_user_idx on public.feed_items (user_id, received_at desc);
create index feed_items_received_idx on public.feed_items (received_at);

alter table public.feed_items enable row level security;
create policy "okuma" on public.feed_items
  for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
-- Kullanıcı sadece kendi kartını gizleyip sabitleyebilir (diğer sütunlar motorun)
create policy "gizle/sabitle" on public.feed_items
  for update using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid());
revoke update on public.feed_items from authenticated;
grant update (hidden, pinned) on public.feed_items to authenticated;

-- Telegram görsellerinin küçük önizlemeleri (motor yükler). Yollar tahmin edilemez (uuid).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('feed-media', 'feed-media', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

alter publication supabase_realtime add table public.feed_items;
