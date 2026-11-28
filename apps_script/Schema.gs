const TABLE_SCHEMAS = {
  Settings: ["id", "key", "value", "updated_at"],
  StaffAccess: [
    "id", "email", "role", "allowed_pages_json", "active", "created_at", "updated_at",
    "username", "password", "display_name", "session_version"
  ],
  AuditLog: [
    "id", "occurred_at", "actor_id", "actor_username", "actor_name",
    "action", "entity_id", "details_json"
  ],
  Products: [
    "id", "name", "category", "price_usd_minor", "price_khr_minor",
    "inventory_item_id", "active", "created_at", "updated_at", "size"
  ],
  AddOns: [
    "id", "name", "price_usd_minor", "price_khr_minor", "inventory_item_id",
    "active", "created_at", "updated_at"
  ],
  Orders: [
    "id", "order_number", "customer_name", "customer_phone", "order_type",
    "order_channel", "fulfillment_method", "pickup_at", "status", "currency",
    "subtotal_minor", "discount_minor", "tax_minor", "total_minor", "notes",
    "custom_details_json", "created_at", "updated_at", "location", "delivery_fee_minor"
  ],
  OrderItems: [
    "id", "order_id", "item_type", "catalog_item_id", "name_snapshot",
    "inventory_item_id", "variant", "quantity", "unit_price_minor", "line_total_minor"
  ],
  Payments: [
    "id", "order_id", "amount_minor", "currency", "method", "status",
    "paid_at", "created_at"
  ],
  OrderStatusHistory: ["id", "order_id", "status", "changed_at"],
  Suppliers: ["id", "name", "phone", "email", "notes", "active", "created_at", "updated_at"],
  InventoryItems: [
    "id", "name", "category", "base_unit", "low_stock_threshold_milli",
    "active", "created_at", "updated_at"
  ],
  PurchaseReceipts: [
    "id", "supplier_id", "reference", "received_at", "currency", "notes", "created_at"
  ],
  PurchaseLines: [
    "id", "receipt_id", "supplier_id", "inventory_item_id", "quantity_base_milli",
    "total_cost_minor", "currency", "created_at"
  ],
  SupplierPriceQuotes: [
    "id", "supplier_id", "inventory_item_id", "quoted_at", "package_quantity_milli",
    "price_minor", "currency", "notes", "created_at"
  ],
  StockMovements: [
    "id", "inventory_item_id", "movement_type", "quantity_delta_milli",
    "unit_cost_minor", "currency", "reference_id", "occurred_at", "notes"
  ],
  // Summary: current quantity per stock item (id = inventory item id), kept up to date with
  // every stock movement so the app never has to add up the whole movement history.
  StockLevels: ["id", "inventory_item_id", "on_hand_milli", "updated_at"],
  RequestLog: ["id", "request_id", "action", "result_json", "created_at"],
  BackupLog: ["id", "file_id", "file_name", "created_at", "status", "message"]
};

