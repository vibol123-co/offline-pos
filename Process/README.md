# Bakery POS: process maps

These diagrams show how the Bakery POS works. They are drawn from the source in `apps_script/`, `apps_script_backup/` and `.github/workflows/`, and from `docs/`. The diagrams use [Mermaid](https://mermaid.js.org/). GitHub renders them. In VS Code, install a Mermaid preview extension (for example "Markdown Preview Mermaid Support") and open the Markdown preview.

## System: how it is built

| # | Process | What it covers |
|---|---------|----------------|
| 1 | [Architecture overview](System/01-architecture-overview.md) | The components, what each one owns, and how they connect |
| 2 | [Authentication and sessions](System/02-authentication-and-sessions.md) | The Google OAuth token (layer 1), the POS staff login (layer 2), session checks on every call |
| 3 | [API call and safe writes](System/03-api-call-and-safe-writes.md) | `DataService` → Execution API → `runIdempotent_`: lock, request ID, AuditLog, RequestLog |
| 4 | [Data loading, caching and refresh](System/04-data-loading-and-refresh.md) | Section loading per page, server caches, polling and refresh |
| 5 | [Offline queue and sync](System/05-offline-queue-and-sync.md) | IndexedDB outbox and replay when the device is back online |
| 6 | [Data model](System/06-data-model.md) | Google Sheets tabs and how they relate |
| 7 | [Stock ledger](System/07-stock-ledger.md) | How stock movements and StockLevels are kept |
| 8 | [Backup and recovery](System/08-backup-and-recovery.md) | Daily Drive copy project and the owner recovery tools |
| 9 | [Build and deployment](System/09-build-and-deployment.md) | GitHub Actions → GitHub Pages, Apps Script setup order |

## Business: how people use it

| # | Process | Who |
|---|---------|-----|
| 0 | [A day in the shop (end to end)](Business/00-day-in-the-shop.md) | Everyone |
| 1 | [Sign in, roles and page access](Business/01-sign-in-and-roles.md) | Admin, cashier |
| 2 | [Take a new order](Business/02-take-a-new-order.md) | Cashier |
| 3 | [Order lifecycle: prepare, ready, complete, cancel](Business/03-order-lifecycle.md) | Cashier, kitchen |
| 4 | [Record a payment](Business/04-record-a-payment.md) | Cashier |
| 5 | [Manage products and add-ons](Business/05-products-and-addons.md) | Admin or assigned staff |
| 6 | [Suppliers, stock receiving and price history](Business/06-suppliers-and-stock.md) | Admin or assigned staff |
| 7 | [Dashboard and reports](Business/07-dashboard-and-reports.md) | Admin, manager |
| 8 | [Staff accounts and settings](Business/08-staff-and-settings.md) | Admin only |
| 9 | [Working offline](Business/09-working-offline.md) | Cashier |

## Things these diagrams found that need checking

- **OAuth scopes differ from the docs.** `docs/ARCHITECTURE.md` and `docs/DEPLOYMENT.md` say the POS API has only the Sheets and `userinfo.email` scopes, and that Drive and trigger scopes belong only to the backup project. But `apps_script/appsscript.json` and the `API_SCOPES` list in `apps_script/Client.html` both request `drive` and `script.scriptapp` as well. Either the docs or the code should change.
- **Payment on a completed order.** On the server, `recordPayment` rejects only cancelled orders. The Orders screen hides "Record payment" once an order is completed, so the server would accept a payment the UI never offers.
- **The Python/SQLite prototype is not drawn.** `src/bakery_pos/` is a separate local prototype and is not connected to the cloud POS (see `README.md`).
