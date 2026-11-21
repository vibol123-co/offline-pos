function createDailyDriveBackup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = nowIso_();
  const backupId = makeId_();
  let createdFile = null;
  try {
    ensureSchemaUnlocked_();
    SpreadsheetApp.flush();
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
    const folderId = properties.getProperty("BACKUP_FOLDER_ID");
    if (!spreadsheetId || !folderId) {
      throw new Error("Run setupBakeryPos before creating Drive backups.");
    }
    const folder = DriveApp.getFolderById(folderId);
    const dateStamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd_HHmm"
    );
    const fileName = "BakeryPOS-Backup-" + dateStamp;
    createdFile = DriveApp.getFileById(spreadsheetId).makeCopy(fileName, folder);
    upsertRows_("BackupLog", [{
      id: backupId,
      file_id: createdFile.getId(),
      file_name: fileName,
      created_at: startedAt,
      status: "succeeded",
      message: ""
    }]);
    removeExpiredBackups_(folder, Number(getSettings_().backup_retention_days || 30));
    SpreadsheetApp.flush();
    return {
      file_id: createdFile.getId(),
      file_name: fileName,
      created_at: startedAt,
      status: "succeeded"
    };
  } catch (error) {
    upsertRows_("BackupLog", [{
      id: backupId,
      file_id: createdFile ? createdFile.getId() : "",
      file_name: createdFile ? createdFile.getName() : "",
      created_at: startedAt,
      status: "failed",
      message: String(error.message || error).slice(0, 1000)
    }]);
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function installDailyBackupTrigger_() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(function(trigger) {
    if (trigger.getHandlerFunction() === "createDailyDriveBackup") {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger("createDailyDriveBackup")
    .timeBased()
    .everyDays(1)
    .atHour(2)
    .inTimezone(Session.getScriptTimeZone())
    .create();
}

function removeExpiredBackups_(folder, retentionDays) {
  const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
  const files = folder.getFiles();
  while (files.hasNext()) {
    const file = files.next();
    if (
      file.getName().indexOf("BakeryPOS-Backup-") === 0 &&
      file.getDateCreated().getTime() < cutoff
    ) {
      file.setTrashed(true);
    }
  }
}