const CURRENCY_EXPONENTS = { USD: 2, KHR: 0 };
const ORDER_STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];
const OPEN_ORDER_STATUSES = ["new", "preparing", "ready"];
const STATUS_TRANSITIONS = {
  new: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

// ---- Speed settings -------------------------------------------------------------------------
// Bump SCHEMA_VERSION_ whenever TABLE_SCHEMAS changes so every project re-checks its tabs once.
const SCHEMA_VERSION_ = "2";
const SCHEMA_CACHE_KEY_ = "schema_ok_v" + SCHEMA_VERSION_;
const SCHEMA_CACHE_SECONDS_ = 21600;
// Small tables kept in the server cache between calls. Cleared on every write to them and by
// the in-app Refresh button, so hand edits in the sheet show up after Refresh (or 10 minutes).
const SHARED_CACHED_TABLES_ = [
  "Settings", "Products", "AddOns", "Suppliers", "InventoryItems", "StaffAccess", "StockLevels"
];
const SHARED_TABLE_CACHE_SECONDS_ = 600;
const REQUEST_CACHE_SECONDS_ = 21600;
const STOCK_LEVELS_PROPERTY_ = "STOCK_LEVELS_READY";

// Per-call memory. Apps Script resets globals for every call, so nothing leaks between calls.
let spreadsheetMemo_ = null;
let sheetMemo_ = {};
let tableMemo_ = {};
let foundRowMemo_ = {};
let schemaCheckedThisCall_ = false;
let sheetsApiUnavailable_ = false;

function setupBakeryPos() {
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("POS_SETUP_COMPLETE") === "true") {
    throw new Error("Bakery POS setup has already completed.");
  }
  const effectiveEmail = normalizeEmail_(Session.getEffectiveUser().getEmail());
  if (!effectiveEmail) {
    throw new Error("Run setupBakeryPos while signed in to the administrator Google account.");
  }
  const bootstrapEmail = normalizeEmail_(properties.getProperty("BOOTSTRAP_ADMIN_EMAIL"));
  if (!bootstrapEmail) {
    throw new Error("Set BOOTSTRAP_ADMIN_EMAIL to the administrator Google account in Script Properties first.");
  }
  if (bootstrapEmail !== effectiveEmail) {
    throw new Error("Only the initial administrator can run setupBakeryPos.");
  }

  const activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const spreadsheetId = activeSpreadsheet
    ? activeSpreadsheet.getId()
    : properties.getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Set SPREADSHEET_ID in Script Properties before running setupBakeryPos.");
  }
  const spreadsheet = SpreadsheetApp.openById(spreadsheetId);
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());

  ensureSchema_();
  ensureDefaultSettings_();
  ensureInitialAdmin_(effectiveEmail);
  properties.setProperty("POS_SETUP_COMPLETE", "true");
  return {
    spreadsheetName: spreadsheet.getName(),
    tablesCreated: Object.keys(TABLE_SCHEMAS)
  };
}

function ensureInitialAdmin_(email) {
  const existing = readTable_("StaffAccess").find(function(record) {
    return normalizeEmail_(record.email) === email;
  });
  const now = nowIso_();
  const restoreAdmin = existing &&
    (existing.role !== "admin" || !isEnabled_(existing.active));
  upsertRows_("StaffAccess", [{
    id: existing ? existing.id : email,
    email: email,
    role: "admin",
    allowed_pages_json: JSON.stringify(ALL_PAGE_KEYS_),
    active: true,
    created_at: existing ? existing.created_at : now,
    updated_at: restoreAdmin ? now : (existing ? existing.updated_at : now),
    username: existing && existing.username ? existing.username : "admin",
    password: existing ? String(existing.password || "") : "",
    display_name: existing && existing.display_name ? existing.display_name : "Administrator",
    session_version: Number(existing && existing.session_version || 0) + (restoreAdmin ? 1 : 0)
  }]);
}

// ---- Schema check (cached) ------------------------------------------------------------------

function ensureSchema_() {
  if (schemaCheckedThisCall_) return;
  const cache = CacheService.getScriptCache();
  if (cache.get(SCHEMA_CACHE_KEY_) === "1") {
    schemaCheckedThisCall_ = true;
    return;
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    ensureSchemaUnlocked_();
  } finally {
    lock.releaseLock();
  }
}

