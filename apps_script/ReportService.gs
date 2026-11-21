function getReports(payload) {
  ensureSchema_();
  const from = payload && payload.from ? new Date(payload.from) : null;
  const to = payload && payload.to ? new Date(payload.to) : null;
  if ((from && isNaN(from.getTime())) || (to && isNaN(to.getTime()))) {
    throw new Error("Report date range is invalid.");
  }
  const orders = readTable_("Orders").filter(function(order) {
    const created = new Date(order.created_at).getTime();
    return (!from || created >= from.getTime()) &&
      (!to || created < to.getTime() + 24 * 60 * 60 * 1000) &&
      order.status !== "cancelled";
  });
  const totals = { USD: { orders: 0, sales_minor: 0 }, KHR: { orders: 0, sales_minor: 0 } };
  orders.forEach(function(order) {
    if (!totals[order.currency] || order.status !== "completed") {
      return;
    }
    totals[order.currency].orders += 1;
    totals[order.currency].sales_minor += Number(order.total_minor || 0);
  });
  const movements = readTable_("StockMovements");
  return {
    totals: totals,
    order_count: orders.length,
    low_stock_count: getStockSnapshot_().filter(function(item) { return item.is_low; }).length,
    movement_count: movements.filter(function(movement) {
      const occurred = new Date(movement.occurred_at).getTime();
      return (!from || occurred >= from.getTime()) &&
        (!to || occurred < to.getTime() + 24 * 60 * 60 * 1000);
    }).length
  };
}
