# Bakery POS

Responsive bakery POS for a small team. The approved target architecture is GitHub Pages for the interface, a directly-called Google Apps Script API for business/data operations, Google Sheets as the shared data store, and a separate owner-only Apps Script project for daily Drive backups.

## Project layout

```text
.
├── apps_script/                   POS API source and GitHub Pages HTML/CSS/JS inputs
├── apps_script_backup/            Owner-only backup project source
├── scripts/build_github_pages.py  Static site builder
├── .github/workflows/             GitHub Pages deployment workflow
├── docs/ARCHITECTURE.md           Architecture and implementation status
├── docs/DEPLOYMENT.md             Required Google and GitHub setup
├── src/bakery_pos/                Separate local Python/SQLite prototype
├── tests/                          Tests for the local prototype
└── data/                           Local SQLite file; not connected to Sheets
```

The browser uses `DataService` to call the Apps Script Execution API directly. The POS API project does not host the interface and does not have Drive or trigger scopes. The separate backup project owns the daily trigger and Drive access. The Python/SQLite prototype is not synchronized with the cloud POS.

## Deploy

The cloud setup has not been completed from this worktree. Follow [GitHub Pages and Apps Script setup](docs/DEPLOYMENT.md) before publishing. The GitHub Actions workflow builds from `apps_script/index.html`, `Styles.html`, and `Client.html`; configure the repository variables for the OAuth Web client ID and API-executable deployment ID before deploying Pages.

## Features and limitations

The POS includes Dashboard, New Order, Orders, Products & Add-ons, Suppliers, Stock & Price History, Reports, and Settings screens. Staff use admin-managed POS usernames/passwords; admins can view passwords, assign roles/pages, and review the activity audit log. Successful changes are attributed to the signed-in POS user. The shop Google account still authorizes the API in each device browser; this is lightweight attribution, not strong security separation. The app supports walk-in, advance, and custom-cake orders; saved-customer lookup; payments; USD/KHR pricing without automatic conversion; and role-based page access. Writes run asynchronously with visible progress/completion messages. An already-open browser page can queue supported actions in IndexedDB while offline; those actions are not shared until successfully synchronized.

Daily backups are Google Sheets copies in Drive, not SQLite files. Page access in the POS does not prevent spreadsheet Editors from opening the Sheet directly. Recipe-based ingredient consumption, refunds, and full accounting workflows are not implemented.