function ensureSchemaUnlocked_() {
  const spreadsheet = getSpreadsheet_();
  const sheetsByName = {};
  spreadsheet.getSheets().forEach(function(sheet) { sheetsByName[sheet.getName()] = sheet; });
  let stockLevelsCreated = false;
  Object.keys(TABLE_SCHEMAS).forEach(function(tableName) {
    const headers = TABLE_SCHEMAS[tableName];
    let sheet = sheetsByName[tableName];
    if (!sheet) {
      sheet = spreadsheet.insertSheet(tableName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
      if (tableName === "StockLevels") stockLevelsCreated = true;
      return;
    }

    if (sheet.getLastRow() === 0) {
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      return;
    }

    const existingColumnCount = Math.min(sheet.getLastColumn(), headers.length);
    const existingHeaders = sheet.getRange(1, 1, 1, existingColumnCount).getValues()[0];
    if (existingHeaders.some(function(header, index) { return header !== headers[index]; })) {
      throw new Error("Unexpected columns in the " + tableName + " sheet. Do not rename or reorder its columns.");
    }
    if (existingColumnCount < headers.length) {
      const newHeaders = headers.slice(existingColumnCount);
      sheet.getRange(1, existingColumnCount + 1, 1, newHeaders.length).setValues([newHeaders]);
      sheet.getRange(1, existingColumnCount + 1, 1, newHeaders.length).setFontWeight("bold");
    }
  });
  sheetMemo_ = {};
  const properties = PropertiesService.getScriptProperties();
  if (properties.getProperty("STAFF_PASSWORD_TEXT_FORMAT") !== "true") {
    const staffSheet = spreadsheet.getSheetByName("StaffAccess");
    const passwordColumn = TABLE_SCHEMAS.StaffAccess.indexOf("password") + 1;
    staffSheet.getRange(1, passwordColumn, staffSheet.getMaxRows(), 1).setNumberFormat("@");
    properties.setProperty("STAFF_PASSWORD_TEXT_FORMAT", "true");
  }
  if (stockLevelsCreated || properties.getProperty(STOCK_LEVELS_PROPERTY_) !== "true") {
    rebuildStockLevelsUnlocked_();
  }
  CacheService.getScriptCache().put(SCHEMA_CACHE_KEY_, "1", SCHEMA_CACHE_SECONDS_);
  schemaCheckedThisCall_ = true;
}

// ---- Spreadsheet and sheet access (opened once per call) ------------------------------------

function getSpreadsheet_() {
  if (spreadsheetMemo_) return spreadsheetMemo_;
  const spreadsheetId = getSpreadsheetId_();
  try {
    spreadsheetMemo_ = SpreadsheetApp.openById(spreadsheetId);
    return spreadsheetMemo_;
  } catch (error) {
    throw new Error(
      "Cannot open the POS spreadsheet set in SPREADSHEET_ID (" +
      spreadsheetId.slice(0, 6) + "…" + spreadsheetId.slice(-4) + "). " +
      "It may be deleted, in the trash, or not shared with the shop Google account. " +
      "Original error: " + error.message
    );
  }
}

function getSpreadsheetId_() {
  const rawId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  // Accept a bare ID or a full Sheets URL, and ignore stray spaces/newlines.
  const urlMatch = String(rawId || "").match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
  const spreadsheetId = urlMatch ? urlMatch[1] : String(rawId || "").trim();
  if (!spreadsheetId) {
    throw new Error("Set SPREADSHEET_ID in Script Properties and run setupBakeryPos before opening the app.");
  }
  return spreadsheetId;
}

function getSheet_(tableName) {
  if (sheetMemo_[tableName]) return sheetMemo_[tableName];
  let sheet = getSpreadsheet_().getSheetByName(tableName);
  if (!sheet) {
    // A tab was removed by hand since the last check: recreate missing tabs, then retry.
    CacheService.getScriptCache().remove(SCHEMA_CACHE_KEY_);
    ensureSchemaUnlocked_();
    sheet = getSpreadsheet_().getSheetByName(tableName);
    if (!sheet) throw new Error("The " + tableName + " sheet is missing.");
  }
  sheetMemo_[tableName] = sheet;
  return sheet;
}

// ---- Reading -------------------------------------------------------------------------------

function readTable_(tableName) {
  return loadTable_(tableName).records.map(copyRecord_);
}

function copyRecord_(record) {
  return Object.assign({}, record);
}

function loadTable_(tableName) {
  if (!TABLE_SCHEMAS[tableName]) {
    throw new Error("Unknown data table: " + tableName);
  }
  if (tableMemo_[tableName]) return tableMemo_[tableName];
  const shared = readSharedTable_(tableName);
  if (shared) {
    tableMemo_[tableName] = shared;
    return shared;
  }
  preloadTables_([tableName]);
  return tableMemo_[tableName];
}

// Reads several tables with as few trips to Google as possible: small cached tables come from
// the server cache, the rest in one batch request (when the Google Sheets advanced service is
// turned on) or one read per tab otherwise.
function preloadTables_(tableNames) {
  const needed = [];
  tableNames.forEach(function(tableName) {
    if (tableMemo_[tableName] || needed.indexOf(tableName) !== -1) return;
    const shared = readSharedTable_(tableName);
    if (shared) {
      tableMemo_[tableName] = shared;
      return;
    }
    needed.push(tableName);
  });
  if (!needed.length) return;
  let rowsByTable = null;
  if (needed.length > 1) rowsByTable = batchReadRows_(needed);
  needed.forEach(function(tableName) {
    const rows = rowsByTable ? rowsByTable[tableName] : readRowsDirect_(tableName);
    const entry = buildTableEntry_(tableName, rows);
    tableMemo_[tableName] = entry;
    writeSharedTable_(tableName, entry);
  });
}

function readRowsDirect_(tableName) {
  const headers = TABLE_SCHEMAS[tableName];
  const values = getSheet_(tableName).getDataRange().getValues();
  return values.slice(1).map(function(row) { return row.slice(0, headers.length); });
}

function batchReadRows_(tableNames) {
  if (sheetsApiUnavailable_ || typeof Sheets === "undefined") return null;
  try {
    const ranges = tableNames.map(function(tableName) {
      getSheet_(tableName);
      return "'" + tableName + "'!A2:" + columnLetter_(TABLE_SCHEMAS[tableName].length);
    });
    const response = Sheets.Spreadsheets.Values.batchGet(getSpreadsheetId_(), {
      ranges: ranges,
      valueRenderOption: "UNFORMATTED_VALUE",
      dateTimeRenderOption: "SERIAL_NUMBER"
    });
    const timeZone = getSpreadsheet_().getSpreadsheetTimeZone();
    const result = {};
    tableNames.forEach(function(tableName, index) {
      const headers = TABLE_SCHEMAS[tableName];
      const valueRange = (response.valueRanges || [])[index] || {};
      result[tableName] = (valueRange.values || []).map(function(row) {
        const padded = [];
        for (let column = 0; column < headers.length; column += 1) {
          let value = row[column] === undefined ? "" : row[column];
          if (typeof value === "number" && /_at$/.test(headers[column])) {
            value = serialToDate_(value, timeZone);
          }
          padded.push(value);
        }
        return padded;
      });
    });
    return result;
  } catch (error) {
    sheetsApiUnavailable_ = true;
    console.warn("Batch read unavailable, reading tabs one by one: " + error.message);
    return null;
  }
}

function serialToDate_(serial, timeZone) {
  const wallClock = new Date(Math.round((serial - 25569) * 86400000));
  const offset = Utilities.formatDate(wallClock, timeZone, "Z");
  const sign = offset.charAt(0) === "-" ? -1 : 1;
  const minutes = sign * (Number(offset.slice(1, 3)) * 60 + Number(offset.slice(3, 5)));
  return new Date(wallClock.getTime() - minutes * 60000);
}

function columnLetter_(columnNumber) {
  let letters = "";
  let remaining = columnNumber;
  while (remaining > 0) {
    const modulo = (remaining - 1) % 26;
    letters = String.fromCharCode(65 + modulo) + letters;
    remaining = Math.floor((remaining - modulo) / 26);
  }
  return letters;
}

function buildTableEntry_(tableName, rows) {
  const headers = TABLE_SCHEMAS[tableName];
  const records = [];
  const rowNumbers = [];
  rows.forEach(function(values, index) {
    if (values[0] === "" || values[0] === null || values[0] === undefined) return;
    records.push(rowToRecord_(headers, values));
    rowNumbers.push(index + 2);
  });
  return { records: records, rows: rowNumbers, fromShared: false, index: null };
}

function rowToRecord_(headers, values) {
  const record = {};
  headers.forEach(function(header, index) {
    const value = values[index] === undefined ? "" : values[index];
    record[header] = value instanceof Date ? value.toISOString() : value;
  });
  return record;
}

function sharedTableKey_(tableName) {
  return "table_v" + SCHEMA_VERSION_ + "_" + tableName;
}

function readSharedTable_(tableName) {
  if (SHARED_CACHED_TABLES_.indexOf(tableName) === -1) return null;
  const cached = CacheService.getScriptCache().get(sharedTableKey_(tableName));
  if (!cached) return null;
  try {
    // Row numbers are not trusted from the shared cache (the sheet may have been sorted).
    return { records: JSON.parse(cached), rows: null, fromShared: true, index: null };
  } catch (error) {
    return null;
  }
}

function writeSharedTable_(tableName, entry) {
  if (SHARED_CACHED_TABLES_.indexOf(tableName) === -1) return;
  try {
    const serialized = JSON.stringify(entry.records);
    if (serialized.length < 90000) {
      CacheService.getScriptCache().put(
        sharedTableKey_(tableName), serialized, SHARED_TABLE_CACHE_SECONDS_
      );
    }
  } catch (error) {
    console.warn("Could not cache " + tableName + ": " + error.message);
  }
}

function forgetSharedTable_(tableName) {
  if (SHARED_CACHED_TABLES_.indexOf(tableName) === -1) return;
  CacheService.getScriptCache().remove(sharedTableKey_(tableName));
}

function clearSharedTableCache_() {
  CacheService.getScriptCache().removeAll(SHARED_CACHED_TABLES_.map(sharedTableKey_));
  tableMemo_ = {};
}

// Finds one record by id without reading a whole large table (uses Google's find tool).
function findById_(tableName, id) {
  const wanted = String(id);
  const entry = tableMemo_[tableName] || readSharedTable_(tableName);
  if (entry) {
    if (!tableMemo_[tableName]) tableMemo_[tableName] = entry;
    const position = indexOfId_(entry, wanted);
    return position === -1 ? null : copyRecord_(entry.records[position]);
  }
  if (SHARED_CACHED_TABLES_.indexOf(tableName) !== -1) {
    const loaded = loadTable_(tableName);
    const found = indexOfId_(loaded, wanted);
    return found === -1 ? null : copyRecord_(loaded.records[found]);
  }
  const row = findRowNumber_(tableName, 1, wanted);
  if (!row) return null;
  const headers = TABLE_SCHEMAS[tableName];
  const values = getSheet_(tableName).getRange(row, 1, 1, headers.length).getValues()[0];
  foundRowMemo_[tableName + "\u0000" + wanted] = row;
  return rowToRecord_(headers, values);
}

function indexOfId_(entry, id) {
  if (!entry.index) {
    entry.index = {};
    entry.records.forEach(function(record, position) {
      entry.index[String(record.id)] = position;
    });
  }
  return entry.index.hasOwnProperty(id) ? entry.index[id] : -1;
}

function findRowNumber_(tableName, columnNumber, value) {
  const sheet = getSheet_(tableName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const match = sheet.getRange(2, columnNumber, lastRow - 1, 1)
    .createTextFinder(String(value))
    .matchEntireCell(true)
    .matchCase(true)
    .findNext();
  return match ? match.getRow() : 0;
}

// Returns every record whose column equals value (for example all items of one order) without
// reading the whole table.
function findRowsByColumn_(tableName, columnName, value) {
  const wanted = String(value);
  const entry = tableMemo_[tableName];
  if (entry) {
    return entry.records.filter(function(record) {
      return String(record[columnName]) === wanted;
    }).map(copyRecord_);
  }
  const headers = TABLE_SCHEMAS[tableName];
  const columnNumber = headers.indexOf(columnName) + 1;
  const sheet = getSheet_(tableName);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const rows = sheet.getRange(2, columnNumber, lastRow - 1, 1)
    .createTextFinder(wanted)
    .matchEntireCell(true)
    .matchCase(true)
    .findAll()
    .map(function(range) { return range.getRow(); });
  if (!rows.length) return [];
  const first = Math.min.apply(null, rows);
  const last = Math.max.apply(null, rows);
  let blocks;
  if (last - first < 300) {
    blocks = sheet.getRange(first, 1, last - first + 1, headers.length).getValues();
  } else {
    blocks = rows.map(function(row) {
      return sheet.getRange(row, 1, 1, headers.length).getValues()[0];
    });
  }
  return blocks.map(function(values) { return rowToRecord_(headers, values); })
    .filter(function(record) {
      return record.id !== "" && String(record[columnName]) === wanted;
    });
}

// ---- Writing -------------------------------------------------------------------------------

// For brand-new rows (ids that cannot exist yet): no read needed, one write for all rows.
function appendRows_(tableName, records) {
  if (!records || !records.length) {
    return;
  }
  const headers = TABLE_SCHEMAS[tableName];
  const sheet = getSheet_(tableName);
  const values = records.map(function(record) {
    return headers.map(function(header) { return safeCellValue_(record[header]); });
  });
  const startRow = Math.max(sheet.getLastRow() + 1, 2);
  sheet.getRange(startRow, 1, values.length, headers.length).setValues(values);
  rememberWrittenRows_(tableName, records, records.map(function(record, index) {
    return startRow + index;
  }), true);
}

// Updates rows that exist (found by id) and appends the rest.
function upsertRows_(tableName, records) {
  if (!records || !records.length) {
    return;
  }
  const headers = TABLE_SCHEMAS[tableName];
  const sheet = getSheet_(tableName);
  const updates = [];
  const updateRows = [];
  const inserts = [];
  records.forEach(function(record) {
    if (!record.id) {
      throw new Error("Records in " + tableName + " must have an id.");
    }
    const row = rowForId_(tableName, String(record.id));
    if (row) {
      updates.push(record);
      updateRows.push(row);
    } else {
      inserts.push(record);
    }
  });
  updates.forEach(function(record, index) {
    const values = headers.map(function(header) { return safeCellValue_(record[header]); });
    sheet.getRange(updateRows[index], 1, 1, headers.length).setValues([values]);
  });
  if (updates.length) rememberWrittenRows_(tableName, updates, updateRows, false);
  appendRows_(tableName, inserts);
  forgetSharedTable_(tableName);
}

function rowForId_(tableName, id) {
  const key = tableName + "\u0000" + id;
  if (foundRowMemo_[key]) return foundRowMemo_[key];
  const entry = tableMemo_[tableName];
  if (entry && !entry.fromShared && entry.rows) {
    const position = indexOfId_(entry, id);
    return position === -1 ? 0 : entry.rows[position];
  }
  return findRowNumber_(tableName, 1, id);
}

function rememberWrittenRows_(tableName, records, rowNumbers, appended) {
  forgetSharedTable_(tableName);
  const entry = tableMemo_[tableName];
  records.forEach(function(record, index) {
    foundRowMemo_[tableName + "\u0000" + String(record.id)] = rowNumbers[index];
  });
  if (!entry) return;
  if (entry.fromShared || !entry.rows) {
    // Keep the in-memory copy correct for the rest of this call; row numbers stay unknown.
    entry.rows = null;
  }
  const headers = TABLE_SCHEMAS[tableName];
  records.forEach(function(record, index) {
    const normalized = rowToRecord_(headers, headers.map(function(header) {
      return record[header] === undefined || record[header] === null ? "" : record[header];
    }));
    const position = appended ? -1 : indexOfId_(entry, String(record.id));
    if (position === -1) {
      entry.records.push(normalized);
      if (entry.rows) entry.rows.push(rowNumbers[index]);
      if (entry.index) entry.index[String(record.id)] = entry.records.length - 1;
    } else {
      entry.records[position] = normalized;
    }
  });
}

function safeCellValue_(value) {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string" && /^[=+\-@]/.test(value)) {
    return "'" + value;
  }
  return value;
}

// ---- Stock levels summary ------------------------------------------------------------------

function addStockMovements_(movements) {
  if (!movements || !movements.length) return;
  ensureStockLevels_();
  appendRows_("StockMovements", movements);
  const deltas = {};
  movements.forEach(function(movement) {
    deltas[movement.inventory_item_id] =
      (deltas[movement.inventory_item_id] || 0) + Number(movement.quantity_delta_milli || 0);
  });
  const now = nowIso_();
  upsertRows_("StockLevels", Object.keys(deltas).map(function(itemId) {
    return {
      id: itemId,
      inventory_item_id: itemId,
      on_hand_milli: getStockBalanceMilli_(itemId) + deltas[itemId],
      updated_at: now
    };
  }));
}

function getStockBalanceMilli_(inventoryItemId) {
  ensureStockLevels_();
  const level = findById_("StockLevels", inventoryItemId);
  return level ? Number(level.on_hand_milli || 0) : 0;
}

function ensureStockLevels_() {
  if (PropertiesService.getScriptProperties().getProperty(STOCK_LEVELS_PROPERTY_) === "true") return;
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (PropertiesService.getScriptProperties().getProperty(STOCK_LEVELS_PROPERTY_) !== "true") {
      rebuildStockLevelsUnlocked_();
    }
  } finally {
    lock.releaseLock();
  }
}

