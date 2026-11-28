// ---- Loading data in sections ---------------------------------------------------------------
// The website asks only for the sections the open page needs, then fetches the rest in the
// background. Each section lists the pages that may see it.
const SECTION_PAGES_ = {
  catalog: ["new-order", "products", "stock"],
  orders: ["dashboard", "orders"],
  customers: ["new-order"],
  stock: ["dashboard", "stock"],
  suppliers: ["suppliers", "stock"],
  staff: ["settings"]
};
const SECTION_TABLES_ = {
  catalog: ["Products", "AddOns", "InventoryItems"],
  orders: ["Orders", "OrderItems", "Payments", "OrderStatusHistory"],
  customers: ["Orders"],
  stock: ["InventoryItems", "StockLevels"],
  suppliers: ["Suppliers"],
  staff: ["StaffAccess"]
};
const ORDER_HISTORY_MAX_DAYS_ = 31;
const ORDER_HISTORY_PAGE_SIZE_ = 300;

function getSections(sectionNames, options, sessionToken) {
  ensureSchema_();
  if (options && options.fresh) clearSharedTableCache_();
  const staff = getCurrentStaff_(sessionToken);
  return buildSections_(staff, sectionNames, options || {});
}

function buildSections_(staff, sectionNames, options) {
  const names = (Array.isArray(sectionNames) ? sectionNames : Object.keys(SECTION_PAGES_))
    .filter(function(name) { return canSeeSection_(staff, name); });
  const tables = ["Settings"];
  names.forEach(function(name) { tables.push.apply(tables, SECTION_TABLES_[name]); });
  preloadTables_(tables);
  const sections = {};
  names.forEach(function(name) {
    if (name === "catalog") {
      sections.catalog = {
        products: readTable_("Products").filter(isActive_),
        addOns: readTable_("AddOns").filter(isActive_),
        inventoryItems: readTable_("InventoryItems").filter(isActive_)
      };
    } else if (name === "orders") {
      sections.orders = getStartupOrders_(options.ordersFrom, options.ordersTo);
    } else if (name === "customers") {
      sections.customers = { customers: getCustomerDirectory_() };
    } else if (name === "stock") {
      sections.stock = { stock: getStockSnapshot_() };
    } else if (name === "suppliers") {
      sections.suppliers = { suppliers: readTable_("Suppliers").filter(isActive_) };
    } else if (name === "staff") {
      sections.staff = { staffAccess: listStaffAccessRecords_() };
    }
  });
  return {
    currentUser: staff,
    settings: getSettings_(),
    sections: sections,
    shopToday: shopDateString_(new Date()),
    generatedAt: nowIso_()
  };
}

function canSeeSection_(staff, sectionName) {
  const pages = SECTION_PAGES_[sectionName];
  if (!pages) return false;
  if (sectionName === "staff") return staff.role === "admin";
  return staff.role === "admin" || pages.some(function(page) {
    return staff.allowed_pages.indexOf(page) !== -1;
  });
}

// Kept for older website versions: returns everything in the original shape.
function getAppData(sessionToken) {
  ensureSchema_();
  const staff = getCurrentStaff_(sessionToken);
  const data = buildSections_(staff, null, {});
  const sections = data.sections;
  const orders = sections.orders || { orders: [], openOrders: [] };
  return {
    currentUser: staff,
    staffAccess: sections.staff ? sections.staff.staffAccess : [],
    products: sections.catalog ? sections.catalog.products : [],
    addOns: sections.catalog ? sections.catalog.addOns : [],
    suppliers: sections.suppliers ? sections.suppliers.suppliers : [],
    inventoryItems: sections.catalog ? sections.catalog.inventoryItems : [],
    orders: orders.orders.concat(orders.openOrders),
    stock: sections.stock ? sections.stock.stock : [],
    settings: data.settings,
    backup: [],
    generatedAt: data.generatedAt
  };
}

// ---- Orders: startup range, open orders, history -------------------------------------------

function defaultOrderRange_() {
  const today = shopDateString_(new Date());
  const yesterday = shopDateString_(new Date(shopDayStartMs_(today) - 12 * 60 * 60 * 1000));
  return { from: yesterday, to: today };
}

