-- Reusable labels for non-recurring purchases, separate from recurring bills.
create table if not exists public.non_recurring_expense_types (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  category text not null check (length(trim(category)) > 0),
  subcategory text,
  created_at timestamptz not null default now(),
  unique (user_id, name)
);

alter table public.non_recurring_expense_types enable row level security;
create policy "expense types owner select" on public.non_recurring_expense_types for select to authenticated using ((select auth.uid()) = user_id);
create policy "expense types owner insert" on public.non_recurring_expense_types for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "expense types owner update" on public.non_recurring_expense_types for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy "expense types owner delete" on public.non_recurring_expense_types for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, update, delete on public.non_recurring_expense_types to authenticated;

alter table public.plaid_transactions
  add column if not exists expense_type_id uuid references public.non_recurring_expense_types(id) on delete set null,
  add column if not exists reviewed_at timestamptz;

-- Existing imported history predates the inbox. Only future imports need an alert.
update public.plaid_transactions set reviewed_at = now() where reviewed_at is null;

create index if not exists plaid_transactions_user_reviewed_idx on public.plaid_transactions (user_id, reviewed_at);
grant update (expense_type_id, reviewed_at) on public.plaid_transactions to authenticated;