// Recalculates StockLevels from the full StockMovements history (only needed once, or after
// StockMovements was edited by hand: run rebuildStockLevels from the editor).
function rebuildStockLevelsUnlocked_() {
  const headers = TABLE_SCHEMAS.StockLevels;
  delete tableMemo_.StockMovements;
  const totals = {};
  readRowsDirect_("StockMovements").forEach(function(values) {
    if (values[0] === "") return;
    totals[values[1]] = (totals[values[1]] || 0) + Number(values[3] || 0);
  });
  const sheet = getSheet_("StockLevels");
  if (sheet.getLastRow() > 1) {
    sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).clearContent();
  }
  const now = nowIso_();
  const rows = Object.keys(totals).filter(Boolean).map(function(itemId) {
    return [itemId, itemId, totals[itemId], now];
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setValues(rows);
  delete tableMemo_.StockLevels;
  foundRowMemo_ = {};
  forgetSharedTable_("StockLevels");
  PropertiesService.getScriptProperties().setProperty(STOCK_LEVELS_PROPERTY_, "true");
}

// ---- Duplicate-safe writes -----------------------------------------------------------------

function runIdempotent_(requestId, action, work, actor) {
  ensureSchema_();
  const normalizedRequestId = String(requestId || Utilities.getUuid());
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalizedRequestId)) {
    throw new Error("Request id has an invalid format.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prior = findPriorRequest_(normalizedRequestId);
    if (prior) {
      if (prior.action !== action) {
        throw new Error("Request id was already used for a different action.");
      }
      return JSON.parse(prior.result_json);
    }

    const result = work(normalizedRequestId);
    const now = nowIso_();
    if (actor) {
      const entityId = result && typeof result === "object"
        ? String(result.id || result.order_id || normalizedRequestId)
        : normalizedRequestId;
      appendRows_("AuditLog", [{
        id: "audit_" + normalizedRequestId,
        occurred_at: now,
        actor_id: actor.id,
        actor_username: actor.username,
        actor_name: actor.display_name,
        action: action,
        entity_id: entityId,
        details_json: JSON.stringify({ request_id: normalizedRequestId })
      }]);
    }
    const resultJson = JSON.stringify(result);
    appendRows_("RequestLog", [{
      id: normalizedRequestId,
      request_id: normalizedRequestId,
      action: action,
      result_json: resultJson,
      created_at: now
    }]);
    rememberRequest_(normalizedRequestId, action, resultJson);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function requestCacheKey_(requestId) {
  return "req_" + requestId;
}

function findPriorRequest_(requestId) {
  const cached = CacheService.getScriptCache().get(requestCacheKey_(requestId));
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch (error) {
      // Fall through to the sheet.
    }
  }
  const row = findRowNumber_("RequestLog", 2, requestId);
  if (!row) return null;
  const headers = TABLE_SCHEMAS.RequestLog;
  const values = getSheet_("RequestLog").getRange(row, 1, 1, headers.length).getValues()[0];
  return rowToRecord_(headers, values);
}

function rememberRequest_(requestId, action, resultJson) {
  try {
    const value = JSON.stringify({ action: action, result_json: resultJson });
    if (value.length < 90000) {
      CacheService.getScriptCache().put(requestCacheKey_(requestId), value, REQUEST_CACHE_SECONDS_);
    }
  } catch (error) {
    console.warn("Could not cache request result: " + error.message);
  }
}

// ---- Shop dates ----------------------------------------------------------------------------

function shopTimeZone_() {
  return Session.getScriptTimeZone();
}

function shopDateString_(date) {
  return Utilities.formatDate(date, shopTimeZone_(), "yyyy-MM-dd");
}

function shopDayStartMs_(dateString) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateString || ""))) {
    throw new Error("Dates must use the format YYYY-MM-DD.");
  }
  const parsed = Utilities.parseDate(dateString + " 00:00:00", shopTimeZone_(), "yyyy-MM-dd HH:mm:ss");
  if (isNaN(parsed.getTime())) throw new Error("Date is invalid: " + dateString);
  return parsed.getTime();
}

