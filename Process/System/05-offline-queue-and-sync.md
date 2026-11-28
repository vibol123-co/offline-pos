# 5. Offline queue and sync

If the device loses the internet while the POS is **already open and signed in**, writes are kept in an IndexedDB "outbox" on that device. They are sent in order once the device is back online.

```mermaid
flowchart TB
    A["User saves something<br/>(order, status, payment, stock...)"] --> B["mutate_(): create requestId"]
    B --> C["callServer_()"]
    C --> D{"Success?"}
    D -- yes --> OK["Normal result"]
    D -- no --> E{"navigator.onLine == false<br/>AND signed in?"}
    E -- no --> ERR["Show error"]
    E -- yes --> F["putQueuedAction_<br/>{request_id, method, args, preview,<br/>created_by, created_at}"]
    F --> G["UI: 'Queued on this device,<br/>not yet shared'"]
    G --> H["Order shows as 'Pending sync'<br/>using the local preview"]

    ON(["Browser 'online' event<br/>or next sign-in"]) --> FL["flushPendingActions()"]
    FL --> S1["Take only actions created_by<br/>the current staff ID, oldest first"]
    S1 --> S2["callServer_(method, args)<br/>same requestId as the original"]
    S2 --> S3{"OK?"}
    S3 -- yes --> S4["Remove from outbox → next action"]
    S4 --> S2
    S3 -- no --> S5["Stop; show 'A queued action<br/>needs attention'"]
    S4 --> RF["When the queue is empty:<br/>refreshData()"]
```

## Rules and limits

- **Duplicate-safe.** Because the original `requestId` is sent again, the server returns the stored result if that request had in fact already arrived (see [Safe writes](03-api-call-and-safe-writes.md)).
- **Per staff member.** Only the signed-in staff member's own queued actions are sent. Another user's queue stays on the device until that user signs in.
- **Stops at the first failure,** so later actions that depend on it are not sent out of order.
- **Not supported offline:** starting the app, signing in, or loading or reading data.
- **Stock is checked at sync time,** not when the order was queued. A queued order can still be rejected for "Not enough stock".
