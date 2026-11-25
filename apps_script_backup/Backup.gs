const BACKUP_LOG_HEADERS = ["id", "file_id", "file_name", "created_at", "status", "message"];

function setupBakeryBackup() {
  const properties = PropertiesService.getScriptProperties();
  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const spreadsheetId = activeSpreadsheet
    ? activeSpreadsheet.getId()
    : properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Set SPREADSHEET_ID in this project's Script Properties before setup.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  properties.setProperty("SPREADSHEET_ID", spreadsheetId);

  let folderId = properties.getProperty("BACKUP_FOLDER_ID");
  if (!folderId) {
    folderId = DriveApp.createFolder("Bakery POS Backups").getId();
    properties.setProperty("BACKUP_FOLDER_ID", folderId);
  }
  ensureBackupLog_(spreadsheet);
  installDailyBackupTrigger_();
  return {
    spreadsheetName: spreadsheet.getName(),
    backupFolderId: folderId
  };
}

function createDailyDriveBackup() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  const startedAt = new Date().toISOString();
  const id = Utilities.getUuid();
  let createdFile = null;
  try {
    const properties = PropertiesService.getScriptProperties();
    const spreadsheetId = properties.getProperty("SPREADSHEET_ID");
    const folderId = properties.getProperty("BACKUP_FOLDER_ID");
    if (!spreadsheetId || !folderId) {
      throw new Error("Run setupBakeryBackup before creating Drive backups.");
    }
    const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
    SpreadsheetApp.flush();
    const stamp = Utilities.formatDate(
      new Date(),
      Session.getScriptTimeZone(),
      "yyyy-MM-dd_HHmm"
    );
    const fileName = "BakeryPOS-Backup-" + stamp;
    createdFile = DriveApp.getFileById(spreadsheetId)
      .makeCopy(fileName, DriveApp.getFolderById(folderId));
    appendBackupLog_(spreadsheet, [
      id, createdFile.getId(), fileName, startedAt, "succeeded", ""
    ]);
    removeExpiredBackups_(spreadsheet, DriveApp.getFolderById(folderId), readRetentionDays_(spreadsheet));
    SpreadsheetApp.flush();
    return {
      file_id: createdFile.getId(),
      file_name: fileName,
      created_at: startedAt,
      status: "succeeded"
    };
  } catch (error) {
    const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
    if (spreadsheetId) {
      appendBackupLog_(SpreadsheetApp.openById(spreadsheetId), [
        id,
        createdFile ? createdFile.getId() : "",
        createdFile ? createdFile.getName() : "",
        startedAt,
        "failed",
        String(error.message || error).slice(0, 1000)
      ]);
    }
    throw error;
  } finally {
    lock.releaseLock();
  }
}

function ensureBackupLog_(spreadsheet) {
  let sheet = spreadsheet.getSheetByName("BackupLog");
  if (!sheet) {
    sheet = spreadsheet.insertSheet("BackupLog");
  }
  if (!sheet.getLastRow()) {
    sheet.getRange(1, 1, 1, BACKUP_LOG_HEADERS.length).setValues([BACKUP_LOG_HEADERS]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, BACKUP_LOG_HEADERS.length).setFontWeight("bold");
    return;
  }
  const headers = sheet.getRange(1, 1, 1, BACKUP_LOG_HEADERS.length).getValues()[0];
  if (headers.some(function(value, index) { return value !== BACKUP_LOG_HEADERS[index]; })) {
    throw new Error("Unexpected columns in the BackupLog sheet.");
  }
}

function appendBackupLog_(spreadsheet, values) {
  ensureBackupLog_(spreadsheet);
  const sheet = spreadsheet.getSheetByName("BackupLog");
  sheet.getRange(Math.max(sheet.getLastRow() + 1, 2), 1, 1, values.length)
    .setValues([values]);
}

function readRetentionDays_(spreadsheet) {
  const sheet = spreadsheet.getSheetByName("Settings");
  if (!sheet || sheet.getLastRow() < 2) return 30;
  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 4).getValues();
  const setting = rows.find(function(row) { return row[1] === "backup_retention_days"; });
  const value = setting ? Number(setting[2]) : 30;
  return Number.isInteger(value) && value >= 1 ? value : 30;
}

function installDailyBackupTrigger_() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
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

function removeExpiredBackups_(spreadsheet, folder, retentionDays) {
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
