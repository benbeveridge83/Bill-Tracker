-- Persist the category used for suggestions on each bank account.
-- Existing category-to-account mappings remain the fallback until changed.
alter table public.plaid_accounts
  add column if not exists bill_match_category text
  check (bill_match_category in ('Business', 'Household', 'all'));

-- Preserve the existing owner RLS policy and column-level privileges.
grant update (bill_match_category) on public.plaid_accounts to authenticated;

comment on column public.plaid_accounts.bill_match_category is
  'Preferred bill category for suggestions; NULL uses the category account mapping.';
