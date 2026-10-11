# Tally — Android app

Your `tally-local.html` shop ledger, packaged as a native Android app (Capacitor).
It works fully offline. All data is stored on the phone.

## Get the APK (no Android Studio needed)

1. Create a free GitHub account and a new **private** repository.
2. Upload everything in this folder to it (drag and drop in the browser works).
3. Open the repo's **Actions** tab, choose **Build Android APK**, press **Run workflow**.
4. After about 5 minutes, open the finished run and download **tally-apk**.
   (Add the signing secrets first, see "Updating an app a client already has", so updates will work.)
5. Unzip it, send `tally.apk` to the phone, tap it, and allow
   "Install unknown apps" when asked.

## Or build it yourself (Android Studio)

Needs Node 22+ and Android Studio (with JDK 21).

    npm install
    npm run sync
    npm run open        # opens Android Studio; press Run, or Build > Build APK(s)

## What changed from the HTML file

- React and fonts are bundled inside the app, so no internet is ever needed.
- Layout adapts to phone screens (two-column cards, stacked checkout, scrolling tables).
- "Print receipt" opens Android's print dialog (printer or Save as PDF).
- "Share / save .txt" and "Save / share backup" use the Android share sheet
  (Save to Drive/Files, WhatsApp, email).
- Fixed: on a brand new install the default `admin` / `admin123` login
  could be rejected until the app was restarted.

## Updating an app a client already has (IMPORTANT)

Android only installs a new APK **over** an installed app (keeping all its data) when
(1) the package name is the same (`com.tally.shopledger`, unchanged), (2) the new APK has a higher
version number (the workflow does this automatically), and (3) it is **signed with the same key**.

Builds made without a fixed signing key get a random key every time, so they can NOT update each other.

### Set up the permanent signing key (once)
1. In your GitHub repo: Settings > Secrets and variables > Actions > New repository secret.
2. Add the four secrets listed in `tally-keystore-secrets.txt` (KEYSTORE_BASE64, KEYSTORE_PASSWORD, KEY_ALIAS, KEY_PASSWORD).
3. Run the **Build Android APK** workflow. The artifact `tally-apk` is now signed with your permanent key.
   Keep `tally-release.jks` and the secrets file safe: if you lose them, installed apps can never be updated again.
4. From now on every build you make from this repo installs as an update over the previous one.

### Client who already has the first version (no activation)
1. Try installing the new APK over the old one. If Android accepts it, their data is kept and the
   activation screen appears. If it says "App not installed" or refuses, nothing is lost, so use the safe route below.
2. Safe route: in the OLD app, **Settings > Backup & restore > Save / share backup**, and send the file to
   yourself (WhatsApp/Drive). Check that you really have it.
3. Uninstall the old app, install the new APK.
4. On the activation screen the client sends you their **Device ID**; you make a code in the license generator; they paste it in.
5. Sign in with `admin` / `admin123`, then **Settings > Restore from backup...** and choose the file.
   Everything (products, sales, customers, staff accounts) comes back; then sign in with the usual account.
   (The activation is kept separately and is not affected by restoring.)

Note: the old no-activation version keeps working on their phone until they replace it; an app already
installed cannot be switched off remotely. Make sure your client agrees to install the new version.

## Camera barcode scanning

Works offline using the phone's rear camera (no Google services needed). The first time, Android asks
to allow the camera: tap **Allow**.

- **Checkout:** tap **Scan** next to the scan box. The camera stays open: point at each item and it is
  added to the cart with a beep and vibration (a low buzz means not found / out of stock). Same item
  twice in a row: pause about 1.5 seconds between scans (this prevents accidental double adds).
- **Inventory:** the camera button beside **Barcode** in the product form fills in the barcode
  (refuses one that already belongs to another product). The camera button in the search bar finds a product.
- **Purchases:** **Scan items** while receiving a delivery. Each scan adds 1 to that product's line.
- Reads EAN-13/EAN-8, UPC-A/E, Code 128, Code 39, ITF and QR. Hold the barcode **horizontal**; use the
  light button in dim shops. Scanning by SKU label also works if the label shows the SKU as a barcode.
- Bluetooth/USB barcode scanners that type like a keyboard keep working in the Checkout box.

## Bulk inventory import

Inventory > **Import / export** (owner/admin only).

- Upload an **.xlsx, .xls or .csv** file, or paste rows copied from Excel / Google Sheets.
- First row must be headers: `name, sku, barcode, category, cost, price, stock, low_stock`.
  Only **name** and **price** are required. Common alternatives are understood too
  (Product Name, Selling Price, Buying Price, Qty, Reorder Level, ...). Blank SKUs get an automatic one (IMP-0001...).
- You see a preview first: how many are new, how many already exist, and every problem row
  (with its row number). Problem rows are skipped; nothing is imported until you confirm.
- Products that already exist (matched by SKU, or barcode if no SKU) can be: updated
  (stock set to the file's number), restocked (file's number added to current stock), or left alone.
- Stock is applied to the branch you are currently working in.
- **Download template** gives a ready-to-fill CSV. **Export current stock** gives your inventory
  in the same format, so you can edit it in Excel and import it back.
- Barcodes: format that column as **Text** in Excel, or long barcodes get turned into 6E+12 style
  numbers. The app detects this and refuses those rows rather than saving wrong barcodes.

## Selling it: activation codes

The app asks for an activation code the first time it opens. Each code works on one phone only.

1. The customer installs the app and sees a **Device ID** (like `K7QM2-X9RTP`). They tap **Send ID…** to message it to you.
2. You open `tools/license-generator.html` in any browser (phone or computer), paste your
   **private key** once, enter their Device ID, their shop name and the license length
   (lifetime, 30 days, 1 year, custom), and press **Generate**.
3. Send them the code. They paste it into the app and it unlocks.

Notes:
- The app contains only the **public** key. It can check codes but cannot make them.
- **Keep the private key secret and backed up.** Anyone who has it can create codes, and if you lose it you cannot issue new ones.
- Reinstalling the app or clearing its data creates a new Device ID, so that customer needs a new code. You decide whether to issue it.
- Time-limited codes expire by the phone's clock (the app also notices if the clock is wound back).
- Put your contact (e.g. WhatsApp number) in `src/license-config.js` (`contact`) so it shows on the activation screen, then rebuild.
- The generator keeps a list of codes you issued, in that browser only. Use "Download list (.csv)" to keep a record.
- Honest limit: this stops casual sharing and copying. A determined person with Android skills can still modify an APK. For stronger protection, also publish via Google Play and keep the app signed with your own release key.

## Important

- Data lives only on the phone. Uninstalling the app erases it.
  Use Settings > backup regularly and keep the file somewhere safe (Drive, WhatsApp to yourself).
- Change the default admin password under Team after first login.
- The debug APK is fine for your own phones. To publish on Google Play you need a
  signed release build (Android Studio: Build > Generate Signed Bundle).

## Editing the app

The app code is `src/app.jsx`. After changing it run `npm run sync`, then rebuild.
