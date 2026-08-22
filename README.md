# Bills & Budget v0.2.0

This version moves Bills & Budget from browser-only storage to Supabase and adds a secure Plaid connection flow.

## Already completed

- Dedicated Supabase project: `Bill Tracker` (`bmiozjuhmytxlikracfv`)
- User authentication and user-owned database rows protected by Row Level Security
- Plaid Link token creation and public-token exchange
- Balance and transaction synchronization with Plaid `/transactions/sync`
- Bank disconnection and server-side token removal
- One-click import of the existing browser profile, tracker marks, and pay log
- GitHub Pages build/deployment workflow
- Visible app version `0.2.0`

Plaid access tokens and the Plaid secret never enter the browser or GitHub repository.

## Step 1 — Add your Plaid credentials

Open PowerShell in this project folder. Sign in to the Supabase CLI, then run the secret command with values copied from **Plaid Dashboard → Keys**. Do not paste those values into source files.

```powershell
npx -y supabase@2.114.0 login
npx -y supabase@2.114.0 secrets set --project-ref bmiozjuhmytxlikracfv PLAID_CLIENT_ID="PASTE_YOUR_CLIENT_ID" PLAID_SECRET="PASTE_YOUR_SANDBOX_SECRET" PLAID_ENV="sandbox"
```

Start with Sandbox. When the app is ready for real banks, repeat the second command using the Production secret and `PLAID_ENV="production"`.

## Step 2 — Configure Supabase email links

In the [Bill Tracker Supabase project](https://supabase.com/dashboard/project/bmiozjuhmytxlikracfv):

1. Open **Authentication → URL Configuration**.
2. Set **Site URL** to `https://benbeveridge83.github.io/Bill-Tracker/`.
3. Add the same address under **Redirect URLs**.

## Step 3 — Add GitHub repository secrets

In `benbeveridge83/Bill-Tracker`, open **Settings → Secrets and variables → Actions** and add:

| Name | Value |
| --- | --- |
| `VITE_SUPABASE_URL` | `https://bmiozjuhmytxlikracfv.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_j0im7g13snJOuIWUZTgfLQ_QYSHYDZn` |

Then open **Settings → Pages** and choose **GitHub Actions** as the deployment source.

## Step 4 — Test locally

Create `.env.local` in this folder with the same two public frontend settings:

```text
VITE_SUPABASE_URL=https://bmiozjuhmytxlikracfv.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_j0im7g13snJOuIWUZTgfLQ_QYSHYDZn
```

Then run:

```powershell
npm install
npm run build
npm run dev
```

## Step 5 — Push the update

After placing these files in your existing `Bill-Tracker` repository:

```powershell
npm install
npm run build
git add .
git commit -m "Add secure Plaid bank connections v0.2.0"
git push origin main
```

The GitHub workflow builds and publishes the app automatically.

## First use and data migration

1. Before deploying, leave the current live page/browser data intact.
2. After deployment, create your new app login and confirm your email if prompted.
3. On Dashboard, click **Import existing browser data**. This reads the old profile from the same browser and moves its bills, tracker marks, and pay log into your private Supabase account.
4. Open **Bank connections** and click **Connect bank account**.
5. In Sandbox, use Plaid's test credentials: username `user_good`, password `pass_good`, and verification code `1234` if requested.
6. Click **Sync balances & transactions**.

Do not clear browser storage or use the old app's Reset button until the import reports success.

## Production notes

- Plaid suggestions never automatically mark bills paid.
- Real bank connections require Plaid Production access and the Production secret.
- OAuth-capable banks work on desktop web without a custom redirect page. A dedicated redirect flow can be added later for embedded mobile webviews.
- The frontend uses only the public Supabase publishable key. Server and Plaid secrets remain protected in Supabase.
