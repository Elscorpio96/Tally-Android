# Connecting the app to your Supabase project (free plan)

Do this once. It takes about 20 minutes. Nothing here touches your existing shop data.

1. **Create the project.** supabase.com → New project (choose the region closest to Nigeria that is offered; note the database password somewhere safe). Free plan is fine.
2. **Create the database.** Dashboard → SQL Editor → run the files in `supabase/migrations/` **in order** (0001 → 0007). Each should end with "Success". (0005 = copy old phone data to the cloud, 0006 = what Cloud mode needs: stock adjustments, price edits, shop-wide totals check. 0007 = discounts, regular-customer %, cashier same-day price correction. If you already ran 0001–0006, run only 0007.)
3. **Authentication settings.** Authentication → Providers → Email: keep enabled. For staff logins to work, turn **"Confirm email" OFF** only if you want owners to sign up without a confirmation e-mail; staff accounts are created already confirmed by the server function either way. Set a minimum password length of 8.
4. **Deploy the staff function.** Install the Supabase CLI, then from this folder: `supabase login`, `supabase link --project-ref <your-ref>`, `supabase functions deploy create-staff`. Supabase supplies the service key to the function itself; **you never paste it anywhere**.
5. **Tell the app where the project is.** Create a file `cloud.config.json` next to `package.json`:
   ```json
   { "url": "https://<your-ref>.supabase.co", "anonKey": "<the 'anon' / publishable key>" }
   ```
   Use ONLY the public key (Project Settings → API → `anon` / publishable). The build refuses to run if it detects a service-role or secret key.
6. Build as usual (`npm run sync`). Settings now shows **Cloud account**. Create the owner account there, then add staff logins.

Leave `cloud.config.json` out and the app builds exactly as before (Local mode only, no Cloud section).

## Owner dashboard (web page)

1. With `cloud.config.json` in place (same file as the app), run `npm run build:dashboard`. The result is the folder `dashboard/dist` (three small static files).
2. Publish that folder on any free static host. Easiest: Cloudflare Pages or Netlify, "Deploy manually / drag and drop" the `dist` folder. You get a web address like `https://yourshop.pages.dev`.
3. Open it, sign in with the owner e-mail (or an admin/manager login plus the shop code). Managers only see their own branch; cashiers are refused.
4. It updates by itself when sales arrive (no refresh needed). Only the public key is inside the page; people can only read what their login is allowed to read.

Note: until phones are switched to cloud mode (next step), the dashboard shows the data you copied with "Copy my existing shop data to the cloud".


## Switching a phone to Cloud mode (v1.9)

Existing phones stay in **Local mode** until the owner chooses to switch. Nothing changes for anyone who does not.

Owner, on the phone that holds the shop's records: Settings → Cloud account → sign in → **Switch this phone to Cloud mode**. The app walks through:

1. **Backup.** Saves a backup file (you confirm you stored it) and keeps a second exact copy inside the app.
2. **Compare.** If the cloud shop is empty, the phone's records are copied there (verified by the server; any mismatch cancels the copy). Then product, customer, sale, credit, stock, repayment, expense and purchase totals are compared, row by row.
3. **Confirm.** Switching is only offered when every row matches. If the cloud already holds different records (a second phone, or a returning phone) the owner must type `REPLACE`.
4. **Replace** the phone's records with the cloud copy. 5. **Verify** the stored records and totals again.
6. If anything fails, the backup is put back automatically and the phone stays in Local mode. Afterwards, Settings has **Restore the backup taken before switching** and **Leave Cloud mode**.

Rules in Cloud mode: every change is saved on the phone first and queued; the top-bar chip shows Synced / N waiting / N failed; a record counts as sent only after the server confirms it. Staff sign in with their cloud login (first sign-in needs internet; later sign-ins work offline). Records already waiting on a phone belong to the person who made them, so a different person can only sign in once the queue is empty. Reset-figures, reset-everything and restoring a backup file are switched off in Cloud mode.

## Running the tests

`cd supabase/tests && npm i @electric-sql/pglite && ./run-all.sh` (Node 22+). They run the real migrations on an in-memory PostgreSQL and cover tenant isolation, atomic sales, import, the upload queue, the switch (including failure and restore) and Cloud-mode edits.
