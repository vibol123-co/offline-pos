# 4. Record a payment

Payments can be taken **when the order is created** (full payment or deposit) and/or **later** from the Orders page.

```mermaid
flowchart TB
    A{"When?"} -->|At checkout| B["New Order → 'Paid amount' + method"]
    A -->|Later, e.g. at pickup| C["Orders → order card → Record payment"]
    C --> D["Enter amount + method<br/>cash / card terminal / other"]
    B & D --> E{"Checks"}
    E -- "amount ≤ 0 or > balance due" --> X1["Error"]
    E -- "currency ≠ order currency" --> X2["Error: pay in the order's currency"]
    E -- "order cancelled" --> X3["Error: cannot receive payment"]
    E -- OK --> F["Payment saved<br/>card shows new paid / due"]
    F --> G{"Balance due = 0?"}
    G -- yes --> H["Fully paid. Complete the order when handed over"]
    G -- no --> I["Partially paid. Take the rest later"]
```

## Typical cases

| Case | At checkout | Later |
|------|-------------|-------|
| Walk-in, pays now | Paid = total | — |
| Advance order with a deposit | Paid = deposit | Rest at pickup |
| Custom cake, pay on collection | Paid = 0 | Full amount at pickup |

## Limits

- No card details are ever entered. "Card terminal" only records that a separate machine took the payment.
- No currency mixing: a USD order is paid in USD.
- Refunds are not built.
