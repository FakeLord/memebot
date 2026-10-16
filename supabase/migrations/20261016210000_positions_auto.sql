-- Faz 5: pozisyon takibi + otomatik mod

alter table public.positions
  add column amount_initial_raw text,                       -- alımda gelen miktar (kalan oranı için)
  add column decimals           integer,                    -- token ondalık basamağı
  add column proceeds_estimated boolean not null default false, -- GMGN TP/SL satışı tahmini değerle işlendi
  add column close_reason       text;                       -- manual | gmgn_tpsl | panic

alter table public.candidates
  add column auto boolean not null default false;           -- otomatik modda onaylandı

-- Mevcut pozisyonlar: başlangıç miktarı bilinmiyorsa şu anki miktar kabul edilir
update public.positions set amount_initial_raw = amount_raw where amount_initial_raw is null;
