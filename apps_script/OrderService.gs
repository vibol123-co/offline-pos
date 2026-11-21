function getAppData() {
  ensureSchema_();
  return {
    products: readTable_("Products").filter(isActive_),
    addOns: readTable_("AddOns").filter(isActive_),
    suppliers: readTable_("Suppliers").filter(isActive_),
    inventoryItems: readTable_("InventoryItems").filter(isActive_),
    orders: getRecentOrders_(),
    stock: getStockSnapshot_(),
    settings: getSettings_(),
    backup: getBackupStatus_(),
    generatedAt: nowIso_()
  };
}

function findCustomerByPhone(phone) {
  ensureSchema_();
  const phoneKey = normalizePhoneForMatch_(requiredText_(phone, "phone", 40));
  if (phoneKey.length < 5) {
    return null;
  }
  const matches = readTable_("Orders").filter(function(order) {
    return normalizePhoneForMatch_(order.customer_phone) === phoneKey;
  }).sort(function(left, right) {
    return String(right.created_at).localeCompare(String(left.created_at));
  });
  if (!matches.length) {
    return null;
  }
  const namedOrder = matches.find(function(order) { return Boolean(order.customer_name); }) || matches[0];
  const locatedOrder = matches.find(function(order) { return Boolean(order.location); }) || matches[0];
  return {
    customer_name: namedOrder.customer_name || "",
    customer_phone: matches[0].customer_phone,
    location: locatedOrder.location || "",
    order_count: matches.length,
    last_order_at: matches[0].created_at
  };
}

function normalizePhoneForMatch_(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function createProduct(payload, requestId) {
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
    upsertRows_("Products", [record]);
    return record;
  });
}

function createAddOn(payload, requestId) {
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
    upsertRows_("AddOns", [record]);
    return record;
  });
}

function createOrder(payload, requestId) {
  return runIdempotent_(requestId, "createOrder", function(idempotencyKey) {
    if (!Array.isArray(payload.items) || !payload.items.length) {
      throw new Error("An order must contain at least one item.");
    }
    const currency = choice_(payload.currency || "USD", ["USD", "KHR"], "currency");
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
    upsertRows_("Orders", [order]);
    upsertRows_("OrderItems", items);
    upsertRows_("OrderStatusHistory", [{
      id: orderId + "_initial_status",
      order_id: orderId,
      status: "new",
      changed_at: now
    }]);
    reserveLinkedStock_(items, orderId, currency, now);
    if (paidAmount > 0) {
      const method = choice_(payload.payment_method || "cash", ["cash", "card_terminal", "other"], "payment method");
      upsertRows_("Payments", [{
        id: orderId + "_payment_initial",
        order_id: orderId,
        amount_minor: paidAmount,
        currency: currency,
        method: method,
        status: "completed",
        paid_at: now,
        created_at: now
      }]);
    }
    return getOrder_(orderId);
  });
}

function updateOrderStatus(orderId, status, requestId) {
  return runIdempotent_(requestId, "updateOrderStatus", function(idempotencyKey) {
    const order = findById_("Orders", requiredText_(orderId, "order id", 80));
    if (!order) {
      throw new Error("Order not found.");
    }
    const nextStatus = choice_(status, ORDER_STATUSES, "status");
    if (nextStatus === order.status) {
      return getOrder_(orderId);
    }
    if (STATUS_TRANSITIONS[order.status].indexOf(nextStatus) === -1) {
      throw new Error("An order cannot move from " + order.status + " to " + nextStatus + ".");
    }
    const now = nowIso_();
    order.status = nextStatus;
    order.updated_at = now;
    upsertRows_("Orders", [order]);
    upsertRows_("OrderStatusHistory", [{
      id: idempotencyKey + "_status",
      order_id: orderId,
      status: nextStatus,
      changed_at: now
    }]);
    if (nextStatus === "cancelled") {
      releaseLinkedStock_(orderId, now);
    }
    return getOrder_(orderId);
  });
}

