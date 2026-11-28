function createSupplier(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "suppliers");
  return runIdempotent_(requestId, "createSupplier", function(idempotencyKey) {
    const now = nowIso_();
    const supplier = {
      id: idempotencyKey,
      name: requiredText_(payload.name, "supplier name", 120),
      phone: optionalText_(payload.phone, "phone", 40),
      email: optionalText_(payload.email, "email", 160),
      notes: optionalText_(payload.notes, "notes", 1000),
      active: true,
      created_at: now,
      updated_at: now
    };
    appendRows_("Suppliers", [supplier]);
    return supplier;
  }, actor);
}

function createInventoryItem(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "stock");
  return runIdempotent_(requestId, "createInventoryItem", function(idempotencyKey) {
    const now = nowIso_();
    const threshold = payload.low_stock_threshold;
    const item = {
      id: idempotencyKey,
      name: requiredText_(payload.name, "stock item name", 120),
      category: choice_(
        payload.category,
        ["ingredient", "packaging", "finished_product", "accessory"],
        "stock category"
      ),
      base_unit: choice_(payload.base_unit, ["g", "ml", "each"], "base unit"),
      low_stock_threshold_milli: threshold === undefined || threshold === null || threshold === ""
        ? 0
        : parseQuantityMilli_(threshold, true),
      active: true,
      created_at: now,
      updated_at: now
    };
    appendRows_("InventoryItems", [item]);
    return item;
  }, actor);
}

function recordSupplierPriceQuote(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "stock");
  return runIdempotent_(requestId, "recordSupplierPriceQuote", function(idempotencyKey) {
    const supplier = findById_("Suppliers", requiredText_(payload.supplier_id, "supplier", 80));
    const item = findById_("InventoryItems", requiredText_(payload.inventory_item_id, "stock item", 80));
    if (!supplier || !isActive_(supplier) || !item || !isActive_(item)) {
      throw new Error("Select an active supplier and stock item.");
    }
    const currency = choice_(payload.currency, ["USD", "KHR"], "currency");
    const quote = {
      id: idempotencyKey,
      supplier_id: supplier.id,
      inventory_item_id: item.id,
      quoted_at: normalizeDateTime_(payload.quoted_at) || nowIso_(),
      package_quantity_milli: parseQuantityMilli_(payload.package_quantity),
      price_minor: parseMoneyMinor_(payload.price, currency),
      currency: currency,
      notes: optionalText_(payload.notes, "notes", 1000),
      created_at: nowIso_()
    };
    if (quote.price_minor <= 0) {
      throw new Error("Quoted price must be greater than zero.");
    }
    appendRows_("SupplierPriceQuotes", [quote]);
    return quote;
  }, actor);
}

function receiveStock(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "stock");
  return runIdempotent_(requestId, "receiveStock", function(idempotencyKey) {
    if (!Array.isArray(payload.lines) || !payload.lines.length) {
      throw new Error("A stock receipt must contain at least one line.");
    }
    const supplier = findById_("Suppliers", requiredText_(payload.supplier_id, "supplier", 80));
    if (!supplier || !isActive_(supplier)) {
      throw new Error("Select an active supplier.");
    }
    const currency = choice_(payload.currency, ["USD", "KHR"], "currency");
    const receivedAt = normalizeDateTime_(payload.received_at) || nowIso_();
    const receiptId = idempotencyKey;
    const lines = payload.lines.map(function(line, index) {
      const item = findById_(
        "InventoryItems",
        requiredText_(line.inventory_item_id, "stock item", 80)
      );
      if (!item || !isActive_(item)) {
        throw new Error("A selected stock item is missing or inactive.");
      }
      const quantity = parseQuantityMilli_(line.quantity);
      const totalCost = parseMoneyMinor_(line.total_cost, currency);
      if (totalCost <= 0) {
        throw new Error("Purchase line cost must be greater than zero.");
      }
      return {
        id: receiptId + "_line_" + (index + 1),
        receipt_id: receiptId,
        supplier_id: supplier.id,
        inventory_item_id: item.id,
        quantity_base_milli: quantity,
        total_cost_minor: totalCost,
        currency: currency,
        created_at: receivedAt
      };
    });

    const receipt = {
      id: receiptId,
      supplier_id: supplier.id,
      reference: optionalText_(payload.reference, "receipt reference", 100),
      received_at: receivedAt,
      currency: currency,
      notes: optionalText_(payload.notes, "notes", 1000),
      created_at: nowIso_()
    };
    appendRows_("PurchaseReceipts", [receipt]);
    appendRows_("PurchaseLines", lines);
    addStockMovements_(lines.map(function(line) {
      return {
        id: line.id + "_movement",
        inventory_item_id: line.inventory_item_id,
        movement_type: "receipt",
        quantity_delta_milli: line.quantity_base_milli,
        unit_cost_minor: 0,
        currency: currency,
        reference_id: receiptId,
        occurred_at: receivedAt,
        notes: "Received from " + supplier.name
      };
    }));
    return receipt;
  }, actor);
}

