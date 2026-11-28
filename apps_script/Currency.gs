// ---- Exchange rate and currency conversion -----------------------------------------------------
// One shop-wide rate, set by an admin in Settings: how many riel (KHR) equal 1 US dollar.
// All KHR amounts that come from a USD amount (catalog prices in a KHR order, KHR totals,
// change in KHR) are calculated with this rate. A rate of 0 means "not set": KHR catalog prices
// then fall back to the KHR price stored on the product, and cross-currency payments are refused.
//
// Money is always integer minor units: USD cents, whole KHR riel.

const DEFAULT_KHR_ROUNDING_RIEL_ = 100;

function exchangeRate_(settings) {
  const rate = Number((settings || getSettings_()).khr_per_usd || 0);
  return Number.isInteger(rate) && rate > 0 ? rate : 0;
}

function khrRoundingStep_(settings) {
  const step = Number((settings || getSettings_()).khr_rounding_riel || DEFAULT_KHR_ROUNDING_RIEL_);
  return Number.isInteger(step) && step >= 1 ? step : DEFAULT_KHR_ROUNDING_RIEL_;
}

function requireExchangeRate_(settings) {
  const rate = exchangeRate_(settings);
  if (!rate) {
    throw new Error("Set the KHR exchange rate in Settings before mixing USD and KHR.");
  }
  return rate;
}

// Rounds a riel amount to the shop's cash step (for example the nearest 100 riel).
function roundKhrToStep_(riel, step) {
  return Math.round(Number(riel) / step) * step;
}

// Converts an amount between USD cents and KHR riel. Same currency returns the amount unchanged.
// The result is rounded to the nearest minor unit (cent or riel), not to the cash step.
function convertMinor_(amountMinor, fromCurrency, toCurrency, rate) {
  const amount = Number(amountMinor || 0);
  if (fromCurrency === toCurrency) return amount;
  if (!rate) throw new Error("Set the KHR exchange rate in Settings before mixing USD and KHR.");
  if (fromCurrency === "USD" && toCurrency === "KHR") return Math.round(amount * rate / 100);
  if (fromCurrency === "KHR" && toCurrency === "USD") return Math.round(amount * 100 / rate);
  throw new Error("Currency must be USD or KHR.");
}

// The KHR price of a catalog item: USD price × rate, rounded to the cash step. Without a rate
// or a USD price, the stored KHR price is used (the behaviour before exchange rates existed).
function catalogKhrPriceMinor_(catalogItem, settings) {
  const rate = exchangeRate_(settings);
  const usd = catalogItem.price_usd_minor;
  if (rate && usd !== "" && usd !== null && usd !== undefined) {
    return roundKhrToStep_(Number(usd) * rate / 100, khrRoundingStep_(settings));
  }
  const khr = catalogItem.price_khr_minor;
  return khr === "" || khr === null || khr === undefined ? "" : Number(khr);
}

// What is owed, expressed in the currency the customer pays with. A KHR amount is rounded to the
// cash step, so it matches the "Total (KHR)" shown to the cashier and customer.
function dueInCurrency_(dueMinor, orderCurrency, payCurrency, rate, step) {
  const due = Math.max(Number(dueMinor || 0), 0);
  if (payCurrency === orderCurrency) return due;
  const converted = convertMinor_(due, orderCurrency, payCurrency, rate);
  return payCurrency === "KHR" ? roundKhrToStep_(converted, step) : converted;
}

// Works out what happens when the cashier is handed cash (or a card payment) for an order.
// receivedMinor/receivedCurrency: what the customer handed over.
// dueMinor/orderCurrency: what is still owed on the order.
// The comparison is made in the currency the customer paid with, so paying exactly the displayed
// KHR total always settles a USD order in full (no 1-cent balance from rounding).
// Returns the amount applied to the order (in the order currency, never more than due) and the
// change: change_minor in the received currency, plus change.usd_minor / change.khr_minor.
function settleReceived_(receivedMinor, receivedCurrency, dueMinor, orderCurrency, settings) {
  const rate = receivedCurrency === orderCurrency ? exchangeRate_(settings) : requireExchangeRate_(settings);
  const step = khrRoundingStep_(settings);
  const received = Number(receivedMinor);
  const due = Math.max(Number(dueMinor || 0), 0);
  const dueInReceived = dueInCurrency_(due, orderCurrency, receivedCurrency, rate, step);
  let applied;
  let changeInReceived;
  if (received >= dueInReceived) {
    applied = due;
    changeInReceived = received - dueInReceived;
  } else {
    applied = Math.min(convertMinor_(received, receivedCurrency, orderCurrency, rate), due);
    changeInReceived = 0;
  }
  return {
    received_minor: received,
    received_currency: receivedCurrency,
    due_in_received_currency_minor: dueInReceived,
    applied_minor: applied,
    change_minor: changeInReceived,
    change: changeInBothCurrencies_(changeInReceived, receivedCurrency, rate, step),
    exchange_rate_khr_per_usd: rate
  };
}

// Change expressed in USD and in KHR. The KHR figure is rounded to the cash step. Without a rate
// only the currency it was calculated in is filled in (the other is null).
function changeInBothCurrencies_(changeMinor, currency, rate, step) {
  const amount = Number(changeMinor || 0);
  if (currency === "USD") {
    return {
      usd_minor: amount,
      khr_minor: rate ? roundKhrToStep_(amount * rate / 100, step) : null
    };
  }
  return {
    usd_minor: rate ? Math.round(amount * 100 / rate) : null,
    khr_minor: roundKhrToStep_(amount, step)
  };
}
