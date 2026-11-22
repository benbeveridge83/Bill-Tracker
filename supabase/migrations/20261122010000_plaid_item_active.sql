-- Preserve duplicate connections for review while allowing sync to skip them.
alter table public.plaid_items
  add column if not exists is_active boolean not null default true;