function ensureDefaultSettings_() {
  const settings = readTable_("Settings");
  const existingKeys = settings.map(function(row) { return row.key; });
  const now = nowIso_();
  const defaults = [
    { key: "supported_currencies", value: JSON.stringify(["USD", "KHR"]) },
    { key: "default_currency", value: "USD" },
    { key: "tax_rate_basis_points", value: "0" },
    { key: "backup_retention_days", value: "30" }
  ];
  const missing = defaults.filter(function(setting) {
    return existingKeys.indexOf(setting.key) === -1;
  }).map(function(setting) {
    return {
      id: setting.key,
      key: setting.key,
      value: setting.value,
      updated_at: now
    };
  });
  upsertRows_("Settings", missing);
}

function nowIso_() {
  return new Date().toISOString();
}

function makeId_() {
  return Utilities.getUuid();
}

function requiredText_(value, field, maxLength) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(field + " is required.");
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new Error(field + " cannot exceed " + maxLength + " characters.");
  }
  return result;
}

function optionalText_(value, field, maxLength) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  if (typeof value !== "string") {
    throw new Error(field + " must be text.");
  }
  const result = value.trim();
  if (result.length > maxLength) {
    throw new Error(field + " cannot exceed " + maxLength + " characters.");
  }
  return result;
}