function adjustStock(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "stock");
  return runIdempotent_(requestId, "adjustStock", function(idempotencyKey) {
    const item = findById_(
      "InventoryItems",
      requiredText_(payload.inventory_item_id, "stock item", 80)
    );
    if (!item || !isActive_(item)) {
      throw new Error("Select an active stock item.");
    }
    const movementType = choice_(payload.movement_type, ["waste", "adjustment"], "movement type");
    const quantity = parseQuantityMilli_(payload.quantity);
    const direction = choice_(payload.direction || "remove", ["add", "remove"], "direction");
    if (movementType === "waste" && direction !== "remove") {
      throw new Error("Waste movements must remove stock.");
    }
    const delta = direction === "add" ? quantity : -quantity;
    const balance = getStockBalanceMilli_(item.id);
    if (delta < 0 && balance < Math.abs(delta)) {
      throw new Error("Stock adjustment cannot make the balance negative.");
    }
    const movement = {
      id: idempotencyKey,
      inventory_item_id: item.id,
      movement_type: movementType,
      quantity_delta_milli: delta,
      unit_cost_minor: 0,
      currency: "",
      reference_id: "",
      occurred_at: nowIso_(),
      notes: optionalText_(payload.notes, "notes", 1000)
    };
    addStockMovements_([movement]);
    return movement;
  }, actor);
}

function getStockSnapshot(sessionToken) {
  requirePageAccess_(sessionToken, "stock");
  ensureSchema_();
  return getStockSnapshot_();
}

function getPriceHistory(inventoryItemId, sessionToken) {
  requirePageAccess_(sessionToken, "stock");
  ensureSchema_();
  preloadTables_(["InventoryItems", "Suppliers", "PurchaseLines", "PurchaseReceipts", "SupplierPriceQuotes"]);
  const item = findById_("InventoryItems", requiredText_(inventoryItemId, "stock item", 80));
  if (!item) {
    throw new Error("Stock item not found.");
  }
  const suppliersById = {};
  readTable_("Suppliers").forEach(function(supplier) {
    suppliersById[supplier.id] = supplier.name;
  });
  const purchases = readTable_("PurchaseLines").filter(function(line) {
    return line.inventory_item_id === item.id;
  }).map(function(line) {
    const receipt = findById_("PurchaseReceipts", line.receipt_id);
    return {
      type: "purchase",
      supplier_id: line.supplier_id,
      supplier_name: suppliersById[line.supplier_id] || "Unknown supplier",
      date: receipt ? receipt.received_at : line.created_at,
      quantity_base_milli: Number(line.quantity_base_milli),
      total_cost_minor: Number(line.total_cost_minor),
      currency: line.currency,
      notes: receipt ? receipt.reference : ""
    };
  });
  const quotes = readTable_("SupplierPriceQuotes").filter(function(quote) {
    return quote.inventory_item_id === item.id;
  }).map(function(quote) {
    return {
      type: "quote",
      supplier_id: quote.supplier_id,
      supplier_name: suppliersById[quote.supplier_id] || "Unknown supplier",
      date: quote.quoted_at,
      quantity_base_milli: Number(quote.package_quantity_milli),
      total_cost_minor: Number(quote.price_minor),
      currency: quote.currency,
      notes: quote.notes
    };
  });
  return purchases.concat(quotes).sort(function(left, right) {
    return String(right.date).localeCompare(String(left.date));
  });
}

