-- Hide archived duplicate connections from bank account settings without deleting history.
alter table public.plaid_accounts
  add column if not exists connection_inactive boolean not null default false;
