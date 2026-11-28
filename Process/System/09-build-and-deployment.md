# 9. Build and deployment

## Release pipeline (UI)

```mermaid
flowchart LR
    DEV["Edit apps_script/<br/>index.html, Styles.html, Client.html"] --> PUSH["Push to main<br/>or run workflow manually"]
    PUSH --> GA["GitHub Actions<br/>github-pages.yml"]
    VARS["Repo variables<br/>POS_GOOGLE_OAUTH_CLIENT_ID<br/>POS_API_EXECUTION_DEPLOYMENT_ID"] --> GA
    GA --> BUILD["python scripts/build_github_pages.py<br/>--require-config"]
    BUILD --> SITE["site/index.html (inlined)<br/>site/config.js (public config)"]
    SITE --> PAGES["Deploy to GitHub Pages"]
    PAGES --> USERS["Shop browsers open the Pages URL"]
```

The OAuth client ID and the deployment ID are public configuration, not secrets. Never put access tokens, client secrets or service-account keys into repo variables or the browser bundle.

## API deployment (Apps Script)

```mermaid
flowchart TB
    A["Backup project set up and verified first<br/>see 08-backup-and-recovery"] --> B["Copy apps_script/*.gs + appsscript.json<br/>into the POS API project"]
    B --> C["Script Properties: SPREADSHEET_ID,<br/>BOOTSTRAP_ADMIN_EMAIL = shop account"]
    C --> D["Link to a standard Google Cloud project<br/>enable the Apps Script API"]
    D --> E["OAuth consent + Web client<br/>authorized origin = Pages origin"]
    E --> F["Run setupBakeryPos() once as the shop account<br/>creates tabs, settings, admin row"]
    F --> G["Set the admin password in the StaffAccess sheet"]
    G --> H["Deploy as 'API executable'<br/>access = shop account only"]
    H --> I["Put the deployment ID into the GitHub variable → redeploy Pages"]
    I --> J["Smoke tests: admin login, cashier login,<br/>order write, page denial, AuditLog row"]
```

## Rollback

Keep the old Apps Script deployment and the spreadsheet untouched while the new setup is being tested. If something fails, revert or disable the Pages workflow and keep using the old deployment. Never remove the verified backup trigger as part of a rollback.

> Note: the folder `apps_script_before_speed_2026-11-28/` is a snapshot of the API source from before the speed changes. Nothing deploys it, so it can serve as a manual fallback.