function normalizeOrderRange_(from, to) {
  const fallback = defaultOrderRange_();
  const range = { from: from || fallback.from, to: to || fallback.to };
  const start = shopDayStartMs_(range.from);
  const end = shopDayStartMs_(range.to) + 24 * 60 * 60 * 1000;
  if (end <= start) throw new Error("The end date must be on or after the start date.");
  if ((end - start) / (24 * 60 * 60 * 1000) > ORDER_HISTORY_MAX_DAYS_) {
    throw new Error("Choose a range of " + ORDER_HISTORY_MAX_DAYS_ + " days or less.");
  }
  range.startMs = start;
  range.endMs = end;
  return range;
}

function getStartupOrders_(from, to) {
  const range = normalizeOrderRange_(from, to);
  const all = readTable_("Orders");
  const inRange = [];
  const openOlder = [];
  all.forEach(function(order) {
    const created = new Date(order.created_at).getTime();
    if (created >= range.startMs && created < range.endMs) {
      inRange.push(order);
    } else if (created < range.startMs && OPEN_ORDER_STATUSES.indexOf(order.status) !== -1) {
      openOlder.push(order);
    }
  });
  const hydrated = hydrateOrders_(inRange.concat(openOlder));
  const byNewest = function(left, right) {
    return String(right.created_at).localeCompare(String(left.created_at));
  };
  return {
    range: { from: range.from, to: range.to },
    orders: hydrated.slice(0, inRange.length).sort(byNewest),
    openOrders: hydrated.slice(inRange.length).sort(byNewest)
  };
}

function getOrderHistory(params, sessionToken) {
  requirePageAccess_(sessionToken, "orders");
  ensureSchema_();
  const options = params || {};
  const range = normalizeOrderRange_(options.from, options.to);
  const status = options.status ? choice_(options.status, ORDER_STATUSES, "status") : "";
  const offset = Math.max(0, Math.floor(Number(options.offset || 0)));
  const matches = readTable_("Orders").filter(function(order) {
    const created = new Date(order.created_at).getTime();
    return created >= range.startMs && created < range.endMs &&
      (!status || order.status === status);
  }).sort(function(left, right) {
    return String(right.created_at).localeCompare(String(left.created_at));
  });
  const totals = { USD: 0, KHR: 0 };
  let counted = 0;
  matches.forEach(function(order) {
    if (order.status === "cancelled") return;
    counted += 1;
    if (totals[order.currency] !== undefined) totals[order.currency] += Number(order.total_minor || 0);
  });
  const page = matches.slice(offset, offset + ORDER_HISTORY_PAGE_SIZE_);
  if (page.length) preloadTables_(["OrderItems", "Payments", "OrderStatusHistory"]);
  return {
    range: { from: range.from, to: range.to },
    status: status,
    total_count: matches.length,
    active_count: counted,
    totals_minor: totals,
    offset: offset,
    has_more: offset + page.length < matches.length,
    orders: hydrateOrders_(page)
  };
}

function hydrateOrders_(orders) {
  if (!orders.length) return [];
  preloadTables_(["OrderItems", "Payments", "OrderStatusHistory"]);
  const wanted = {};
  orders.forEach(function(order) { wanted[order.id] = true; });
  const group = function(tableName) {
    const byOrder = {};
    loadTable_(tableName).records.forEach(function(record) {
      if (!wanted[record.order_id]) return;
      (byOrder[record.order_id] = byOrder[record.order_id] || []).push(copyRecord_(record));
    });
    return byOrder;
  };
  const items = group("OrderItems");
  const payments = group("Payments");
  const histories = group("OrderStatusHistory");
  return orders.map(function(order) {
    return finishOrder_(order, items[order.id] || [], payments[order.id] || [], histories[order.id] || []);
  });
}

function finishOrder_(order, items, payments, histories) {
  order.items = items;
  order.payments = payments;
  order.status_history = histories.slice().sort(function(left, right) {
    return String(left.changed_at).localeCompare(String(right.changed_at));
  });
  order.amount_paid_minor = payments.filter(function(payment) {
    return payment.status === "completed";
  }).reduce(function(sum, payment) {
    return sum + Number(payment.amount_minor || 0);
  }, 0);
  order.balance_due_minor = Math.max(Number(order.total_minor) - order.amount_paid_minor, 0);
  return order;
}