function parseMoneyMinor_(value, currency) {
  const exponent = CURRENCY_EXPONENTS[currency];
  if (exponent === undefined) {
    throw new Error("Currency must be USD or KHR.");
  }
  const text = String(value).trim();
  const pattern = exponent === 2 ? /^\d+(?:\.\d{1,2})?$/ : /^\d+$/;
  if (!pattern.test(text)) {
    throw new Error(currency + " amount has invalid precision.");
  }
  const parts = text.split(".");
  const whole = Number(parts[0]);
  const fraction = exponent ? Number(((parts[1] || "") + "00").slice(0, exponent)) : 0;
  const amount = whole * Math.pow(10, exponent) + fraction;
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new Error("Amount is out of range.");
  }
  return amount;
}

function parseQuantityMilli_(value, allowZero) {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d{1,3})?$/.test(text)) {
    throw new Error(allowZero
      ? "Quantity must be a non-negative number with at most three decimals."
      : "Quantity must be a positive number with at most three decimals.");
  }
  const parts = text.split(".");
  const quantity = Number(parts[0]) * 1000 +
    Number(((parts[1] || "") + "000").slice(0, 3));
  if (!Number.isSafeInteger(quantity) || (allowZero ? quantity < 0 : quantity <= 0)) {
    throw new Error(allowZero ? "Quantity cannot be negative." : "Quantity must be greater than zero.");
  }
  return quantity;
}
