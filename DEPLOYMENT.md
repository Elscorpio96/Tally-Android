# Ilelah Business Suite — deployment, backup and cost guide (Cloud mode, v1.12)

Everything here is optional per shop. A phone that is never switched stays in **Local mode** and behaves exactly as before.

## 1. What runs where

| Piece | Where | Secret? |
|---|---|---|
| Phone app (APK) | the shop's Android phones | holds only the **public** project URL + anon key |
| Database, logins, row security, sale/stock functions | your Supabase project | database password = secret |
| `create-staff` function | Supabase Edge Function | uses the service key **inside Supabase only** |
| Owner dashboard | any static web host (a folder of files) | public URL, sign-in required |
| Backups | private GitHub repo (Actions) | DB connection string + passphrase = secrets |

The service-role key is never in the app, the dashboard, the zips or the repo. `build.mjs` and `build-dashboard.mjs` refuse to build if one is configured.

## 2. Configuration (environment)

`cloud.config.json` next to `package.json` (not committed, not zipped):
```json
{ "url": "https://<ref>.supabase.co", "anonKey": "<public anon / publishable key>" }
```
Or set `SUPABASE_URL` and `SUPABASE_ANON_KEY` when building. No file/variables = Local-only build.

## 3. First-time setup (once per Supabase project)

1. Create the project (free plan is fine to start; see §8).
2. SQL Editor → run `supabase/migrations/0001` … `0007` in order. **If you already ran 0001–0006, run only `0007_discounts.sql`** (adds discounts, regular-customer %, and cashier same-day price correction) (it also repairs two things found in testing: a function that needed an extension Supabase keeps out of reach, and a retry race on purchases).
3. Authentication → Email enabled, minimum password length 8.
4. `supabase functions deploy create-staff` (see `supabase/SETUP.md`).
5. Build and install the app (`npm run sync`, then your usual signed release). Version 1.12 / versionCode 13.
6. Build and publish the dashboard: `npm run build:dashboard`, upload `dashboard-dist/` to any static host.

## 4. Rolling a shop onto the cloud (recommended order)

1. Install v1.10 on all phones. Nothing changes yet.
2. On the owner's phone: Settings → Cloud account → create the owner account → **Switch this phone to Cloud mode** and follow the steps (backup file → compare → confirm → replace → verify). Keep the backup file.
3. Add staff logins (Settings → Cloud account → Add staff login).
4. Other phones: sign in to the cloud account, then switch. They will show the differences and ask for `REPLACE`, because the cloud already holds the shop's records.
5. Run one pilot shop for a week before moving the next one.

**Rollback for a phone:** Settings → Restore the backup taken before switching (puts back the exact pre-switch records, Local mode). Or *Leave Cloud mode* (keeps what is on the phone, stops syncing, only allowed when nothing is waiting to send).
**Rollback for the whole shop:** every phone has its own pre-switch snapshot plus the backup file the owner saved. Local mode never needed the cloud.

## 5. Backups (the free plan has none of its own)

* **Nightly, automatic:** `.github/workflows/supabase-backup.yml` in a **private** GitHub repo. Add secrets `SUPABASE_DB_URL` (Supabase → Connect → *Session pooler* string; the direct one is IPv6-only) and `BACKUP_PASSPHRASE`. Each night it dumps the shop data **and logins**, encrypts with AES-256, keeps 30 days as a build artifact. The nightly connection also counts as activity, which keeps a free project from pausing.
* **By hand:** `SUPABASE_DB_URL=… supabase/backup/backup.sh ./backups` (needs `pg_dump`).
* **Offsite copy:** once a month download the latest `.gpg` artifact to somewhere that is not GitHub.
* **Phones:** Settings → Save / share backup still works in both modes.
* Paying for Pro adds Supabase's own daily backups (7 days); keep the nightly job anyway.

### Restore (practice this once before you need it)
1. Same project, data damaged: decrypt (`gpg -d file.gpg > file.dump`), then `TARGET_DB_URL=… supabase/backup/restore.sh file.dump` into a fresh project, or into the same project after clearing the `public`/`app` schemas.
2. New project: create it, do **not** run the migrations, run `restore.sh` (it restores logins first, then shop data), point the app build's `cloud.config.json` at it, rebuild.
3. Check: sign in as the owner and run `select cloud_totals();` in the SQL editor; compare with totals you noted earlier.
The drill was run for real on PostgreSQL 16 in testing: same row counts in every table, same money totals, stock still equals its movements, row security and the append-only audit log intact, new sales accepted afterwards.

