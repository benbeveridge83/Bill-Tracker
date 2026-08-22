create extension if not exists pgcrypto;

create table if not exists public.bills (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  legacy_id text,
  name text not null,
  category text not null default 'Household',
  subcategory text default '',
  amount numeric not null default 0,
  frequency text not null default 'monthly',
  anchor date not null default current_date,
  custom_days integer,
  autopay boolean not null default false,
  overdue numeric not null default 0,
  balance numeric not null default 0,
  balance_as_of date,
  portal_url text default '',
  account text default '',
  notes text default '',
  next_due date,
  last_paid date,
  current_as_of date,
  cancel_requested boolean not null default false,
  cancel_at date,
  archived boolean not null default false,
  archived_at date,
  mail_updated_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, legacy_id)
);

create table if not exists public.bill_month_marks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  key text not null,
  year integer not null,
  month integer not null check (month between 1 and 12),
  paid boolean not null default true,
  amount numeric not null default 0,
  date date not null default current_date,
  created_at timestamptz not null default now(),
  unique(user_id, key)
);

create table if not exists public.payment_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid references public.bills(id) on delete set null,
  date date not null default current_date,
  amount numeric not null default 0,
  memo text default '',
  period_key text default '',
  source text not null default 'manual',
  plaid_transaction_id text unique,
  created_at timestamptz not null default now()
);

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  access_token text not null,
  cursor text,
  institution_id text,
  institution_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, item_id)
);

create table if not exists public.plaid_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null,
  institution_name text,
  account_id text not null,
  name text,
  official_name text,
  mask text,
  type text,
  subtype text,
  current_balance numeric,
  available_balance numeric,
  iso_currency_code text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, account_id)
);

create table if not exists public.plaid_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  account_id text not null,
  transaction_id text not null,
  date date not null,
  name text,
  merchant_name text,
  amount numeric not null default 0,
  pending boolean not null default false,
  category text[],
  raw jsonb,
  matched_bill_id uuid references public.bills(id) on delete set null,
  created_at timestamptz not null default now(),
  unique(user_id, transaction_id)
);

alter table public.bills enable row level security;
alter table public.bill_month_marks enable row level security;
alter table public.payment_logs enable row level security;
alter table public.plaid_items enable row level security;
alter table public.plaid_accounts enable row level security;
alter table public.plaid_transactions enable row level security;

create policy "bills owner select" on public.bills for select to authenticated using ((select auth.uid()) = user_id);
create policy "bills owner insert" on public.bills for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "bills owner update" on public.bills for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "bills owner delete" on public.bills for delete to authenticated using ((select auth.uid()) = user_id);

create policy "marks owner select" on public.bill_month_marks for select to authenticated using ((select auth.uid()) = user_id);
create policy "marks owner insert" on public.bill_month_marks for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "marks owner update" on public.bill_month_marks for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "marks owner delete" on public.bill_month_marks for delete to authenticated using ((select auth.uid()) = user_id);

create policy "logs owner select" on public.payment_logs for select to authenticated using ((select auth.uid()) = user_id);
create policy "logs owner insert" on public.payment_logs for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "logs owner update" on public.payment_logs for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "logs owner delete" on public.payment_logs for delete to authenticated using ((select auth.uid()) = user_id);

create policy "plaid accounts owner select" on public.plaid_accounts for select to authenticated using ((select auth.uid()) = user_id);
create policy "plaid tx owner select" on public.plaid_transactions for select to authenticated using ((select auth.uid()) = user_id);
create policy "plaid items deny browser select" on public.plaid_items for select to authenticated using (false);

create index if not exists bills_user_id_idx on public.bills(user_id);
create index if not exists bill_month_marks_user_id_idx on public.bill_month_marks(user_id);
create index if not exists bill_month_marks_bill_id_idx on public.bill_month_marks(bill_id);
create index if not exists payment_logs_user_date_idx on public.payment_logs(user_id, date desc);
create index if not exists payment_logs_bill_id_idx on public.payment_logs(bill_id);
create index if not exists plaid_items_user_id_idx on public.plaid_items(user_id);
create index if not exists plaid_accounts_user_id_idx on public.plaid_accounts(user_id);
create index if not exists plaid_transactions_user_date_idx on public.plaid_transactions(user_id, date desc);
create index if not exists plaid_transactions_matched_bill_id_idx on public.plaid_transactions(matched_bill_id);

-- plaid_items is intentionally not readable from browser clients. Edge Functions use service role.
grant usage on schema public to authenticated;
revoke all on public.bills, public.bill_month_marks, public.payment_logs, public.plaid_items, public.plaid_accounts, public.plaid_transactions from anon, authenticated;
grant select, insert, update, delete on public.bills, public.bill_month_marks, public.payment_logs to authenticated;
grant select on public.plaid_accounts, public.plaid_transactions to authenticated;
