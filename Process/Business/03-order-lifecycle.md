# 3. Order lifecycle

**Page:** Orders (and the Dashboard "needs attention" list). **Who:** staff with the `orders` page.

```mermaid
stateDiagram-v2
    [*] --> new: Order saved
    new --> preparing: Start preparing
    new --> ready: (allowed by server)
    preparing --> ready: Mark ready
    ready --> completed: Complete
    new --> cancelled: Cancel order
    preparing --> cancelled: Cancel order
    ready --> cancelled: Cancel order
    completed --> [*]
    cancelled --> [*]

    note right of cancelled
        Linked stock is given back.
        Order stays in history.
    end note
    note right of completed
        Counts toward sales
        in Dashboard and Reports.
    end note
```

## What staff do on each order card

```mermaid
flowchart LR
    Card["Order card<br/>customer · number · channel · pickup time<br/>items · total · paid · due"] --> B1["Next-step button<br/>Start preparing / Mark ready / Complete"]
    Card --> B2["Record payment<br/>(while not completed or cancelled)"]
    Card --> B3["Cancel order<br/>(asks to confirm)"]
```

## Finding orders

- When the app opens, the list shows **yesterday and today**, plus **any older order still open**. This means advance orders for later dates are not lost.
- Use the date range (up to **31 days**) and the status filter to search history. The summary shows totals per currency and leaves cancelled orders out.
- Every status change is time-stamped (`OrderStatusHistory`) and recorded in the staff activity log.

## Rules

- Completed and cancelled orders are final and cannot be changed.
- Cancelling an order **does not refund** payments. Refunds are not built, so handle them outside the POS.
