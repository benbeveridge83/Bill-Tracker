-- Bills & Budget v0.3.0
-- Adds account-purpose mappings, learned bill matching, review/automatic
-- confirmation modes, and monthly spending classification.

alter table public.bills
  add column if not exists match_mode text not null default 'review',
  add column if not exists match_keywords text[] not null default '{}',
  add column if not exists match_amount_tolerance numeric not null default 0.15;

update public.bills
set match_mode = 'review'
where match_mode is null or match_mode not in ('review', 'automatic', 'off');

update public.bills
set match_amount_tolerance = 0.15
where match_amount_tolerance is null
   or match_amount_tolerance < 0
   or match_amount_tolerance > 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bills_match_mode_check'
      and conrelid = 'public.bills'::regclass
  ) then
    alter table public.bills
      add constraint bills_match_mode_check
      check (match_mode in ('review', 'automatic', 'off'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bills_match_amount_tolerance_check'
      and conrelid = 'public.bills'::regclass
  ) then
    alter table public.bills
      add constraint bills_match_amount_tolerance_check
      check (match_amount_tolerance between 0 and 1);
  end if;
end $$;

create table if not exists public.category_account_mappings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_category text not null,
  account_id text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, bill_category),
  foreign key (user_id, account_id)
    references public.plaid_accounts(user_id, account_id)
    on delete cascade
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'category_account_mappings_bill_category_check'
      and conrelid = 'public.category_account_mappings'::regclass
  ) then
    alter table public.category_account_mappings
      add constraint category_account_mappings_bill_category_check
      check (bill_category in ('Household', 'Business'));
  end if;
end $$;

alter table public.plaid_transactions
  add column if not exists suggested_bill_id uuid references public.bills(id) on delete set null,
  add column if not exists match_status text not null default 'unmatched',
  add column if not exists match_confidence numeric,
  add column if not exists match_reason text,
  add column if not exists match_source text,
  add column if not exists matched_at timestamptz,
  add column if not exists personal_finance_primary text,
  add column if not exists personal_finance_detailed text,
  add column if not exists personal_finance_confidence text,
  add column if not exists payment_channel text,
  add column if not exists check_number text,
  add column if not exists counterparty_names text[] not null default '{}',
  add column if not exists is_transfer boolean not null default false,
  add column if not exists is_check boolean not null default false,
  add column if not exists spending_category text,
  add column if not exists spending_subcategory text,
  add column if not exists classification_status text not null default 'uncharacterized',
  add column if not exists classified_at timestamptz,
  add column if not exists excluded_from_spending boolean not null default false;

-- v0.2 used matched_bill_id for an unapproved suggestion. Preserve those rows
-- as suggestions so that they cannot mark bills paid without confirmation.
update public.plaid_transactions
set suggested_bill_id = matched_bill_id,
    matched_bill_id = null,
    match_status = 'suggested',
    match_source = coalesce(match_source, 'legacy_rule')
where matched_bill_id is not null
  and match_status = 'unmatched';

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'plaid_transactions_match_status_check'
      and conrelid = 'public.plaid_transactions'::regclass
  ) then
    alter table public.plaid_transactions
      add constraint plaid_transactions_match_status_check
      check (match_status in ('unmatched', 'suggested', 'approved', 'automatic'));
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'plaid_transactions_match_confidence_check'
      and conrelid = 'public.plaid_transactions'::regclass
  ) then
    alter table public.plaid_transactions
      add constraint plaid_transactions_match_confidence_check
      check (match_confidence is null or match_confidence between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'plaid_transactions_classification_status_check'
      and conrelid = 'public.plaid_transactions'::regclass
  ) then
    alter table public.plaid_transactions
      add constraint plaid_transactions_classification_status_check
      check (classification_status in ('uncharacterized', 'manual', 'bank'));
  end if;
end $$;

alter table public.bill_month_marks
  add column if not exists source text not null default 'manual',
  add column if not exists plaid_transaction_id text,
  add column if not exists match_confidence numeric,
  add column if not exists match_reason text;

