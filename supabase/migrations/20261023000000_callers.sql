-- Çağrıcılar: Telegram gruplarında token paylaşan kişiler.
-- Sinyale gönderen bilgisi eklenir; kullanıcı her kişiye kural verir (normal / güvenilir / engelli).
-- Kişi başarısı kendi işlemlerimizden hesaplanır (pozisyon → sinyal → gönderen), ayrı tablo gerekmez.

alter table public.signals
  add column if not exists sender_id     text,
  add column if not exists sender_name   text,
  add column if not exists sender_handle text;

create table if not exists public.callers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.profiles (id) on delete cascade default auth.uid(),
  sender_id     text not null,                       -- Telegram kullanıcı kimliği (kullanıcı adı değişebilir)
  name          text,
  handle        text,
  rule          text not null default 'normal' check (rule in ('normal', 'trusted', 'blocked')),
  first_seen_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, sender_id)
);

alter table public.callers enable row level security;
create policy "çağrıcı okuma" on public.callers
  for select using (public.my_role() is not null and user_id = auth.uid());
create policy "çağrıcı kural" on public.callers
  for update using (user_id = auth.uid() and public.can_trade()) with check (user_id = auth.uid() and public.can_trade());

alter publication supabase_realtime add table public.callers;

-- Motorun sinyal kaydı: gönderen bilgisi opsiyonel parametreler (eski çağrılar bozulmaz).
drop function if exists public.engine_record_signal(uuid, uuid, bigint, text, text, timestamptz);
create function public.engine_record_signal(
  p_user_id       uuid,
  p_source_id     uuid,
  p_msg_id        bigint,
  p_mint          text,
  p_raw_text      text,
  p_msg_ts        timestamptz,
  p_sender_id     text default null,
  p_sender_name   text default null,
  p_sender_handle text default null
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

  insert into public.signals (user_id, source_id, msg_id, mint, raw_text, msg_ts, sender_id, sender_name, sender_handle)
  values (p_user_id, p_source_id, p_msg_id, p_mint, left(p_raw_text, 4000), p_msg_ts, p_sender_id, left(p_sender_name, 80), left(p_sender_handle, 80))
  on conflict (user_id, source_id, msg_id, mint) where msg_id is not null do nothing
  returning id into v_inserted;

  if p_sender_id is not null then
    insert into public.callers as c (user_id, sender_id, name, handle)
    values (p_user_id, p_sender_id, left(p_sender_name, 80), left(p_sender_handle, 80))
    on conflict (user_id, sender_id) do update
      set name = coalesce(excluded.name, c.name), handle = coalesce(excluded.handle, c.handle), last_seen_at = now();
  end if;

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
revoke execute on function public.engine_record_signal(uuid, uuid, bigint, text, text, timestamptz, text, text, text) from public, anon, authenticated;
grant execute on function public.engine_record_signal(uuid, uuid, bigint, text, text, timestamptz, text, text, text) to service_role;