function getStockSnapshot_() {
  ensureStockLevels_();
  preloadTables_(["InventoryItems", "StockLevels"]);
  const totals = {};
  readTable_("StockLevels").forEach(function(level) {
    totals[level.inventory_item_id] = Number(level.on_hand_milli || 0);
  });
  return readTable_("InventoryItems").filter(isActive_).map(function(item) {
    const onHand = totals[item.id] || 0;
    const threshold = Number(item.low_stock_threshold_milli || 0);
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      base_unit: item.base_unit,
      on_hand_milli: onHand,
      on_hand: onHand / 1000,
      low_stock_threshold_milli: threshold,
      is_low: threshold > 0 && onHand <= threshold
    };
  }).sort(function(left, right) {
    return String(left.name).localeCompare(String(right.name));
  });
}

function getSettings_() {
  const values = {};
  readTable_("Settings").forEach(function(row) {
    values[row.key] = row.value;
  });
  return {
    supported_currencies: JSON.parse(values.supported_currencies || '["USD","KHR"]'),
    default_currency: values.default_currency || "USD",
    tax_rate_basis_points: Number(values.tax_rate_basis_points || 0),
    backup_retention_days: Number(values.backup_retention_days || 30),
    // KHR per 1 USD; 0 = not set. See Currency.gs.
    khr_per_usd: Number(values.khr_per_usd || 0),
    khr_rounding_riel: Number(values.khr_rounding_riel || DEFAULT_KHR_ROUNDING_RIEL_)
  };
}

function updateSettings(payload, requestId, sessionToken) {
  const actor = requireAdmin_(sessionToken);
  return runIdempotent_(requestId, "updateSettings", function() {
    const currency = choice_(payload.default_currency, ["USD", "KHR"], "default currency");
    const taxRate = Number(payload.tax_rate_basis_points);
    if (!Number.isInteger(taxRate) || taxRate < 0 || taxRate > 10000) {
      throw new Error("Tax rate must be a whole number from 0 to 10000 basis points.");
    }
    const now = nowIso_();
    const rows = [
      { id: "default_currency", key: "default_currency", value: currency, updated_at: now },
      {
        id: "tax_rate_basis_points",
        key: "tax_rate_basis_points",
        value: String(taxRate),
        updated_at: now
      }
    ];
    // Optional so older website versions (which do not send them) keep the stored values.
    if (payload.khr_per_usd !== undefined && payload.khr_per_usd !== null && payload.khr_per_usd !== "") {
      const rate = Number(payload.khr_per_usd);
      if (!Number.isInteger(rate) || rate < 0 || rate > 100000) {
        throw new Error("Exchange rate must be a whole number of riel per 1 USD (0 to 100000; 0 = not set).");
      }
      rows.push({ id: "khr_per_usd", key: "khr_per_usd", value: String(rate), updated_at: now });
    }
    if (payload.khr_rounding_riel !== undefined && payload.khr_rounding_riel !== null &&
        payload.khr_rounding_riel !== "") {
      const step = Number(payload.khr_rounding_riel);
      if (!Number.isInteger(step) || step < 1 || step > 10000) {
        throw new Error("KHR rounding must be a whole number of riel from 1 to 10000.");
      }
      rows.push({ id: "khr_rounding_riel", key: "khr_rounding_riel", value: String(step), updated_at: now });
    }
    upsertRows_("Settings", rows);
    return getSettings_();
  }, actor);
}
