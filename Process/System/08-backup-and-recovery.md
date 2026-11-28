# 8. Backup and recovery

Backups run in a **separate, owner-only** Apps Script project (`apps_script_backup/Backup.gs`). The point of the separation is that cashiers are never asked to authorize Drive or trigger permissions.

## One-time setup

```mermaid
flowchart TB
    A["Owner creates the backup Apps Script project"] --> B["Script Properties:<br/>SPREADSHEET_ID, BACKUP_FOLDER_ID"]
    B --> C["Run setupBakeryBackup()<br/>authorize Sheets + Drive + triggers"]
    C --> D["Creates BackupLog tab if missing"]
    C --> E["Deletes old createDailyDriveBackup triggers,<br/>installs a new daily one at 2 AM"]
    E --> F["Run createDailyDriveBackup() once by hand"]
    F --> G{"Copy in Drive and<br/>'succeeded' row in BackupLog?"}
    G -- yes --> H["Disable the OLD project's backup trigger"]
    G -- no --> I["Fix, then retry. Keep the old trigger running"]
```

## Daily run

```mermaid
sequenceDiagram
    participant T as Time trigger (about 2 AM)
    participant B as createDailyDriveBackup
    participant S as Operational Sheet
    participant D as Drive backup folder
    T->>B: run
    B->>B: script lock (30s)
    B->>S: flush pending writes
    B->>D: makeCopy("BakeryPOS-Backup-yyyy-MM-dd_HHmm")
    B->>S: BackupLog row: succeeded
    B->>S: read Settings.backup_retention_days (default 30)
    B->>D: move to trash BakeryPOS-Backup-* files older than the retention period
    alt any error
        B->>S: BackupLog row: failed + message
    end
```

## Owner recovery tools (`apps_script/Recovery.gs`, run from the editor)

| Function | Use it when |
|----------|-------------|
| `diagnoseApi()` | Sign-in or the API fails. It checks each step in turn: Script Properties, active user email, shop-account match, cache, lock, opening the spreadsheet, the `StaffAccess` tab, and whether batch reads (the Sheets advanced service) are on. It changes nothing |
| `restoreStaffAccessTab()` | The `StaffAccess` tab is missing or the admin is locked out. It recreates the tab and the `admin` row. Afterwards, type a new password into the Sheet by hand |
| `rebuildStockLevels()` | Stock balances look wrong |
| `clearPosCaches()` | Hand edits in the Sheet don't show up |

## Restoring data

Backups are whole-spreadsheet copies. To restore, open the dated copy and copy the tabs you need back into the operational Sheet. Then run `clearPosCaches()`, and run `rebuildStockLevels()` if stock tabs were restored.
