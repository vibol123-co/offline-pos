# GitHub Pages and Apps Script setup

The local changes are not live yet. Do not upload the POS API source or remove the current backup trigger until the replacement backup project is running and verified.

## 1. Prepare the owner-only backup project first

1. Create a separate Apps Script project for the files in `apps_script_backup`.
2. In its Script Properties, set:
   - `SPREADSHEET_ID`: the operational Bakery POS spreadsheet ID.
   - `BACKUP_FOLDER_ID`: the existing backup folder ID from the current backup project. Reusing this preserves the existing backup location.
3. Keep the backup project owner-only. Do not share it with cashiers.
4. Run `setupBakeryBackup()` once as the owner and authorize its Sheets, Drive, and trigger permissions.
5. Run `createDailyDriveBackup()` once manually. Verify that a dated copy appears in the existing Drive folder and that a successful row appears in `BackupLog`.
6. Confirm the new daily trigger exists. Only then disable the old project's backup trigger to prevent duplicates.

Do not set `BACKUP_FOLDER_ID` to a new folder unless creating a separate backup location is intended.

## 2. Configure and deploy the POS API

1. Update the Apps Script API project with the current `.gs` files in `apps_script/` and the manifest from `apps_script/appsscript.json`. The HTML files in that folder are build inputs for GitHub Pages; they are not required in the API-only Apps Script project. Do not deploy the changed API source until the replacement backup project is verified.
2. Preserve the current `SPREADSHEET_ID` Script Property and set `BOOTSTRAP_ADMIN_EMAIL` to the shop Google account's exact email. `setupBakeryPos()` refuses to initialize unless this property matches the effective account.
3. Confirm this project has the scopes in `apps_script/appsscript.json` only: Sheets and `userinfo.email`. Drive and trigger scopes belong only in the backup project.
4. Create or choose a **standard** Google Cloud project, link the Apps Script project to it in Apps Script project settings, and enable the Google Apps Script API in Google Cloud.
5. Configure OAuth consent and create an OAuth **Web application** client in that same Cloud project. Add the deployed GitHub Pages origin as an authorized JavaScript origin (for example, `https://OWNER.github.io`; do not include the repository path). The shop Google account—not each POS user—must be an OAuth test user if the consent app remains in testing.
6. Run `setupBakeryPos()` once from the Apps Script editor as the shop account. The setup creates an `admin` row in `StaffAccess`; set its initial password directly in that Sheet before signing in. The setup function is one-time and must not be exposed as a user-facing action.
7. Deploy a new **API executable** version from Apps Script and restrict **Who has access** to the shop Google account; do not allow anonymous callers. Record its deployment ID. The POS client calls this ID through `scripts.run`.
8. Test connecting with the shop Google account, then signing in as the initial admin. Verify that `Session.getActiveUser().getEmail()` resolves to the shop account in the deployed API; if it does not, stop before publishing.
9. From Settings, create a cashier username/password, assign pages, sign out, and test that account. Confirm that writes appear in `AuditLog` under the selected POS user and activity appears in Reports. POS users do not need Google accounts and should not be given direct Sheet access.

POS passwords are intentionally readable to admins in Settings and in the `StaffAccess` Sheet. Keep Sheet access restricted and do not reuse Google or personal passwords. Because the browser uses the shop Google account's OAuth token, this is a lightweight staff login and attribution model, not strong security separation for shared devices.

## 3. Configure and publish GitHub Pages

1. In GitHub repository **Settings → Pages**, choose **GitHub Actions** as the build/deployment source.
2. In **Settings → Secrets and variables → Actions → Variables**, add:
   - `POS_GOOGLE_OAUTH_CLIENT_ID`: OAuth Web client ID.
   - `POS_API_EXECUTION_DEPLOYMENT_ID`: API executable deployment ID.
3. Push to the `main` branch or run **Deploy Bakery POS to GitHub Pages** manually from the Actions tab. The workflow builds a static `site` directory from `apps_script/index.html`, `Styles.html`, and `Client.html`, then deploys it.
4. Open the published Pages URL and test an admin login, a cashier login, an order write, a page-permission denial, and the loading/completion message. Confirm the browser remains on the page during writes.

The OAuth client ID and API deployment ID are client configuration, not secrets; the workflow injects them at build time. Never put access tokens, client secrets, or service-account credentials in GitHub variables, the browser bundle, or the repository. The web client uses Google's browser token flow and requires the OAuth client's authorized origin to match the site.

## Local static build

Set the two environment variables above and run:

```powershell
$env:POS_GOOGLE_OAUTH_CLIENT_ID = "your-web-client-id"
$env:POS_API_EXECUTION_DEPLOYMENT_ID = "your-api-deployment-id"
python scripts\build_github_pages.py --require-config
```

The output is generated in `site/` and is intentionally ignored by Git. It contains only the static page and public runtime configuration.

## Rollback

Keep the existing Apps Script deployment and spreadsheet intact while validating the new setup. If the Pages client or API deployment fails, disable or revert the Pages workflow and continue using the old deployment. Do not remove the verified backup trigger or backup files while rolling back the UI/API.
