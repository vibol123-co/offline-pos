# Bakery POS

Cloud-first bakery POS for a small team. The target runtime is Google Apps Script HTML Service, with Google Sheets as the shared operational data store and daily spreadsheet-copy backups in Google Drive.

## Project layout

```text
.
├── apps_script/               Deployable Apps Script files and responsive POS screens
├── docs/ARCHITECTURE.md       Business and data architecture
├── docs/GOOGLE_APPS_SCRIPT_SETUP.md
├── src/bakery_pos/            Earlier local Python/SQLite prototype
├── tests/                     Tests for the local Python/SQLite prototype
├── data/                      Local SQLite file; not connected to the cloud sheet
└── pyproject.toml             Local prototype dependencies
```

The Apps Script project serves the browser app itself, so the browser uses `google.script.run` instead of calling a cross-origin Apps Script API from GitHub Pages. GitHub is for source control; GitHub Pages is not the production app host in this design.

## Deploy the cloud app

Follow [Google Apps Script deployment](docs/GOOGLE_APPS_SCRIPT_SETUP.md). Create a private master spreadsheet, bind an Apps Script project to it, add the source files from `apps_script/`, run `setupBakeryPos`, then deploy the web app with access restricted to staff Google accounts.

The cloud app includes Dashboard, New Order, Orders, Products & Add-ons, Suppliers, Stock & Price History, Reports, and Settings & Backup screens. New Order supports tap-to-add catalog cards with separate product sizes, saved-customer lookup by phone, delivery location/fees, and a printable receipt. The receipt's payment QR area is a placeholder until the shop provides its image. It supports USD and KHR without automatic currency conversion. Supplier purchase receipts and quotes are retained for historical unit-cost comparison.

## Backup approach

An Apps Script daily trigger copies the full master spreadsheet into a private Drive folder and retains the latest 30 days. These are native Google Sheets copies, not SQLite files. They can be inspected and restored in Google Sheets. The current local [SQLite database](data/bakery_pos.sqlite3) is a separate, empty development database; it does not sync from Google Sheets.

## Important limitations

- The previous Python/SQLite app remains a local prototype; it is not the live shared cloud app.
- Shared cloud data and the Apps Script UI require internet access. An already-open page can queue supported actions in IndexedDB while offline; those actions are revalidated when connectivity returns.
- Apps Script quotas and availability are controlled by Google. Check the execution log and `BackupLog`, and test restore procedures before using the system for live sales.
- Recipe-based ingredient consumption, refunds, and a full accounting workflow are not implemented.

