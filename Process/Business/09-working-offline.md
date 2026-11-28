# 9. Working offline

The POS can keep taking orders through a short internet drop, **but only if it was already open and signed in** before the connection went down.

```mermaid
flowchart TB
    A["Internet drops while the POS is open"] --> B["Top bar shows Offline"]
    B --> C["Keep working: save orders, status changes, payments, stock entries"]
    C --> D["Each save shows: 'Queued on this device.<br/>Not yet shared with other devices'"]
    D --> E["New orders appear as 'Pending sync'<br/>with no order number yet"]
    E --> F{"Internet back?"}
    F -- no --> C
    F -- yes --> G["Queued actions are sent automatically, oldest first"]
    G --> H{"All accepted?"}
    H -- yes --> I["Orders get real numbers;<br/>screens refresh"]
    H -- no --> J["Message: 'A queued action needs attention'<br/>(e.g. not enough stock). Fix it and redo"]
```

## Do and don't

| Do | Don't |
|----|-------|
| Keep the POS tab open during short outages | Close or reload the tab while offline. It won't open again until you're back online |
| Sign back in as the **same** user to send your queued actions | Expect other tills to see offline orders before they sync |
| Check the receipt says "Pending sync" and tell the customer | Hand over items reserved in stock without checking. Stock is only checked when the order syncs |

Queued actions are stored in this browser on this device only. Clearing the browser data before they sync loses them.