create table if not exists public.bill_match_rules (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  account_id text not null,
  normalized_descriptor text not null,
  merchant_name text,
  transaction_name text,
  amount_average numeric not null default 0,
  amount_tolerance numeric not null default 0.15,
  confirmation_count integer not null default 1,
  active boolean not null default true,
  first_confirmed_at timestamptz not null default now(),
  last_confirmed_at timestamptz not null default now(),
  unique(user_id, bill_id, account_id, normalized_descriptor),
  foreign key (user_id, account_id)
    references public.plaid_accounts(user_id, account_id)
    on delete cascade
);

create table if not exists public.bill_match_feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  bill_id uuid not null references public.bills(id) on delete cascade,
  transaction_id text not null,
  decision text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(user_id, bill_id, transaction_id)
);

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bill_match_rules_amount_tolerance_check'
      and conrelid = 'public.bill_match_rules'::regclass
  ) then
    alter table public.bill_match_rules
      add constraint bill_match_rules_amount_tolerance_check
      check (amount_tolerance between 0 and 1);
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'bill_match_feedback_decision_check'
      and conrelid = 'public.bill_match_feedback'::regclass
  ) then
    alter table public.bill_match_feedback
      add constraint bill_match_feedback_decision_check
      check (decision in ('approved', 'rejected'));
  end if;
end $$;

create index if not exists category_account_mappings_user_idx
  on public.category_account_mappings(user_id);
create index if not exists bill_match_rules_user_bill_idx
  on public.bill_match_rules(user_id, bill_id);
create index if not exists bill_match_rules_descriptor_idx
  on public.bill_match_rules(user_id, account_id, normalized_descriptor);
create index if not exists bill_match_feedback_user_tx_idx
  on public.bill_match_feedback(user_id, transaction_id);
create index if not exists plaid_transactions_suggested_bill_idx
  on public.plaid_transactions(user_id, suggested_bill_id)
  where suggested_bill_id is not null;
create index if not exists plaid_transactions_confirmed_bill_idx
  on public.plaid_transactions(user_id, matched_bill_id, date desc)
  where matched_bill_id is not null;
create index if not exists plaid_transactions_month_account_idx
  on public.plaid_transactions(user_id, account_id, date desc);
create index if not exists plaid_transactions_classification_idx
  on public.plaid_transactions(user_id, classification_status, date desc);
create unique index if not exists bill_month_marks_plaid_tx_unique
  on public.bill_month_marks(user_id, plaid_transaction_id)
  where plaid_transaction_id is not null;

alter table public.category_account_mappings enable row level security;
alter table public.bill_match_rules enable row level security;
alter table public.bill_match_feedback enable row level security;

drop policy if exists "category account mappings owner select" on public.category_account_mappings;
drop policy if exists "category account mappings owner insert" on public.category_account_mappings;
drop policy if exists "category account mappings owner update" on public.category_account_mappings;
drop policy if exists "category account mappings owner delete" on public.category_account_mappings;
create policy "category account mappings owner select"
  on public.category_account_mappings for select to authenticated
  using ((select auth.uid()) = user_id);
create policy "category account mappings owner insert"
  on public.category_account_mappings for insert to authenticated
  with check ((select auth.uid()) = user_id);
create policy "category account mappings owner update"
  on public.category_account_mappings for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);
create policy "category account mappings owner delete"
  on public.category_account_mappings for delete to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "bill match rules owner select" on public.bill_match_rules;
create policy "bill match rules owner select"
  on public.bill_match_rules for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "plaid tx owner update classification" on public.plaid_transactions;
create policy "plaid tx owner update classification"
  on public.plaid_transactions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke all on public.category_account_mappings,
              public.bill_match_rules,
              public.bill_match_feedback
from anon, authenticated;

grant select, insert, update, delete
  on public.category_account_mappings
  to authenticated;
grant select on public.bill_match_rules to authenticated;

-- Matching fields are changed only by authenticated Edge Functions. Browser
-- users may update their own spending classification fields.
grant update (
  spending_category,
  spending_subcategory,
  classification_status,
  classified_at,
  excluded_from_spending
) on public.plaid_transactions to authenticated;
