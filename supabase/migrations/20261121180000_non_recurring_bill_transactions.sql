-- Transaction review is separate from bookkeeping characterization.
alter table public.plaid_transactions
  add column if not exists non_recurring_bill boolean not null default false;

alter table public.plaid_transactions
  add constraint plaid_transactions_non_recurring_unmatched
  check (not non_recurring_bill or matched_bill_id is null);

create or replace function public.bill_tracker_clear_non_recurring_suggestion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.non_recurring_bill then
    new.suggested_bill_id := null;
    new.match_status := 'unmatched';
    new.match_confidence := null;
    new.match_reason := null;
    new.match_source := null;
    new.matched_at := null;
  end if;
  return new;
end;
$$;

create trigger plaid_transaction_non_recurring_suggestion
before insert or update of non_recurring_bill, suggested_bill_id, matched_bill_id on public.plaid_transactions
for each row execute function public.bill_tracker_clear_non_recurring_suggestion();

grant update (non_recurring_bill) on public.plaid_transactions to authenticated;
