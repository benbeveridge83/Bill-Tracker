create table if not exists public.hidden_spending_categories (
  user_id uuid not null references auth.users(id) on delete cascade,
  category_name text not null,
  primary key (user_id, category_name)
);

alter table public.hidden_spending_categories enable row level security;
create policy "hidden spending categories owner select" on public.hidden_spending_categories for select to authenticated using ((select auth.uid()) = user_id);
create policy "hidden spending categories owner insert" on public.hidden_spending_categories for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "hidden spending categories owner delete" on public.hidden_spending_categories for delete to authenticated using ((select auth.uid()) = user_id);
grant select, insert, delete on public.hidden_spending_categories to authenticated;
