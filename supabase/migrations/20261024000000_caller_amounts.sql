-- Çağrıcılar: kişiye özel karar ve alım tutarı.
-- rule: normal (genel kurala uyar) / manual (her zaman onaya düşer) / trusted (otomatik al) / blocked (engelli)
-- buy_sol: bu kişinin çağrısında otomatik alım tutarı (boşsa Kurallar'daki tutar). Mutlak üst sınır 5 SOL.
-- X hesapları da çağrıcıdır: sender_id = 'x:<kullanıcı adı>' (Telegram kimlikleri sayısaldır).

alter table public.callers drop constraint if exists callers_rule_check;
alter table public.callers
  add constraint callers_rule_check check (rule in ('normal', 'manual', 'trusted', 'blocked'));

alter table public.callers
  add column if not exists buy_sol numeric check (buy_sol is null or (buy_sol > 0 and buy_sol <= 5));