// One order with its items, payments and history, found without reading whole tables.
function getOrder_(orderId, knownOrder) {
  const order = knownOrder || findById_("Orders", orderId);
  if (!order) {
    throw new Error("Order not found.");
  }
  return finishOrder_(
    order,
    findRowsByColumn_("OrderItems", "order_id", orderId),
    findRowsByColumn_("Payments", "order_id", orderId),
    findRowsByColumn_("OrderStatusHistory", "order_id", orderId)
  );
}

// ---- Customers -----------------------------------------------------------------------------

// Small phone directory sent to the website so the New order page can look up customers
// instantly without asking the server on every keystroke.
function getCustomerDirectory_() {
  const byPhone = {};
  readTable_("Orders").forEach(function(order) {
    const key = normalizePhoneForMatch_(order.customer_phone);
    if (key.length < 5) return;
    const entry = byPhone[key] || (byPhone[key] = {
      phone_key: key,
      customer_name: "",
      customer_phone: String(order.customer_phone),
      location: "",
      order_count: 0,
      last_order_at: "",
      name_at: "",
      location_at: ""
    });
    entry.order_count += 1;
    const created = String(order.created_at);
    if (created > entry.last_order_at) {
      entry.last_order_at = created;
      entry.customer_phone = String(order.customer_phone);
    }
    if (order.customer_name && created > entry.name_at) {
      entry.customer_name = order.customer_name;
      entry.name_at = created;
    }
    if (order.location && created > entry.location_at) {
      entry.location = order.location;
      entry.location_at = created;
    }
  });
  return Object.keys(byPhone).map(function(key) {
    const entry = byPhone[key];
    delete entry.name_at;
    delete entry.location_at;
    return entry;
  });
}

function findCustomerByPhone(phone, sessionToken) {
  requirePageAccess_(sessionToken, "new-order");
  ensureSchema_();
  const phoneKey = normalizePhoneForMatch_(requiredText_(phone, "phone", 40));
  if (phoneKey.length < 5) {
    return null;
  }
  const match = getCustomerDirectory_().find(function(entry) {
    return entry.phone_key === phoneKey;
  });
  return match || null;
}

function normalizePhoneForMatch_(phone) {
  return String(phone || "").replace(/\D/g, "");
}

// ---- Catalog -------------------------------------------------------------------------------

function createProduct(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "products");
  return runIdempotent_(requestId, "createProduct", function(idempotencyKey) {
    const now = nowIso_();
    const record = {
      id: idempotencyKey,
      name: requiredText_(payload.name, "name", 120),
      category: optionalText_(payload.category, "category", 80),
      size: optionalText_(payload.size, "size", 80),
      price_usd_minor: optionalMoney_(payload.price_usd, "USD"),
      price_khr_minor: optionalMoney_(payload.price_khr, "KHR"),
      inventory_item_id: optionalText_(payload.inventory_item_id, "inventory_item_id", 80),
      active: true,
      created_at: now,
      updated_at: now
    };
    if (record.price_usd_minor === "" && record.price_khr_minor === "") {
      throw new Error("Enter a USD price, a KHR price, or both.");
    }
    if (record.inventory_item_id) {
      const linkedStockItem = findById_("InventoryItems", record.inventory_item_id);
      if (!linkedStockItem || !isActive_(linkedStockItem) || linkedStockItem.category !== "finished_product") {
        throw new Error("Products can only link to active finished-product stock items.");
      }
    }
    appendRows_("Products", [record]);
    return record;
  }, actor);
}

