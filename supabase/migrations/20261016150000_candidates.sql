-- Faz 3: güvenlik kontrolü + karar motoru + manuel onay

-- Telegram bağlamadan test için elle eklenen sinyaller
alter table public.sources drop constraint sources_type_check;
alter table public.sources add constraint sources_type_check check (type in ('telegram', 'x', 'manual'));

-- Her kullanıcının tek aktif kuralı var
create unique index rules_one_per_user on public.rules (user_id);

-- Güvenlikten geçen sinyaller → onay bekleyen adaylar
create type public.candidate_status as enum ('pending', 'approved', 'rejected', 'expired');

create table public.candidates (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  mint             text not null,
  signal_id        uuid references public.signals (id) on delete set null,
  safety_check_id  uuid references public.safety_checks (id) on delete set null,
  verdict          public.safety_result not null,
  reasons          jsonb not null default '[]'::jsonb,
  summary          jsonb not null default '{}'::jsonb,   -- sembol, fiyat, mcap, likidite (karar anı)
  status           public.candidate_status not null default 'pending',
  amount_sol       numeric,                              -- onaylanan alım tutarı
  created_at       timestamptz not null default now(),
  expires_at       timestamptz not null default now() + interval '10 minutes',
  decided_at       timestamptz
);
create index candidates_user_status_idx on public.candidates (user_id, status, created_at desc);
-- Aynı token için aynı anda tek bekleyen aday (iki bilgisayar aynı sinyali işlerse)
create unique index candidates_one_pending on public.candidates (user_id, mint) where status = 'pending';

alter table public.candidates enable row level security;
create policy "okuma" on public.candidates
  for select using (public.my_role() is not null and (user_id = auth.uid() or public.is_founder()));
-- Aday her rol için oluşturulabilir (izleme), ama onay/ret sadece işlem yetkisi olanlarda
create policy "ekleme" on public.candidates
  for insert with check (user_id = auth.uid() and public.my_role() is not null);
create policy "karar" on public.candidates
  for update using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());

-- Süresi geçen bekleyen adayları kapatır (uygulama periyodik çağırır).
-- security definer: işlem yetkisi olmayan rollerin adayları da kapanabilsin; sadece kendi satırları.
create function public.expire_candidates() returns integer
language sql security definer set search_path = public as $$
  with x as (
    update public.candidates set status = 'expired', decided_at = now()
    where user_id = auth.uid() and status = 'pending' and expires_at < now()
    returning 1
  ) select count(*)::int from x
$$;
grant execute on function public.expire_candidates() to authenticated;

alter publication supabase_realtime add table public.candidates, public.safety_checks;
