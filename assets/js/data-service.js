(() => {
  let accessToken = "";

  async function request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body) {
      headers.set("Content-Type", "application/json");
    }
    if (accessToken) {
      headers.set("Authorization", `Bearer ${accessToken}`);
    }

    const response = await fetch(path, { ...options, headers });
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.dispatchEvent(new CustomEvent("bakery:unauthorized"));
    }
    if (!response.ok) {
      throw new Error(result.error || `Request failed (${response.status}).`);
    }
    return result;
  }

  window.DataService = Object.freeze({
    setAccessToken(token) {
      accessToken = token.trim();
    },
    getHealth() {
      return request("/api/health");
    },
    getOrders() {
      return request("/api/orders");
    },
    getProducts() {
      return request("/api/products");
    },
    createProduct(product) {
      return request("/api/products", {
        method: "POST",
        body: JSON.stringify(product),
      });
    },
    getAddOns() {
      return request("/api/add-ons");
    },
    createAddOn(addOn) {
      return request("/api/add-ons", {
        method: "POST",
        body: JSON.stringify(addOn),
      });
    },
    createOrder(order) {
      return request("/api/orders", {
        method: "POST",
        body: JSON.stringify(order),
      });
    },
    updateOrder(id, status) {
      return request(`/api/orders/${encodeURIComponent(id)}/status`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
    },
    deleteOrder(id) {
      return request(`/api/orders/${encodeURIComponent(id)}`, {
        method: "DELETE",
      });
    },
    recordPayment(orderId, payment) {
      return request(`/api/orders/${encodeURIComponent(orderId)}/payments`, {
        method: "POST",
        body: JSON.stringify(payment),
      });
    },
    getSyncStatus() {
      return request("/api/sync/status");
    },
    syncSheets() {
      return request("/api/sync/sheets", { method: "POST" });
    },
  });
})();