function createAddOn(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "products");
  return runIdempotent_(requestId, "createAddOn", function(idempotencyKey) {
    const now = nowIso_();
    const record = {
      id: idempotencyKey,
      name: requiredText_(payload.name, "name", 120),
      price_usd_minor: optionalMoney_(payload.price_usd, "USD"),
      price_khr_minor: optionalMoney_(payload.price_khr, "KHR"),
      inventory_item_id: optionalText_(payload.inventory_item_id, "inventory_item_id", 80),
      active: true,
      created_at: now,
      updated_at: now
    };
    if (record.price_usd_minor === "" && record.price_khr_minor === "") {
      throw new Error("Enter a USD price, a KHR price, or both.");
    }
    if (record.inventory_item_id) {
      const linkedStockItem = findById_("InventoryItems", record.inventory_item_id);
      if (!linkedStockItem || !isActive_(linkedStockItem) ||
          !["accessory", "packaging"].includes(linkedStockItem.category)) {
        throw new Error("Add-ons can only link to active accessory or packaging stock items.");
      }
    }
    appendRows_("AddOns", [record]);
    return record;
  }, actor);
}

// ---- Orders: saving ------------------------------------------------------------------------

function createOrder(payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "new-order");
  return runIdempotent_(requestId, "createOrder", function(idempotencyKey) {
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error("An order must contain at least one item.");
    }
    const currency = choice_(payload.currency || "USD", ["USD", "KHR"], "currency");
    preloadTables_(["Products", "AddOns", "Settings"]);
    const products = readTable_("Products");
    const addOns = readTable_("AddOns");
    const items = payload.items.map(function(item, index) {
      return prepareOrderItem_(item, index, currency, products, addOns, idempotencyKey);
    });
    const subtotal = items.reduce(function(sum, item) {
      return sum + item.line_total_minor;
    }, 0);
    if (!Number.isSafeInteger(subtotal)) {
      throw new Error("Order subtotal is out of range.");
    }
    const discount = parseMoneyMinor_(payload.discount || "0", currency);
    const deliveryFee = parseMoneyMinor_(payload.delivery_fee || "0", currency);
    if (discount > subtotal) {
      throw new Error("Discount cannot exceed the item subtotal.");
    }
    const settings = getSettings_();
    const tax = payload.tax === undefined || payload.tax === ""
      ? Math.round((subtotal - discount) * settings.tax_rate_basis_points / 10000)
      : parseMoneyMinor_(payload.tax, currency);
    const total = subtotal - discount + tax + deliveryFee;
    if (!Number.isSafeInteger(total)) {
      throw new Error("Order total is out of range.");
    }
    const paidAmount = parseMoneyMinor_(payload.paid_amount || "0", currency);
    if (paidAmount > total) {
      throw new Error("Paid amount cannot exceed the order total.");
    }

    const channel = choice_(payload.order_channel || "walk_in", ["walk_in", "grab", "other"], "order channel");
    const expectedFulfillment = channel === "grab" ? "delivery" : channel === "walk_in" ? "pickup" : "";
    const fulfillment = choice_(
      payload.fulfillment_method || expectedFulfillment || "pickup",
      ["pickup", "delivery"],
      "fulfillment method"
    );
    if (expectedFulfillment && fulfillment !== expectedFulfillment) {
      throw new Error(channel + " orders must use " + expectedFulfillment + " fulfillment.");
    }
    const orderType = choice_(
      payload.order_type || "walk_in",
      ["walk_in", "advance", "custom_cake"],
      "order type"
    );
    const now = nowIso_();
    const orderId = idempotencyKey;
    const order = {
      id: orderId,
      order_number: "BP-" + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyyMMdd") +
        "-" + orderId.replace(/-/g, "").slice(0, 6).toUpperCase(),
      customer_name: optionalText_(payload.customer_name, "customer name", 120),
      customer_phone: optionalText_(payload.customer_phone, "customer phone", 40),
      order_type: orderType,
      order_channel: channel,
      fulfillment_method: fulfillment,
      pickup_at: normalizeDateTime_(payload.pickup_at),
      status: "new",
      currency: currency,
      subtotal_minor: subtotal,
      discount_minor: discount,
      tax_minor: tax,
      total_minor: total,
      notes: optionalText_(payload.notes, "notes", 2000),
      custom_details_json: serializeCustomDetails_(payload.custom_details || {}),
      created_at: now,
      updated_at: now,
      location: optionalText_(payload.location, "location", 300),
      delivery_fee_minor: deliveryFee
    };

    validateLinkedStock_(items);
    const history = [{
      id: orderId + "_initial_status",
      order_id: orderId,
      status: "new",
      changed_at: now
    }];
    const payments = [];
    if (paidAmount > 0) {
      const method = choice_(payload.payment_method || "cash", ["cash", "card_terminal", "other"], "payment method");
      payments.push({
        id: orderId + "_payment_initial",
        order_id: orderId,
        amount_minor: paidAmount,
        currency: currency,
        method: method,
        status: "completed",
        paid_at: now,
        created_at: now
      });
    }
    appendRows_("Orders", [order]);
    appendRows_("OrderItems", items);
    appendRows_("OrderStatusHistory", history);
    appendRows_("Payments", payments);
    reserveLinkedStock_(items, orderId, currency, now);
    return finishOrder_(copyRecord_(order), items.map(copyRecord_), payments.map(copyRecord_), history);
  }, actor);
}