function recordPayment(orderId, payload, requestId) {
  return runIdempotent_(requestId, "recordPayment", function(idempotencyKey) {
    const order = findById_("Orders", orderId);
    if (!order || order.status === "cancelled") {
      throw new Error("This order cannot receive a payment.");
    }
    const currency = choice_(payload.currency || order.currency, ["USD", "KHR"], "currency");
    if (currency !== order.currency) {
      throw new Error("Payment currency must match the order currency.");
    }
    const current = getOrder_(orderId);
    const amount = parseMoneyMinor_(payload.amount, currency);
    if (amount <= 0 || amount > current.balance_due_minor) {
      throw new Error("Payment must be greater than zero and cannot exceed the remaining balance.");
    }
    const now = nowIso_();
    upsertRows_("Payments", [{
      id: idempotencyKey + "_payment",
      order_id: orderId,
      amount_minor: amount,
      currency: currency,
      method: choice_(payload.method || "cash", ["cash", "card_terminal", "other"], "payment method"),
      status: "completed",
      paid_at: now,
      created_at: now
    }]);
    return getOrder_(orderId);
  });
}

function getOrder_(orderId) {
  const order = findById_("Orders", orderId);
  if (!order) {
    throw new Error("Order not found.");
  }
  return hydrateOrder_(
    order,
    readTable_("OrderItems"),
    readTable_("Payments"),
    readTable_("OrderStatusHistory")
  );
}

function hydrateOrder_(order, allItems, allPayments, allHistories) {
  order.items = allItems.filter(function(item) { return item.order_id === order.id; });
  order.payments = allPayments.filter(function(payment) { return payment.order_id === order.id; });
  order.status_history = allHistories.filter(function(entry) {
    return entry.order_id === order.id;
  }).sort(function(left, right) {
    return String(left.changed_at).localeCompare(String(right.changed_at));
  });
  order.amount_paid_minor = order.payments.filter(function(payment) {
    return payment.status === "completed";
  }).reduce(function(sum, payment) {
    return sum + Number(payment.amount_minor || 0);
  }, 0);
  order.balance_due_minor = Math.max(Number(order.total_minor) - order.amount_paid_minor, 0);
  return order;
}

function getRecentOrders_() {
  const orders = readTable_("Orders").sort(function(left, right) {
    return String(right.created_at).localeCompare(String(left.created_at));
  }).slice(0, 500);
  const ids = {};
  orders.forEach(function(order) { ids[order.id] = true; });
  const items = readTable_("OrderItems").filter(function(item) { return ids[item.order_id]; });
  const payments = readTable_("Payments").filter(function(payment) { return ids[payment.order_id]; });
  const histories = readTable_("OrderStatusHistory").filter(function(history) {
    return ids[history.order_id];
  });
  return orders.map(function(order) {
    return hydrateOrder_(order, items, payments, histories);
  });
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
  const linkedItems = items.filter(function(item) {
    return item.inventory_item_id;
  });
  linkedItems.forEach(function(item) {
    const quantityMilli = Number(item.quantity) * 1000;
    upsertRows_("StockMovements", [{
      id: orderId + "_stock_" + item.id,
      inventory_item_id: item.inventory_item_id,
      movement_type: "sale_reserved",
      quantity_delta_milli: -quantityMilli,
      unit_cost_minor: 0,
      currency: currency,
      reference_id: orderId,
      occurred_at: occurredAt,
      notes: "Reserved for " + orderId
    }]);
  });
}

function releaseLinkedStock_(orderId, occurredAt) {
  const original = readTable_("StockMovements").filter(function(movement) {
    return movement.reference_id === orderId && movement.movement_type === "sale_reserved";
  });
  original.forEach(function(movement) {
    upsertRows_("StockMovements", [{
      id: orderId + "_release_" + movement.id,
      inventory_item_id: movement.inventory_item_id,
      movement_type: "sale_released",
      quantity_delta_milli: Math.abs(Number(movement.quantity_delta_milli)),
      unit_cost_minor: movement.unit_cost_minor,
      currency: movement.currency,
      reference_id: orderId,
      occurred_at: occurredAt,
      notes: "Released after order cancellation"
    }]);
  });
}

function findById_(tableName, id) {
  return readTable_(tableName).find(function(record) {
    return String(record.id) === String(id);
  }) || null;
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
