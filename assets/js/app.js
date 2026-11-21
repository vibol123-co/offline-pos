const orderForm = document.querySelector("#order-form");
const orderList = document.querySelector("#orders");
const notice = document.querySelector("#notice");
const accessForm = document.querySelector("#access-form");
const syncButton = document.querySelector("#sync-button");
const currencyInput = document.querySelector("#currency");
const priceInput = document.querySelector("#unit-price");

function showNotice(message, isError = false) {
  notice.textContent = message;
  notice.classList.toggle("notice-error", isError);
}

function formatAmount(amount, currency) {
  const fractionDigits = currency === "USD" ? 2 : 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(Number(amount));
}

function renderOrders(orders) {
  orderList.replaceChildren();
  if (!orders.length) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No orders yet.";
    orderList.append(empty);
    return;
  }

  for (const order of orders) {
    const card = document.createElement("article");
    card.className = "order-card";

    const heading = document.createElement("div");
    heading.className = "order-heading";
    const title = document.createElement("h3");
    title.textContent = order.customer_name || "Walk-in customer";
    const status = document.createElement("span");
    status.className = `status status-${order.status}`;
    status.textContent = order.status.replaceAll("_", " ");
    heading.append(title, status);
    card.append(heading);

    const meta = document.createElement("p");
    meta.className = "order-meta";
    meta.textContent = `${order.order_number} · ${order.order_channel} · ${order.fulfillment_method}`;
    card.append(meta);

    const items = document.createElement("ul");
    items.className = "order-items";
    for (const item of order.items) {
      const line = document.createElement("li");
      line.textContent = `${item.name_snapshot} × ${item.quantity}`;
      items.append(line);
    }
    card.append(items);

    const total = document.createElement("p");
    total.className = "order-total";
    total.textContent = formatAmount(order.total, order.currency);
    card.append(total);

    const actions = document.createElement("div");
    actions.className = "order-actions";
    if (order.status === "new") {
      actions.append(makeStatusButton(order, "preparing", "Start preparing"));
    } else if (order.status === "preparing") {
      actions.append(makeStatusButton(order, "ready", "Mark ready"));
    } else if (order.status === "ready") {
      actions.append(makeStatusButton(order, "completed", "Complete"));
    }
    if (!["completed", "cancelled"].includes(order.status)) {
      const cancel = document.createElement("button");
      cancel.className = "text-button";
      cancel.type = "button";
      cancel.textContent = "Cancel order";
      cancel.addEventListener("click", () => cancelOrder(order.id));
      actions.append(cancel);
    }
    if (actions.childElementCount) {
      card.append(actions);
    }
    orderList.append(card);
  }
}

function makeStatusButton(order, status, label) {
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = label;
  button.addEventListener("click", async () => {
    try {
      await DataService.updateOrder(order.id, status);
      await refreshOrders();
      showNotice("Order status updated.");
    } catch (error) {
      showNotice(error.message, true);
    }
  });
  return button;
}

async function cancelOrder(orderId) {
  if (!window.confirm("Cancel this order? It will remain in the order history.")) {
    return;
  }
  try {
    await DataService.deleteOrder(orderId);
    await refreshOrders();
    showNotice("Order cancelled.");
  } catch (error) {
    showNotice(error.message, true);
  }
}

async function refreshOrders() {
  renderOrders(await DataService.getOrders());
}

async function refreshSyncStatus() {
  const status = await DataService.getSyncStatus();
  syncButton.hidden = !status.google_sheets_configured;
  if (status.google_sheets_configured) {
    showNotice(
      status.pending_changes
        ? `${status.pending_changes} local change(s) waiting to sync to Google Sheets.`
        : "Google Sheets is up to date."
    );
  } else {
    showNotice("Orders are stored locally in SQLite. Google Sheets sync is not configured.");
  }
}

orderForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(orderForm);
  const channel = form.get("orderChannel");
  const pickupValue = form.get("pickupAt");
  const payload = {
    customer_name: form.get("customer"),
    order_type: form.get("orderType"),
    order_channel: channel,
    fulfillment_method: channel === "grab" ? "delivery" : "pickup",
    pickup_at: pickupValue ? new Date(pickupValue).toISOString() : "",
    currency: form.get("currency"),
    notes: form.get("notes"),
    items: [{
      item_type: "custom",
      name: form.get("itemName"),
      quantity: Number(form.get("quantity")),
      unit_price: form.get("unitPrice"),
    }],
  };
  try {
    await DataService.createOrder(payload);
    orderForm.reset();
    document.querySelector("#quantity").value = "1";
    document.querySelector("#currency").value = "USD";
    priceInput.step = "0.01";
    await refreshOrders();
    await refreshSyncStatus();
    showNotice("Order saved in the local database.");
  } catch (error) {
    showNotice(error.message, true);
  }
});

document.querySelector("#refresh-button").addEventListener("click", async () => {
  try {
    await refreshOrders();
    await refreshSyncStatus();
  } catch (error) {
    showNotice(error.message, true);
  }
});

currencyInput.addEventListener("change", () => {
  priceInput.step = currencyInput.value === "USD" ? "0.01" : "1";
});

syncButton.addEventListener("click", async () => {
  syncButton.disabled = true;
  try {
    await DataService.syncSheets();
    await refreshSyncStatus();
    showNotice("Google Sheets sync completed.");
  } catch (error) {
    showNotice(error.message, true);
  } finally {
    syncButton.disabled = false;
  }
});

window.addEventListener("bakery:unauthorized", () => {
  accessForm.hidden = false;
  document.querySelector("#access-token").focus();
});

accessForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const token = document.querySelector("#access-token").value;
  DataService.setAccessToken(token);
  try {
    await refreshOrders();
    await refreshSyncStatus();
    accessForm.hidden = true;
    document.querySelector("#access-token").value = "";
    showNotice("Connected.");
  } catch (error) {
    DataService.setAccessToken("");
    showNotice(error.message, true);
  }
});

async function initialize() {
  try {
    await DataService.getHealth();
    await refreshOrders();
    await refreshSyncStatus();
  } catch (error) {
    showNotice(error.message, true);
  }
}

initialize();