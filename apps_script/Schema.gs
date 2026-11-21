const TABLE_SCHEMAS = {
  Settings: ["id", "key", "value", "updated_at"],
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
  RequestLog: ["id", "request_id", "action", "result_json", "created_at"],
  BackupLog: ["id", "file_id", "file_name", "created_at", "status", "message"]
};

const CURRENCY_EXPONENTS = { USD: 2, KHR: 0 };
const ORDER_STATUSES = ["new", "preparing", "ready", "completed", "cancelled"];
const STATUS_TRANSITIONS = {
  new: ["preparing", "ready", "cancelled"],
  preparing: ["ready", "cancelled"],
  ready: ["completed", "cancelled"],
  completed: [],
  cancelled: []
};

function setupBakeryPos() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error("Open this bound Apps Script project from the bakery POS spreadsheet.");
  }
  const properties = PropertiesService.getScriptProperties();
  properties.setProperty("SPREADSHEET_ID", spreadsheet.getId());

  let backupFolderId = properties.getProperty("BACKUP_FOLDER_ID");
  if (!backupFolderId) {
    const folder = DriveApp.createFolder("Bakery POS Backups");
    backupFolderId = folder.getId();
    properties.setProperty("BACKUP_FOLDER_ID", backupFolderId);
  }

  ensureSchema_();
  ensureDefaultSettings_();
  installDailyBackupTrigger_();
  return {
    spreadsheetName: spreadsheet.getName(),
    backupFolderId: backupFolderId,
    tablesCreated: Object.keys(TABLE_SCHEMAS)
  };
}

function ensureSchema_() {
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
  Object.keys(TABLE_SCHEMAS).forEach(function(tableName) {
    const headers = TABLE_SCHEMAS[tableName];
    let sheet = spreadsheet.getSheetByName(tableName);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(tableName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight("bold");
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
}

function getSpreadsheet_() {
  const spreadsheetId = PropertiesService.getScriptProperties().getProperty("SPREADSHEET_ID");
  if (!spreadsheetId) {
    throw new Error("Run setupBakeryPos from the bound spreadsheet before opening the app.");
  }
  return SpreadsheetApp.openById(spreadsheetId);
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

function readTable_(tableName) {
  const headers = TABLE_SCHEMAS[tableName];
  if (!headers) {
    throw new Error("Unknown data table: " + tableName);
  }
  const sheet = getSpreadsheet_().getSheetByName(tableName);
  if (!sheet || sheet.getLastRow() < 2) {
    return [];
  }
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    .filter(function(values) { return values[0] !== ""; })
    .map(function(values) {
      const record = {};
      headers.forEach(function(header, index) {
        const value = values[index];
        record[header] = value instanceof Date ? value.toISOString() : value;
      });
      return record;
    });
}

function upsertRows_(tableName, records) {
  if (!records || !records.length) {
    return;
  }
  const headers = TABLE_SCHEMAS[tableName];
  const sheet = getSpreadsheet_().getSheetByName(tableName);
  const existing = readTable_(tableName);
  const rowById = {};
  existing.forEach(function(record, index) {
    rowById[String(record.id)] = index + 2;
  });

  const updates = [];
  const inserts = [];
  records.forEach(function(record) {
    if (!record.id) {
      throw new Error("Records in " + tableName + " must have an id.");
    }
    const values = headers.map(function(header) {
      return safeCellValue_(record[header]);
    });
    const existingRow = rowById[String(record.id)];
    if (existingRow) {
      updates.push({ row: existingRow, values: values });
    } else {
      inserts.push(values);
    }
  });

  updates.forEach(function(update) {
    sheet.getRange(update.row, 1, 1, headers.length).setValues([update.values]);
  });
  if (inserts.length) {
    const startRow = Math.max(sheet.getLastRow() + 1, 2);
    sheet.getRange(startRow, 1, inserts.length, headers.length).setValues(inserts);
  }
}

function appendRows_(tableName, records) {
  if (!records || !records.length) {
    return;
  }
  const headers = TABLE_SCHEMAS[tableName];
  const sheet = getSpreadsheet_().getSheetByName(tableName);
  const values = records.map(function(record) {
    return headers.map(function(header) { return safeCellValue_(record[header]); });
  });
  sheet.getRange(Math.max(sheet.getLastRow() + 1, 2), 1, values.length, headers.length)
    .setValues(values);
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

function runIdempotent_(requestId, action, work) {
  ensureSchema_();
  const normalizedRequestId = String(requestId || Utilities.getUuid());
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(normalizedRequestId)) {
    throw new Error("Request id has an invalid format.");
  }
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const prior = readTable_("RequestLog").find(function(row) {
      return row.request_id === normalizedRequestId;
    });
    if (prior) {
      if (prior.action !== action) {
        throw new Error("Request id was already used for a different action.");
      }
      return JSON.parse(prior.result_json);
    }

    const result = work(normalizedRequestId);
    upsertRows_("RequestLog", [{
      id: normalizedRequestId,
      request_id: normalizedRequestId,
      action: action,
      result_json: JSON.stringify(result),
      created_at: nowIso_()
    }]);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
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
