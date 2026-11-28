/**
 * Step-by-step check of every service loginStaff touches. Returns which step fails.
 * Safe to call through the Execution API: it changes nothing and returns no secrets.
 */
function diagnoseApi() {
  const results = [];
  function step(name, fn) {
    try {
      results.push(name + ": OK " + (fn() || ""));
    } catch (error) {
      results.push(name + ": FAILED - " + error.message);
    }
  }
  step("1 script properties", function() {
    const keys = PropertiesService.getScriptProperties().getKeys();
    return "(" + keys.length + " keys: " + keys.join(", ") + ")";
  });
  step("2 active user", function() {
    return Session.getActiveUser().getEmail() ? "(email visible)" : "(EMPTY email)";
  });
  step("3 bootstrap match", function() {
    requireShopGoogleAccount_();
  });
  step("4 cache", function() {
    const cache = CacheService.getScriptCache();
    cache.put("diag_ping", "1", 30);
    return cache.get("diag_ping") === "1" ? "" : "(read back failed)";
  });
  step("5 lock", function() {
    const lock = LockService.getScriptLock();
    lock.waitLock(5000);
    lock.releaseLock();
  });
  step("6 open spreadsheet", function() {
    return "(" + getSpreadsheet_().getName() + ")";
  });
  step("7 StaffAccess tab", function() {
    const sheet = getSpreadsheet_().getSheetByName("StaffAccess");
    return sheet ? "(" + Math.max(sheet.getLastRow() - 1, 0) + " rows)" : "(MISSING)";
  });
  step("8 batch reads (optional speed-up)", function() {
    return typeof Sheets === "undefined"
      ? "(off: add the Google Sheets advanced service for faster loading)"
      : "(on)";
  });
  Logger.log(results.join("\n"));
  return results;
}

/**
 * Recreates the StaffAccess tab (if missing) and restores the initial admin row.
 * Run manually from the Apps Script editor while signed in as BOOTSTRAP_ADMIN_EMAIL.
 * The admin password is left blank on purpose: type it into the "password" cell
 * of the admin row in the Sheet yourself after this runs.
 */
function restoreStaffAccessTab() {
  const properties = PropertiesService.getScriptProperties();
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  const bootstrapEmail = normalizeEmail_(properties.getProperty("BOOTSTRAP_ADMIN_EMAIL"));
  if (!bootstrapEmail || bootstrapEmail !== effectiveEmail) {
    throw new Error("Run this while signed in as the BOOTSTRAP_ADMIN_EMAIL account.");
  }

  const spreadsheet = getSpreadsheet_();
  const existed = !!spreadsheet.getSheetByName("StaffAccess");

  // Creates any missing tabs (including StaffAccess) with the correct headers.
  ensureSchema_();

  // Keep passwords as plain text so values like "0123" are not turned into numbers.
  const staffSheet = spreadsheet.getSheetByName("StaffAccess");
  const passwordColumn = TABLE_SCHEMAS.StaffAccess.indexOf("password") + 1;
  staffSheet.getRange(1, passwordColumn, staffSheet.getMaxRows(), 1).setNumberFormat("@");

  // Adds (or re-enables) the admin row: username "admin", role admin, all pages.
  ensureInitialAdmin_(bootstrapEmail);

  const message = "StaffAccess " + (existed ? "already existed" : "was created") +
    " in '" + spreadsheet.getName() + "'. Now type a password into the 'password' cell " +
    "of the 'admin' row, then sign in to the POS with username: admin";
  Logger.log(message);
  return message;
}

/**
 * Recalculates the StockLevels tab from the full StockMovements history.
 * Run from the editor only if you edited StockMovements by hand.
 */
function rebuildStockLevels() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    rebuildStockLevelsUnlocked_();
  } finally {
    lock.releaseLock();
  }
  const message = "StockLevels rebuilt (" + readTable_("StockLevels").length + " items).";
  Logger.log(message);
  return message;
}

/**
 * Clears the server cache (schema check, cached tables). Use after large hand edits in the sheet.
 */
function clearPosCaches() {
  CacheService.getScriptCache().remove(SCHEMA_CACHE_KEY_);
  clearSharedTableCache_();
  Logger.log("Bakery POS caches cleared.");
  return "Bakery POS caches cleared.";
}
