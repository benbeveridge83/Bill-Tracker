-- A review flag on an individual bank transaction, independent of spending category.
alter table public.plaid_transactions
  add column if not exists possible_fraud boolean not null default false;

create or replace function public.bill_tracker_clear_fraud_suggestion()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.possible_fraud and new.matched_bill_id is null then
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

create trigger plaid_transaction_clear_fraud_suggestion
before insert or update of possible_fraud, suggested_bill_id on public.plaid_transactions
for each row execute function public.bill_tracker_clear_fraud_suggestion();

grant update (possible_fraud) on public.plaid_transactions to authenticated;