## 6. Routine care
* Monthly: restore drill into a scratch project or local Postgres; look at database size (Dashboard → Reports → Database).
* Check the sync chip on each phone at close of day: it should say **Synced**. "N failed" means the server refused something; open it and read why.
* Staff leaving: Settings → Cloud account → Disable. Their phone stops being able to sell as soon as it reaches the internet.

## 7. What was tested, and what was not
**Tested (automated, ~370 database/logic checks + ~35 browser checks):** tenant isolation and forged IDs; role limits; atomic stock with sales; idempotent retries; invoice uniqueness; audit log append-only; import with verification; the whole switch including failure and restore; offline queue and restart; 60 parallel sales from 6 connections without deadlock or lost stock; 12 simultaneous copies of one sale, repayment, purchase, stock adjustment or void each applied once; stock never negative under the *reject* policy under a 14-way race; double-tapped import; backup → new database → restore.
**Not yet tested:** a real Supabase project end to end (Auth e-mail flow, the deployed `create-staff` function, realtime), a real Android device with a flaky network, and a shop with years of history on the phone's ~5 MB browser storage (cloud mode keeps full history on the phone; windowing/IndexedDB is future work). Do the pilot in §4 with this list in mind.

## 8. Cost (Supabase pricing page, checked 14 Oct 2026 — prices change; confirm before quoting a customer)

| | Free | Pro |
|---|---|---|
| Price | $0 | from $25/month per project (includes $10 compute credit) |
| Database | 500 MB | 8 GB, then $0.125/GB |
| Downloads (egress) | 5 GB/month | 250 GB |
| Backups | none | daily, 7 days |
| Pausing | after 1 week of no activity | never |
| Realtime | 200 connections, 2M messages | 500, 5M |
| Edge function calls | 500,000 | 2M |

**How far the free database goes.** One sale with its lines, stock movement and audit entries measured about **2.4 KB**. Keeping 30% free for indexes and growth leaves ~350 MB ≈ **150,000 sales** across *all shops in the project*:

| Sales per day (all shops together) | Free plan lasts about |
|---|---|
| 50 | 8 years |
| 100 | 4 years |
| 300 | 16 months |
| 1,000 | 5 months |

Pro's 8 GB holds roughly 2.4 million sales on the same arithmetic. Rule of thumb: **up to ~3 small shops → free is enough for 1–2 years; more than that, or any shop that cannot tolerate a pause → Pro at $25/month**, shared by all the shops in the project (e.g. $5/shop at 5 shops).

**Downloads:** phones ask the server a tiny "has anything changed?" question every minute (≈0.3 KB) and only download what changed; a full refresh happens every 15 minutes at most. Expect tens of MB per phone per month, far below 5 GB. Backups add a few MB per night.

