-- Faz 4: alım-satım (deneme + gerçek)

alter table public.orders
  add column candidate_id uuid references public.candidates (id) on delete set null,
  add column position_id  uuid references public.positions (id) on delete set null,
  add column sell_percent numeric,
  add column symbol       text;

alter table public.positions
  add column buy_order_id uuid unique references public.orders (id) on delete set null,
  add column symbol       text,
  add column entry_mcap   numeric,
  add column cost_sol     numeric,          -- harcanan SOL
  add column proceeds_sol numeric not null default 0; -- satışlardan gelen SOL

-- Aynı token için aynı modda tek açık pozisyon
create unique index positions_one_open on public.positions (user_id, mint, is_dry_run) where status = 'open';

create index orders_open_idx on public.orders (user_id, status) where status in ('submitted', 'pending', 'processed');
-- orders ve positions zaten realtime yayınında (ilk migration)
