# Bakery POS: Cloud Architecture

**Status:** Apps Script source and responsive screens are in the workspace; local mocked browser smoke tests pass, while Google account setup, deployment, and live Sheet validation remain required.  
**Business:** One small bakery, one to three staff, PC/iPad/Android, USD and KHR, bakery items and add-ons, walk-in/advance/custom-cake orders, suppliers, and stock-cost history.

## Architecture decision

```text
PC / iPad / Android browser
        ↓
Apps Script HTML Service (responsive HTML/CSS/JS)
        ↓ google.script.run
Client DataService → Apps Script domain services
        ↓
Google Sheets (shared operational source of truth)
        ├── IndexedDB snapshot/outbox on an already-open device page
        └── Daily Apps Script trigger → dated Drive spreadsheet copies
```

Apps Script hosts the UI and backend together. This avoids the GitHub Pages-to-Apps-Script cross-origin problem. The GitHub repository remains the source-control location; GitHub Pages is not the application host. Apps Script deployment requires an owner-provided Google spreadsheet, staff account access, authorization, and a deployment URL.

The earlier Python/SQLite implementation remains a local prototype only. It is not the shared cloud data path and does not receive Sheet updates. A later Python export/import tool can create a local SQLite database from an export if needed.

## Service and storage boundaries

- **Screens:** Dashboard, New Order with tap-to-add product cards, separated checkout totals, and a printable receipt, Orders, Products & Add-ons, Suppliers, Stock & Price History, Reports, and Settings & Backup. The receipt QR area is a placeholder until the shop provides its payment image.
- **Browser `DataService`:** Uses `google.script.run` for all server requests, including phone-based customer lookup; screens do not use Google Sheet APIs directly.
- **Apps Script domain functions:** Validate data, compute order totals, update fulfillment/payment records, receive stock, record quotes, and prepare reports.
- **Sheet repository:** Owns the tab schema, stable IDs, update/append helpers, locking, and idempotency log.
- **Google Sheets:** Shared online source of truth. All staff should access data through the app; do not hand-edit data tabs.
- **Google Drive:** Stores dated copies of the master spreadsheet. No daily SQLite file is produced.

`LockService` serializes mutations across staff and devices. Mutating requests use stable request IDs so a retried browser action does not create duplicate orders, payments, purchases, or stock movements. Sheets are not transactional; the implementation validates all order/purchase lines before writing and keeps the data set modest.

## Business data

- **Products and add-ons:** Stable IDs, active state, and independent USD/KHR prices in integer minor units (USD cents; KHR whole riel). Bakery products can have a catalog size/option, so each size is selected and priced as its own item. An optional link to a finished-product or accessory stock item enables stock reservation.
- **Orders and order lines:** Customer/contact details, location, delivery fee, walk-in/advance/custom-cake type, walk-in/Grab/other channel, pickup/delivery fulfillment, pickup time, currency, price snapshots, tax/discount, notes, custom-cake details, and retained status history. Delivery fees are included in totals; configured tax applies to discounted items, not the delivery fee.
- **Payments:** Cash/card-terminal/other records, deposits, amount paid, and remaining balance. No card credentials are collected.
- **Suppliers:** Contact details and status.
- **Inventory items:** Separate ingredient, packaging, finished-product, and accessory records with base units and low-stock threshold.
- **Purchase receipts and lines:** Supplier, received date, quantity in base units, total cost, and purchase currency. A quote table separately records supplier offers. Together these support unit-cost comparisons over time and by currency.
- **Stock movements:** Append-only receipts, sales reservations, cancellation releases, waste, and adjustments. On-hand is derived from movements rather than overwritten. Linked finished goods/add-ons reserve on order creation and are released on cancellation.

No automatic FX conversion is applied. USD and KHR price series remain separate unless the business later chooses to store exchange rates. Ingredient recipe consumption is not implemented; production use, waste, and corrections must currently be entered as explicit stock movements.

## Live and offline behavior

Online writes are immediately saved to the shared spreadsheet, then other open pages poll for changes every 30 seconds. This is near-live request/refresh behavior, not a WebSocket push stream. Apps Script and Sheets require internet connectivity.

An already-open client page keeps a last-read snapshot and can queue supported mutations in IndexedDB while it detects an outage. On reconnect, the server validates queued actions again. Stock availability or a catalog price may have changed, so queued actions can require review. The Apps Script page itself is not guaranteed to open while the device is offline; this is not equivalent to a fully offline PWA.

## Backup and recovery

`setupBakeryPos` creates a restricted `Bakery POS Backups` Drive folder and a daily time-driven trigger (around 2:00 AM, project timezone). Each successful run makes a full, dated copy of the master spreadsheet; the default retention is 30 days. `BackupLog` records results. Older copies are moved to Trash.

This is a native spreadsheet-copy backup, not `.sqlite3`. Recovery means opening a dated copy and restoring its tabs into the master spreadsheet before resuming sales. Restore should be rehearsed before live use. If a local SQLite file is later required, export the sheet data and use a Python importer; the local database currently in the workspace is not synchronized.

## Security and operations

- Restrict the web app to staff Google accounts; never deploy for anonymous access.
- Prefer execution as the accessing user and share the sheet only with staff. If the deployment model changes, review its authorization scope before release.
- Keep Apps Script source in GitHub, but do not put account tokens, personal data, or service credentials in the client or repository.
- Apps Script/Sheets quotas and availability are Google-managed. Monitor **Apps Script > Executions**, inspect `BackupLog`, and test restore and stock reconciliation.
- Full Google deployment and live multi-device testing cannot be completed until the owner creates the spreadsheet and authorizes/deploys the Apps Script project.

## Delivery status

1. **Foundation:** Apps Script schema, request handling, order/payment, supplier, purchase, stock movement, price history, report, and backup services.
2. **Screens:** Responsive app sections for the eight screens above; real account deployment and multi-device UI testing remain pending.
3. **Operational validation:** Test staff permissions, multi-device order updates, duplicate request handling, stock reserve/release, USD/KHR totals, backup trigger, and restoration.
4. **Later:** Payment QR image integration, recipe-based ingredient usage, refund workflow, automated local SQLite export/import, and stronger offline application-shell support.
