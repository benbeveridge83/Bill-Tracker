# Immediate deployment steps for this Bill Tracker

The database migration for project `bmiozjuhmytxlikracfv` was applied on August 22, 2026. The migration file remains in this package for source control.

## 1. Add the OpenAI secret

In Supabase:

1. Open the Bill Tracker project.
2. Open **Edge Functions** → **Secrets**.
3. Add `OPENAI_API_KEY`.
4. Optionally add `OPENAI_MATCH_MODEL` with value `gpt-5.6-luna`.

Do not place the key in the React/Vite `.env` file or GitHub Pages variables.

CLI equivalent:

```bash
supabase secrets set   OPENAI_API_KEY=YOUR_KEY   OPENAI_MATCH_MODEL=gpt-5.6-luna   --project-ref bmiozjuhmytxlikracfv
```

## 2. Deploy the Edge Functions

From the `bill-tracker-live` folder:

```bash
supabase functions deploy plaid-create-link-token --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-exchange-public-token --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-sync-transactions --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-disconnect-item --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy bill-match-action --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy ai-match-bills --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
```

The functions authenticate the Supabase user inside the function even though `--no-verify-jwt` is used at the gateway.

## 3. Publish the React app

Replace the repository contents with this package and push to `main`. The existing GitHub Pages workflow will build and publish the app.

## 4. Configure the app

1. Open **Plaid**.
2. Click **Sync balances & transactions**.
3. Assign one account to **Household** and one to **Business**.
4. Edit each bill and choose:
   - **Ask me to approve it**;
   - **Mark paid automatically when confidence is high**; or
   - **Do not match this bill**.
5. Open **Transactions**, choose a month, and click **Find … bill payments**.
6. Approve/reject suggestions.
7. Use **Not identified as bills** + **Uncharacterized only** to work through the remaining transactions.
8. Open **Spending** to see cash flow, checks, transfers, and category totals.
