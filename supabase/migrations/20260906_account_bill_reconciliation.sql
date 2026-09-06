-- Bills & Budget v0.4.0: per-bill bank assignment and account display settings.

alter table public.plaid_accounts
  add column if not exists display_name text,
  add column if not exists is_hidden boolean not null default false;

alter table public.bills
  add column if not exists bank_account_id text;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'bills_bank_account_user_fk'
      and conrelid = 'public.bills'::regclass
  ) then
    alter table public.bills
      add constraint bills_bank_account_user_fk
      foreign key (user_id, bank_account_id)
      references public.plaid_accounts(user_id, account_id)
      on delete set null (bank_account_id);
  end if;
end $$;

create index if not exists bills_user_bank_account_idx
  on public.bills(user_id, bank_account_id)
  where bank_account_id is not null;

drop policy if exists "plaid accounts owner update" on public.plaid_accounts;
create policy "plaid accounts owner update"
  on public.plaid_accounts
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

revoke update on public.plaid_accounts from authenticated;
grant update (display_name, is_hidden) on public.plaid_accounts to authenticated;

create or replace function public.bill_tracker_set_bank_account()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if nullif(new.account, '') is not null
     and exists (
       select 1 from public.plaid_accounts pa
       where pa.user_id = new.user_id
         and pa.account_id = new.account
     ) then
    new.bank_account_id := new.account;
  elsif new.bank_account_id is null then
    select m.account_id into new.bank_account_id
    from public.category_account_mappings m
    where m.user_id = new.user_id
      and m.bill_category = new.category
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists bills_set_bank_account on public.bills;
create trigger bills_set_bank_account
before insert or update of account, category
on public.bills
for each row
execute function public.bill_tracker_set_bank_account();