**Other costs:** dashboard hosting on a free static host ($0; confirm that host's current terms), GitHub private repo + Actions for backups ($0 at this size on the free tier; confirm), optional domain name (varies), your own time for monthly checks. SMS/e-mail are not used.

Sources: [Supabase pricing](https://supabase.com/pricing).

## 9. Discounts, history and corrections (v1.12)
* **Discounts:** per line and per sale, as ₦ or %. Stored per line (price before discount + ₦ discount), so receipts, reports, Excel and the cloud all agree. Any cashier may give discounts. Not built: an owner-set cap on how large a cashier discount can be.
* **Regular customers:** a customer can carry a standing %. Typing their name at checkout fills it in; the cashier can change or clear it. Only the owner/manager sets it (Credit → customer, or "Make this their regular discount" at checkout). The server refuses anyone else.
* **History tab:** every user sees the sales they made (owner sees all, with branch filter); Today / Yesterday / 7 days / dates; search by customer, invoice no. or item; tap to reopen, print or share.
* **Corrections:** owner can change price and discount on any sale; a cashier only on their own sale of the same shop-day. Stock is not changed; credit balances recalculate; every change is written to the audit log (cloud).
* Cloud: run `0007_discounts.sql` once; tests `lines` and `discounts` are in `supabase/tests/run-all.sh`.

## 10. v1.11 — held sales and receipt layout
* **Hold:** in the cart, *Hold* parks the current sale (items, customer, discount) so another customer can be served; *On hold (n)* brings it back. Held sales live on that phone only and do not reserve stock; on resume, quantities are trimmed to what is still in stock. No database change.
* **Receipts** (screen, printed, image, text) now carry an S/N column, *Items* and *Total qty* lines, and smaller text.

## 11. v1.12 — staff password reset and shop code
* **Shop code** is shown (with Copy) in Settings → Cloud account for the owner/admin. If ever lost: Supabase → Table Editor → `shops` → `code`.
* **Staff passwords can never be viewed** (Supabase stores only a hash). Settings → Cloud account → tap the person → **Reset password** (type one or *Make one for me*, then *Share login details*). Owner can reset anyone but the owner; an admin can reset managers and cashiers. Each reset is written to the audit log.
* **You must redeploy the function once:** `supabase functions deploy create-staff` (it now also handles password resets). No SQL migration for this release.

## 12. v1.13 — dark mode, returns, PIN lock, setup wizard, undo
* **Cloud: run `supabase/migrations/0008_returns.sql` once** (after 0007). Local-mode shops need nothing.
* **Dark mode & text size** — account menu (top-right) → Appearance (Light / Dark / Follow phone) and Text size. Per phone; receipts always print white.
* **Today at a glance** — owner/admin home card: sales, cash collected, profit, refunds, credit given, low stock.
* **Returns / refunds** — open a receipt → Return items. Pick quantities, reason, restock yes/no. Credit sales: refund first reduces the customer's balance, any remainder is cash back. Sale total stays as sold; reports show Returned and Net. Day-close subtracts cash refunds. Who can: owner/admin always; in Local mode a cashier needs an owner/admin PIN (if no admin has a PIN, allowed). In Cloud mode only owner/admin (enforced by the server); cashiers see only the refunded total. Price editing is hidden once a sale has a return.
* **First-time setup wizard** — shows once for a new shop (business details → first product → done); can be skipped.
* **Undo & confirm** — Undo toast after removing a cart line, deleting a product or expense, discarding a held sale; confirm dialogs for risky actions.
* **PIN lock** — 4-digit PIN per user (account menu → PIN lock), auto-lock Off/1/5/15 min, 5 wrong tries = 30 s wait. Local mode: the lock screen lets another user sign in by PIN (fast cashier switch). Cloud mode: locks the current session only (no user switching; sign out to change user).
* **Limits** — PINs and held sales are per phone: not synced, not included in backups. PINs are never viewable. If a PIN is forgotten, On the lock screen tap "Forgot PIN? Sign out", then sign in again with the account password (Local and Cloud) and set a new PIN.
* Tests: `returns` added to `supabase/tests/run-all.sh`.

## 13. v1.14 — new logo, and how to update shops that are already live
**New logo:** launcher icon, round icon and the in-app logo (activation screen, sign-in, top bar) now use the Ilelah "IS" mark on navy. The splash screen is unchanged.

**Updating a shop that already uses the app (Local or Cloud):**
1. **Cloud shops only — run the SQL first.** In the shop's Supabase → SQL Editor run `0008_returns.sql` then `0009_edit_quantity.sql`, once each (skip any already run). It is additive: it adds one column + one index to `refunds` and replaces the `refund_sale` function. It does not touch sales, products, customers or users, and phones still on v1.12 keep working while it runs. Running it twice is harmless. The v1.13/v1.14 app also works *before* 0008 is run (only refunds from a cloud phone would fail until it is), so the order is not dangerous, but do SQL first.
2. **Back up before updating.** On each phone: Settings → Backup. For Cloud shops also download an Excel export of Reports.
3. **Install the new APK over the old one** — do not uninstall. It must be signed with the **same keystore** (`tally-release.jks`) and have a higher versionCode (now 16); otherwise Android refuses the update or, if the old app is uninstalled, the phone's data is lost. Local-mode data stays on the phone through an update.
4. **Phones can be updated one at a time.** v1.12 and v1.14 phones can sync with the same Supabase together. Until a phone is updated it will show a refunded sale at its full amount (it does not read refund totals); everything else matches.
5. Nothing changes for staff passwords, shop code, branches or licensing. Dark mode, PIN lock and text size start OFF/default on each phone.

## 14. v1.15 — edit quantity on a recorded sale
* Open a receipt → **Edit sale** (was "Edit prices") → change **quantity**, price and discount per item. Totals, amount owed and profit recalculate; **stock moves by the difference** (fewer sold = put back; more sold = taken off).
* Same permission as price edits: owner/admin any sale; cashier only their own sale from today. Quantity must stay above 0 — to take an item off completely use **Return items**. Not available once a sale has a return.
* Local mode refuses a quantity larger than the stock on hand. Cloud mode lets the server accept it and flags a stock discrepancy (same as an offline sale).
* **Cloud shops: run `supabase/migrations/0009_edit_quantity.sql` BEFORE updating phones** (it replaces `edit_sale_prices`; additive, safe to run twice, old phones keep working). A new phone talking to a database without 0009 would change the quantity on the phone but not in the cloud.
* Every quantity change is written to the stock ledger and the audit log (who, why, before/after). Tests added to `discounts.test.mjs` (29 pass).

## 15. Windows computer version (v1.16 look and feel)
The same app, in a Windows 10/11 desktop shell (Electron). One program contains both modes: **Local** (default, offline) and the optional **Cloud** mode, which only appears when the build was given the Supabase URL and public anon key.
* **Install:** run `Ilelah-Business-Suite-Setup-1.15.0.exe` (no administrator rights needed). It adds a Desktop and Start-menu shortcut.
* **Where records are kept:** `%APPDATA%\Ilelah Business Suite` on that PC. Updating or uninstalling does **not** delete them. Use Settings → Backup regularly, exactly as on the phone.
* **Activation:** same as the phone. The PC shows its own Device ID; make a code with the licence generator. A phone code does not work on a PC (each device has its own ID).
* **Update a PC:** run the newer Setup.exe over the old one. Records stay.
* **Building:** GitHub → Actions → *Build Windows installers* → Run workflow. It makes `...-Offline-Setup...exe` and, when the secrets `SUPABASE_URL` and `SUPABASE_ANON_KEY` exist (public anon key only), `...-Online-Setup...exe`. Download them from the run's *windows-installers* artifact.
* **Local build on a PC:** `npm ci`, `npm run build:web`, then in `desktop/`: `npm install` and `npx electron-builder --win nsis --x64`.
* A phone and a PC in the same shop only share data when both are in Cloud mode with the same shop code. In Local mode each device keeps its own records.
* Windows may show "Windows protected your PC" on first run because the installer is not code-signed; click *More info → Run anyway*.
* **PC layout (screens 1024 px wide and up):** left sidebar menu, top bar with page title and sync/branch/account, wider dashboard (sales card beside the day summary), two-column product lists, bigger cart panel, hover highlights. Phones and narrow windows keep the phone layout unchanged. The window opens maximised.
* **Keyboard shortcuts:** F2 new sale, F9 or Ctrl+Enter complete sale, Ctrl+K or / search, Alt+1…9 sidebar sections, Esc closes a window, F1 or ? shows the list.

## 16. Fix: "import_sale_total_mismatch" when switching a phone to Cloud mode (v1.16 / migration 0010)
* **Cause:** the one-time copy of a phone's records to the cloud did not know about line discounts (added in v1.13) or customer returns (v1.13). A sale whose items add up to ₦247,000 but was sold for ₦244,800 after a ₦2,200 discount was refused, and nothing was copied.
* **Fix:** run `supabase/migrations/0010_import_discounts_returns.sql` once in the Supabase SQL Editor (after 0009), then install the new app (Android v1.16 or the Windows v1.16.1 installers). The copy now carries each line's discount and each return (as history only; the phone's stock and balances already include them), and the server still refuses a sale whose figures do not add up.
* The old app can still be used with the fixed SQL for sales without discounts, but sales with discounts need the new app too, because only the new app sends the discount.

## 17. v1.17: the owner can add or delete an item on a finished receipt (migration 0011)
* **Where:** open a receipt (Sales history) → **Edit sale**. The owner sees a bin button on every item and **Add an item**. Cashiers and managers still only change quantity, price and discount.
* **Rules:** owner only; not allowed after a return on that sale; a receipt must keep at least one item (to cancel everything use Return items).
* **Stock:** a deleted item goes back on the shelf, an added item comes off it (Local mode refuses an added quantity above what is in stock).
* **Money:** the screen shows the difference before saving. Cash sale: "customer must pay ₦X more" or "give the customer back ₦X". Credit sale: the amount owed goes up or down by the difference. The receipt shows an **Edited** badge.
* **Cloud mode:** run `supabase/migrations/0011_revise_sale_lines.sql` once in the SQL Editor (after 0010) **before** installing the new app on phones. Every change is written to the stock ledger and the audit log. Only an owner/admin login is accepted by the server.
