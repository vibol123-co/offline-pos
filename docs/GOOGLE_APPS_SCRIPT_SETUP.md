# Google Apps Script deployment

The cloud app is hosted by Apps Script HTML Service. GitHub is intended to hold the source; GitHub Pages is not the runtime host because the app uses `google.script.run` to avoid a cross-origin API.

## One-time setup

1. Create a private Google spreadsheet named `Bakery POS`.
2. From that spreadsheet, open **Extensions > Apps Script** so the project is bound to the master spreadsheet.
3. Add every `.gs` file from `apps_script/` as a script file. Add `index.html`, `Styles.html`, and `Client.html` as HTML files, preserving the names.
4. In **Project Settings**, set the time zone to `Asia/Phnom_Penh`. Copy the manifest settings from `apps_script/appsscript.json` if the editor has not created them already.
5. In the function selector, run `setupBakeryPos`. Approve the requested spreadsheet, Drive, and trigger permissions. This creates the data tabs, default settings, a private Drive backup folder, and one daily backup trigger.
6. Deploy as a **Web app**. Choose the most restrictive access option available for the staff Google accounts. Do not allow anonymous access. Prefer **execute as the user accessing the app** and share the spreadsheet with each staff account; staff must authorize access.
7. Open the deployment URL on the PC, iPad, and Android phone. Bookmark it or add it to the device home screen.

The app's data API is accessed only through Apps Script HTML Service. Do not copy spreadsheet credentials or secrets into browser JavaScript.

## Daily backups

`setupBakeryPos` creates a time-driven trigger for around 2:00 AM in the project time zone. Apps Script triggers run within Google's scheduled time window, not at an exact minute. Each run copies the entire spreadsheet into the private `Bakery POS Backups` Drive folder. Copies older than the configured 30-day retention are moved to Trash. Backup results are recorded in the `BackupLog` tab.

These are Google Sheets file copies, not `.sqlite3` files. To restore, open a dated copy, verify its data tabs, and restore its contents to the master spreadsheet before resuming sales. Test the restore procedure before relying on backups.

## Using the devices

This deployment requires internet access for live shared data. Open clients check for changes every 30 seconds, so updates are near-real-time rather than push-based. The browser keeps a local snapshot and queues supported writes in IndexedDB when an already-open page detects that it is offline. Queued actions are validated again when sent to the shared spreadsheet, so an item that has gone out of stock or changed price may need staff review. The Apps Script page itself is not guaranteed to reopen while the device is offline.

The New Order screen can look up customers by phone from saved orders and produces a printable itemized receipt. Its payment QR area is a placeholder until the shop provides an image. Delivery fees are stored in the selected order currency and included in the total; the current tax setting applies to discounted items, not the delivery fee.

Apps Script and Sheets have usage quotas and no POS uptime guarantee. Monitor the Apps Script **Executions** page and the `BackupLog`; periodically test restore and stock reconciliation.

## Inventory behavior

Use stock item categories for ingredients, packaging, finished goods, and accessories. Purchases and quotes preserve their date, supplier, currency, quantity, and cost for price history. Linking a finished product or add-on to a stock item reserves stock when the order is created and releases it if the order is cancelled. Ingredient consumption by recipes is not automated; record production, waste, and corrections as explicit stock movements.
