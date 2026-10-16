-- v2 Faz 7: Cüzdanlar — GMGN'e bağlı cüzdanlar için etiket ve listeden gizleme.
-- İşlemde kullanılan (varsayılan) cüzdan motorun kasasında durur; burası sadece görünüm tercihi.
-- Uygulama özel anahtar TUTMAZ: cüzdan oluşturma/silme GMGN'de yapılır.

create table public.wallet_prefs (
  user_id     uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  address     text not null check (address ~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$'),
  label       text check (label is null or char_length(label) <= 40),
  hidden      boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (user_id, address)
);
alter table public.wallet_prefs enable row level security;
create policy "okuma" on public.wallet_prefs for select using (user_id = auth.uid() and public.my_role() is not null);
create policy "yazma" on public.wallet_prefs for all using (user_id = auth.uid() and public.my_role() is not null) with check (user_id = auth.uid() and public.my_role() is not null);
