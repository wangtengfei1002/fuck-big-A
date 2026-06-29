create extension if not exists pgcrypto;

create table if not exists public.sim_portfolios (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  cash numeric not null default 50000,
  market_value numeric not null default 0,
  total_asset numeric not null default 50000,
  floating_pnl numeric not null default 0,
  realized_pnl numeric not null default 0,
  return_pct numeric not null default 0,
  scanned_assets integer not null default 0,
  signal_count integer not null default 0,
  data_source text,
  market_updated_at timestamptz,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table if not exists public.sim_positions (
  id uuid primary key default gen_random_uuid(),
  portfolio_slug text not null references public.sim_portfolios(slug) on delete cascade,
  code text not null,
  name text not null,
  kind text not null,
  horizon text not null default 'swing',
  quantity integer not null,
  available_quantity integer not null,
  locked_quantity integer not null default 0,
  locked_until date,
  average_cost numeric not null,
  last_price numeric not null,
  highest_price numeric not null default 0,
  market_value numeric not null,
  floating_pnl numeric not null,
  floating_pnl_pct numeric not null,
  highest_pnl_pct numeric not null default 0,
  opened_at text,
  updated_at timestamptz not null default now(),
  unique (portfolio_slug, code)
);

create table if not exists public.sim_orders (
  id text primary key,
  portfolio_slug text not null references public.sim_portfolios(slug) on delete cascade,
  time text not null,
  side text not null,
  code text not null,
  name text not null,
  price numeric not null,
  quantity integer not null,
  amount numeric not null,
  status text not null,
  horizon text not null default 'swing',
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.sim_trades (
  id text primary key,
  portfolio_slug text not null references public.sim_portfolios(slug) on delete cascade,
  time text not null,
  side text not null,
  code text not null,
  name text not null,
  price numeric not null,
  quantity integer not null,
  amount numeric not null,
  fee numeric not null,
  pnl numeric not null default 0,
  trade_date date,
  horizon text not null default 'swing',
  reason text,
  created_at timestamptz not null default now()
);

create table if not exists public.sim_strategy_logs (
  id text primary key,
  portfolio_slug text not null references public.sim_portfolios(slug) on delete cascade,
  time text not null,
  level text not null,
  message text not null,
  created_at timestamptz not null default now()
);

alter table public.sim_portfolios enable row level security;
alter table public.sim_positions enable row level security;
alter table public.sim_orders enable row level security;
alter table public.sim_trades enable row level security;
alter table public.sim_strategy_logs enable row level security;
