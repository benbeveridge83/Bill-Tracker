# Bills & Budget v0.3.0

Bills & Budget is a React/Vite application backed by Supabase. Plaid imports bank balances and transactions; bill reconciliation and spending classification now run on the secure server side.

## v0.3.0 features

- Assign **Household** bills to one connected bank account and **Business** bills to another.
- Per-bill bank matching modes:
  - **Review**: suggest a transaction and wait for approval.
  - **Automatic**: mark the month paid only for a high-confidence local or learned match.
  - **Off**: never match that bill.
- Approving a match learns the normalized bank wording and typical amount for the bill/account.
- Rejecting a suggestion suppresses that bill/transaction pairing.
- Monthly AI reconciliation through the OpenAI Responses API, with structured match output.
- Tracker cells show **BANK** for confirmed Plaid payments and **REVIEW** for suggestions; clicking the month displays the underlying transaction.
- Transaction workspace with filters for:
  - identified bills,
  - bill suggestions,
  - transactions not identified as bills,
  - characterized/uncharacterized transactions,
  - money in/out,
  - checks,
  - transfers.
- Spending page with monthly money in, money out, net cash flow, checks, transfers, characterized spending, uncharacterized spending, and category totals.
- Manual spending categories and optional exclusion from spending totals.
- Plaid personal-finance category, payment-channel, check-number, counterparty, transfer, and check metadata are stored when available.

## Security model

- Plaid access tokens and the OpenAI API key remain in Supabase Edge Function secrets.
- The browser receives bank account display fields and imported transaction rows, but never a Plaid access token.
- The AI matcher sends only the bill/transaction fields needed for reconciliation. It does not send Plaid credentials, access tokens, or bank account numbers.
- All browser tables use Row Level Security tied to `auth.uid()`.
- Edge Functions still validate the caller's Supabase access token even though the deployment flag is `--no-verify-jwt`.

## 1. Install and build

```bash
npm install
npm run lint
npm run build
```

The Vite base path remains `/Bill-Tracker/` for GitHub Pages.

## 2. Apply the new database migration

The original schema migration is:

```text
supabase/migrations/20260725_bill_tracker.sql
```

Apply the v0.3.0 migration after it:

```text
supabase/migrations/20260822_bank_matching_budget.sql
```

With the Supabase CLI:

```bash
supabase db push --project-ref bmiozjuhmytxlikracfv
```

## 3. Edge Function secrets

The existing Plaid secrets remain required:

```bash
supabase secrets set \
  PLAID_CLIENT_ID=... \
  PLAID_SECRET=... \
  PLAID_ENV=sandbox \
  SUPABASE_URL=https://bmiozjuhmytxlikracfv.supabase.co \
  SUPABASE_SERVICE_ROLE_KEY=... \
  --project-ref bmiozjuhmytxlikracfv
```

Add the OpenAI key only as a Supabase secret:

```bash
supabase secrets set \
  OPENAI_API_KEY=... \
  OPENAI_MATCH_MODEL=gpt-5.6-luna \
  --project-ref bmiozjuhmytxlikracfv
```

`OPENAI_MATCH_MODEL` is optional. The function defaults to `gpt-5.6-luna`.

Do not place either the Plaid secret or OpenAI API key in `.env`, Vite variables, GitHub Pages, or browser JavaScript.

## 4. Deploy Edge Functions

```bash
supabase functions deploy plaid-create-link-token --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-exchange-public-token --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-sync-transactions --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy plaid-disconnect-item --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy bill-match-action --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
supabase functions deploy ai-match-bills --no-verify-jwt --project-ref bmiozjuhmytxlikracfv
```

## 5. Normal workflow

1. Open **Plaid** and connect/sync the institution.
2. Assign a connected account to **Household** and another to **Business**.
3. Edit each bill and choose **Review**, **Automatic**, or **Matching off**. Add comma-separated bank keywords when useful.
4. Open **Transactions**, choose the month, and click **Find … bill payments**.
5. Approve or reject suggestions. Approval creates the monthly tracker mark, adds the pay-log entry, and learns the bank wording.
6. Use **Not identified as bills** plus **Uncharacterized only** to work through the remaining transactions.
7. Open **Spending** for monthly totals and category comparisons.

## Matching behavior

Automatic confirmation is intentionally conservative:

- learned wording plus a similar amount, or
- a strong bill-name/keyword match plus an amount within the bill's tolerance.

An AI-only match is presented for review rather than silently marking a bill paid. Once approved, the exact wording becomes a learned rule and can support automatic confirmation in later months.

## GitHub Pages

The included GitHub Actions workflow publishes `dist/` when changes are pushed to `main`. Repository variables still need:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
```

These are public browser configuration values. Never use the service-role key as the anonymous key.
