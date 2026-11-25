# Bakery POS architecture

## Approved direction

```text
PC / iPad / Android browser
        ↓
GitHub Pages (static HTML, CSS, JavaScript)
        ↓ OAuth access token; Google Apps Script Execution API
Apps Script POS API (business rules and authorization)
        ↓
Google Sheets (shared operational data)

Separate owner-only Apps Script project
        ↓ daily trigger; Drive scope
Google Drive (dated spreadsheet-copy backups)
```

GitHub Pages is the UI host. The UI calls Apps Script directly through Google's Execution API; there is no Cloudflare proxy or other middle service. Apps Script owns validation, business rules, POS-session checks, page authorization, and all Sheet access. The browser communicates with it through `DataService`; browser code does not read or write Sheets directly. The local Python/SQLite prototype remains separate and is not synchronized.

The client uses Google Identity Services to obtain an access token for the shop's Google account. Staff then sign in to the POS with usernames and passwords managed by an admin in the `StaffAccess` sheet; staff do not need individual Google accounts. Google requires the Apps Script API to be enabled, a standard Google Cloud project linked to the Apps Script project, and the OAuth client and Apps Script project to use that same Cloud project. The browser origin must be authorized in the OAuth client. See [DEPLOYMENT.md](./DEPLOYMENT.md).

## Responsibilities

- **Static client:** Responsive POS screens, shop-account connection, POS username/password sign-in, progress/completion messages, navigation, and a per-device IndexedDB outbox for supported actions queued while an already-open page is offline.
- **`DataService`:** The only client-side interface to Apps Script functions. It sends `scripts.run` requests and attaches request IDs to mutations. Screens do not call `fetch` to business endpoints or access localStorage.
- **Apps Script POS API:** Validates POS credentials, issues short-lived sessions, enforces page/admin permissions on each protected entry point, records mutation attribution, calculates order totals, manages order/payment/inventory/report behavior, and reads/writes Sheets.
- **Google Sheets:** Shared source of truth for orders, products, add-ons, plaintext POS credentials and page permissions in `StaffAccess`, inventory, supplier pricing, and `AuditLog`.
- **Owner-only backup project:** Uses separate Drive and trigger scopes to create daily dated copies and update the operational spreadsheet's `BackupLog`. Cashiers do not use this project.

All online writes are asynchronous and leave the page in place. The interface displays progress and a result. Open clients refresh periodically; this is polling, not push synchronization. Apps Script and Sheets require internet access. Offline support is limited to queueing supported actions on an already-open page; a fresh offline launch and offline reads are not supported.

## Roles and access

- **Admin:** All POS pages; can configure staff roles, page access, and settings.
- **Cashier:** Only pages explicitly assigned by an admin. Settings and staff administration are excluded.
- Apps Script checks the active POS session and staff role on protected API calls; the client also hides pages the account cannot use. Admins can read passwords in the staff-management screen and Sheet, as requested. Cashiers should not be given direct access to the operational spreadsheet.
- The main Google account must be connected in each shop browser, then staff use their POS credentials. `StaffAccess` passwords are intentionally plaintext, so Sheet owners/editors and backup-file readers can see them. Do not reuse Google or personal passwords.
- This is a lightweight staff attribution/login layer, not strong isolation: API calls run under the shop Google account, whose OAuth token is present in the browser. Anyone with access to a signed-in shop device may be able to act with that Google account's access outside the POS. A dedicated shop Google account limits exposure.

## Staff activity history

Successful POS mutations create an append-only `AuditLog` row containing server time, staff ID/name, action, and affected record/request ID. The Reports screen shows recent activity to admins for the selected date range. Passwords are not copied into `AuditLog` or mutation `RequestLog` results. A password change or account disable invalidates existing POS sessions; sessions otherwise expire after six hours or earlier if Apps Script evicts its cache entry.

## Backups

The backup project is separate from the POS API project so normal staff are not asked to authorize Drive or trigger-management scopes. The owner sets its `SPREADSHEET_ID` and existing `BACKUP_FOLDER_ID`, then runs `setupBakeryBackup()` once. It installs a daily trigger (around 2:00 AM in the project timezone), makes dated spreadsheet copies, retains the configured number of days (30 by default), and logs runs in `BackupLog`.

Backups are Google Sheets copies in Drive, not SQLite files. Verify a new backup and trigger before disabling the old project's backup trigger. Recovery requires restoring the needed tabs from a dated copy. If a standalone SQLite backup becomes a requirement, implement a separate export/import process; the existing local prototype is not a backup destination.

## Business data and behavior

- Bakery products and add-ons have stable IDs, active state, and independent USD/KHR prices. Amounts are stored as integer minor units (USD cents; KHR whole riel).
- Orders support walk-in, advance, and custom-cake details; pickup/delivery; customer contact/location; payment records; and status history.
- Suppliers, inventory items, purchase receipts, stock movements, and supplier price quotes support on-hand stock and price history. Stock is derived from movements; linked finished goods/add-ons can be reserved and released with order state.
- No automatic currency conversion or recipe-based ingredient consumption is implemented. No card credentials are collected.
- Server mutations use locking and request IDs for safe retries; Google Sheets itself is not a transactional database.

## Current delivery status

Local source now contains the direct API client, POS credential sessions, role checks, staff activity audit, a separate backup project, and a GitHub Pages build/deployment workflow. The live Apps Script project, OAuth client, API-executable deployment, GitHub Pages site, and replacement backup trigger have **not** been configured or deployed from this worktree. Complete the manual setup and smoke tests in [DEPLOYMENT.md](./DEPLOYMENT.md) before publishing or switching the existing trigger.