function updateOrderStatus(orderId, status, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "orders");
  return runIdempotent_(requestId, "updateOrderStatus", function(idempotencyKey) {
    const order = findById_("Orders", requiredText_(orderId, "order id", 80));
    if (!order) {
      throw new Error("Order not found.");
    }
    const nextStatus = choice_(status, ORDER_STATUSES, "status");
    if (nextStatus === order.status) {
      return getOrder_(orderId, order);
    }
    if (STATUS_TRANSITIONS[order.status].indexOf(nextStatus) === -1) {
      throw new Error("An order cannot move from " + order.status + " to " + nextStatus + ".");
    }
    const now = nowIso_();
    order.status = nextStatus;
    order.updated_at = now;
    upsertRows_("Orders", [order]);
    appendRows_("OrderStatusHistory", [{
      id: idempotencyKey + "_status",
      order_id: orderId,
      status: nextStatus,
      changed_at: now
    }]);
    if (nextStatus === "cancelled") {
      releaseLinkedStock_(orderId, now);
    }
    return getOrder_(orderId, copyRecord_(order));
  }, actor);
}

function recordPayment(orderId, payload, requestId, sessionToken) {
  const actor = requirePageAccess_(sessionToken, "orders");
  return runIdempotent_(requestId, "recordPayment", function(idempotencyKey) {
    const order = findById_("Orders", orderId);
    if (!order || order.status === "cancelled") {
      throw new Error("This order cannot receive a payment.");
    }
    const currency = choice_(payload.currency || order.currency, ["USD", "KHR"], "currency");
    if (currency !== order.currency) {
      throw new Error("Payment currency must match the order currency.");
    }
    const current = getOrder_(orderId, order);
    const amount = parseMoneyMinor_(payload.amount, currency);
    if (amount <= 0 || amount > current.balance_due_minor) {
      throw new Error("Payment must be greater than zero and cannot exceed the remaining balance.");
    }
    const now = nowIso_();
    const payment = {
      id: idempotencyKey + "_payment",
      order_id: orderId,
      amount_minor: amount,
      currency: currency,
      method: choice_(payload.method || "cash", ["cash", "card_terminal", "other"], "payment method"),
      status: "completed",
      paid_at: now,
      created_at: now
    };
    appendRows_("Payments", [payment]);
    return finishOrder_(current, current.items, current.payments.concat([payment]), current.status_history);
  }, actor);
}

