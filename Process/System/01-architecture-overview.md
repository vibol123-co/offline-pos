# 1. Architecture overview

The POS has four parts. A static web page runs on any device. An Apps Script project acts as the API and holds all the business rules. One Google Sheet stores all the data. A second, owner-only Apps Script project makes the daily backups.

```mermaid
flowchart TB
    subgraph Devices["Shop devices: PC, iPad, Android"]
        UI["Static POS page<br/>index.html + Styles + Client.html"]
        DS["DataService<br/>the only path to the API"]
        IDB[("IndexedDB outbox<br/>bakery-pos-github")]
        UI --> DS
        DS <-->|queue when offline| IDB
    end

    GH["GitHub Pages<br/>hosts the static site"]
    GIS["Google Identity Services<br/>OAuth token for the shop Google account"]
    EXE["Apps Script Execution API<br/>script.googleapis.com/v1/scripts/ID:run"]

    subgraph API["Apps Script POS API project"]
        ACC["AccessService.gs<br/>login, sessions, page checks, staff admin"]
        ORD["OrderService.gs<br/>sections, orders, payments, catalog, customers"]
        INV["InventoryService.gs<br/>suppliers, stock, price quotes, settings"]
        REP["ReportService.gs<br/>sales and activity reports"]
        SCH["Schema.gs<br/>tables, cache, locking, idempotency, audit"]
        REC["Recovery.gs<br/>owner maintenance tools"]
    end

    SHEET[("Google Sheet<br/>operational data, one tab per table")]
    CACHE[("Script cache<br/>sessions, small tables, request results")]

    subgraph BK["Owner-only backup project"]
        BAK["Backup.gs<br/>daily trigger, about 2 AM"]
    end
    DRIVE[("Google Drive<br/>dated spreadsheet copies")]

    GH -->|serves page| UI
    DS -->|1. get token| GIS
    DS -->|2. scripts.run + Bearer token| EXE
    EXE --> ACC & ORD & INV & REP
    ACC & ORD & INV & REP --> SCH
    SCH <--> SHEET
    SCH <--> CACHE
    REC --> SCH
    BAK -->|copy file| DRIVE
    BAK -->|write BackupLog| SHEET
```

## Who owns what

| Component | Responsibility | Does not do |
|-----------|----------------|-------------|
| Static client | Screens, Google connect, POS login form, progress messages, offline queue | Read or write Sheets directly |
| `DataService` (in `Client.html`) | Sends every `scripts.run` call, attaches the session token and the request ID for writes | Business rules |
| Apps Script POS API | Validation, totals, permissions, audit, all Sheet access | Host the UI |
| Google Sheet | Source of truth for every table (see [Data model](06-data-model.md)) | Transactions (locking is done in Apps Script) |
| Backup project | Daily Drive copy, retention cleanup, `BackupLog` rows | Anything a cashier uses |

## Key design points

- **No middle server.** The browser calls Google's Execution API directly with an OAuth token.
- **Two login layers.** The shop Google account comes first, then the POS username and password (see [Authentication](02-authentication-and-sessions.md)).
- **Updates by polling, not push.** Open screens refresh on focus, on return to the tab, and on the Refresh button.
- **Offline support is limited.** It only queues writes on a page that is already open. A fresh launch or reading data needs the internet.
