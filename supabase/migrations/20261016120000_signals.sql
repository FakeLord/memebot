-- Faz 2: Telegram sinyal kaydı
-- Aynı mesaj (düzenlenme, iki bilgisayarda açık uygulama) tekrar sayılmaz.

alter table public.signals add column msg_id bigint;

create unique index signals_dedupe_idx
  on public.signals (user_id, source_id, msg_id, mint)
  where msg_id is not null;

-- Bir mesajdaki bir mint'i kaydeder. Yeni ise signal_hits sayacını artırır.
-- Dönen değer: yeni kayıt mı (is_new) ve güncel çağrı sayısı (hit_count).
create function public.record_signal(
  p_source_id uuid,
  p_msg_id    bigint,
  p_mint      text,
  p_raw_text  text,
  p_msg_ts    timestamptz
) returns table (is_new boolean, hit_count integer)
language plpgsql security invoker set search_path = public as $$
#variable_conflict use_column
declare
  v_inserted uuid;
  v_hits integer;
begin
  if public.my_role() is null then
    raise exception 'inactive';
  end if;
  if not exists (select 1 from public.sources s where s.id = p_source_id and s.user_id = auth.uid()) then
    raise exception 'unknown source';
  end if;
  if p_mint !~ '^[1-9A-HJ-NP-Za-km-z]{32,44}$' then
    raise exception 'invalid mint';
  end if;

  insert into public.signals (user_id, source_id, msg_id, mint, raw_text, msg_ts)
  values (auth.uid(), p_source_id, p_msg_id, p_mint, left(p_raw_text, 4000), p_msg_ts)
  on conflict (user_id, source_id, msg_id, mint) where msg_id is not null do nothing
  returning id into v_inserted;

  if v_inserted is null then
    select h.hit_count into v_hits from public.signal_hits h where h.user_id = auth.uid() and h.mint = p_mint;
    return query select false, coalesce(v_hits, 0);
    return;
  end if;

  insert into public.signal_hits as h (user_id, mint)
  values (auth.uid(), p_mint)
  on conflict (user_id, mint) do update
    set hit_count = h.hit_count + 1, last_seen_at = now()
  returning h.hit_count into v_hits;

  return query select true, v_hits;
end $$;

grant execute on function public.record_signal(uuid, bigint, text, text, timestamptz) to authenticated;