function prepareOrderItem_(item, index, currency, products, addOns, orderId) {
  if (!item || typeof item !== "object") {
    throw new Error("Each order item must be an object.");
  }
  const quantity = Number(item.quantity);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10000) {
    throw new Error("Item quantity must be a whole number between 1 and 10000.");
  }
  const itemType = choice_(item.item_type || "custom", ["product", "add_on", "custom"], "item type");
  let catalogId = "";
  let inventoryItemId = "";
  let name = "";
  let unitPrice = 0;
  let variant = optionalText_(item.variant, "variant", 80);
  if (itemType === "product" || itemType === "add_on") {
    catalogId = requiredText_(item.catalog_item_id, "catalog item", 80);
    const collection = itemType === "product" ? products : addOns;
    const catalogItem = collection.find(function(record) {
      return record.id === catalogId && isActive_(record);
    });
    if (!catalogItem) {
      throw new Error("The selected catalog item is unavailable.");
    }
    const storedPrice = currency === "USD" ? catalogItem.price_usd_minor : catalogItem.price_khr_minor;
    if (storedPrice === "" || storedPrice === null || storedPrice === undefined) {
      throw new Error("The selected item has no " + currency + " price.");
    }
    unitPrice = Number(storedPrice);
    if (!Number.isSafeInteger(unitPrice) || unitPrice < 0) {
      throw new Error("The selected item has no " + currency + " price.");
    }
    name = catalogItem.name;
    if (itemType === "product" && catalogItem.size) {
      variant = optionalText_(catalogItem.size, "size", 80);
    }
    inventoryItemId = catalogItem.inventory_item_id || "";
  } else {
    name = requiredText_(item.name, "item name", 160);
    unitPrice = parseMoneyMinor_(item.unit_price, currency);
  }
  if (!Number.isSafeInteger(unitPrice * quantity)) {
    throw new Error("Order line total is out of range.");
  }
  return {
    id: orderId + "_item_" + (index + 1),
    order_id: orderId,
    item_type: itemType,
    catalog_item_id: catalogId,
    name_snapshot: name,
    inventory_item_id: inventoryItemId,
    variant: variant,
    quantity: quantity,
    unit_price_minor: unitPrice,
    line_total_minor: unitPrice * quantity
  };
}

function validateLinkedStock_(items) {
  const requiredByItem = {};
  const nameByItem = {};
  items.forEach(function(item) {
    if (item.inventory_item_id) {
      requiredByItem[item.inventory_item_id] =
        (requiredByItem[item.inventory_item_id] || 0) + Number(item.quantity) * 1000;
      nameByItem[item.inventory_item_id] = item.name_snapshot;
    }
  });
  Object.keys(requiredByItem).forEach(function(itemId) {
    if (getStockBalanceMilli_(itemId) < requiredByItem[itemId]) {
      throw new Error("Not enough stock for " + nameByItem[itemId] + ".");
    }
  });
}

function reserveLinkedStock_(items, orderId, currency, occurredAt) {
  addStockMovements_(items.filter(function(item) {
    return item.inventory_item_id;
  }).map(function(item) {
    return {
      id: orderId + "_stock_" + item.id,
      inventory_item_id: item.inventory_item_id,
      movement_type: "sale_reserved",
      quantity_delta_milli: -Number(item.quantity) * 1000,
      unit_cost_minor: 0,
      currency: currency,
      reference_id: orderId,
      occurred_at: occurredAt,
      notes: "Reserved for " + orderId
    };
  }));
}

function releaseLinkedStock_(orderId, occurredAt) {
  const original = findRowsByColumn_("StockMovements", "reference_id", orderId).filter(function(movement) {
    return movement.movement_type === "sale_reserved";
  });
  addStockMovements_(original.map(function(movement) {
    return {
      id: orderId + "_release_" + movement.id,
      inventory_item_id: movement.inventory_item_id,
      movement_type: "sale_released",
      quantity_delta_milli: Math.abs(Number(movement.quantity_delta_milli)),
      unit_cost_minor: movement.unit_cost_minor,
      currency: movement.currency,
      reference_id: orderId,
      occurred_at: occurredAt,
      notes: "Released after order cancellation"
    };
  }));
}

function isActive_(record) {
  return record.active === true || record.active === 1 || record.active === "TRUE";
}

function optionalMoney_(value, currency) {
  if (value === undefined || value === null || value === "") {
    return "";
  }
  return parseMoneyMinor_(value, currency);
}

function choice_(value, allowed, field) {
  if (typeof value !== "string" || allowed.indexOf(value) === -1) {
    throw new Error(field + " must be one of: " + allowed.join(", ") + ".");
  }
  return value;
}

function normalizeDateTime_(value) {
  if (!value) {
    return "";
  }
  const date = new Date(value);
  if (isNaN(date.getTime())) {
    throw new Error("Pickup time must be a valid date and time.");
  }
  return date.toISOString();
}

function serializeCustomDetails_(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Custom cake details must be an object.");
  }
  const result = JSON.stringify(value);
  if (result.length > 4000) {
    throw new Error("Custom cake details are too long.");
  }
  return result;
}
