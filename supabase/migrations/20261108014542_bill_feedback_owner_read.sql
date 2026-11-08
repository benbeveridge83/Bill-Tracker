-- The picker needs the signed-in owner's rejection history to suppress guesses.
create policy "bill feedback owner read"
  on public.bill_match_feedback for select to authenticated
  using ((select auth.uid()) = user_id);
grant select on public.bill_match_feedback to authenticated;
