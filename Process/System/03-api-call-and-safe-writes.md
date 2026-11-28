# 3. API call and safe writes

Every read and write takes the same route: `DataService` → Execution API → Apps Script function. Writes ("mutations") also run through `runIdempotent_` in `Schema.gs`. It holds a script lock, uses the request ID so a retry is never applied twice, writes the audit row and records the result.

## Read call

```mermaid
sequenceDiagram
    participant UI as Screen
    participant DS as DataService.callServer_
    participant X as Execution API
    participant F as Apps Script function
    UI->>DS: e.g. getOrderHistory(params)
    DS->>DS: getAccessToken_() (reuse until 6 min before expiry)
    DS->>X: POST scripts/{deploymentId}:run<br/>{function, parameters + sessionToken}
    X->>F: run
    F->>F: requirePageAccess_ → ensureSchema_ → read tables
    F-->>X: result or thrown Error
    X-->>DS: {response.result} or {error.details[0].errorMessage}
    DS-->>UI: data, or an Error shown as a notice
```

## Write call (idempotent)

```mermaid
flowchart TB
    A["Screen action, e.g. Save order"] --> B["DataService.mutate_<br/>new requestId = crypto.randomUUID()"]
    B --> C{"Call succeeds?"}
    C -- "network fails while offline" --> Q["Store in IndexedDB outbox<br/>see 05-offline-queue"]
    C -- "server error" --> ERR["Show error notice"]
    C -- yes --> D

    subgraph Server["Apps Script: runIdempotent_(requestId, action, work, actor)"]
        D["requirePageAccess_ / requireAdmin_<br/>→ actor"] --> L["Take script lock (wait up to 30s)"]
        L --> P{"requestId seen before?<br/>check cache, then RequestLog"}
        P -- "yes, same action" --> R1["Return the stored result<br/>(no second write)"]
        P -- "yes, other action" --> R2["Error: request id reused"]
        P -- no --> W["work(): validate + append/upsert rows"]
        W --> AU["Append AuditLog row<br/>actor, action, entity_id"]
        AU --> RL["Append RequestLog row + cache result 6h"]
        RL --> FL["SpreadsheetApp.flush()"]
        FL --> UL["Release lock"]
    end
    UL --> OK["Return result → screen shows 'Saved'"]
    R1 --> OK
```

## Write functions and the permission each needs

| Function | Page or role checked | Tables written |
|----------|------------------------|----------------|
| `createOrder` | `new-order` | Orders, OrderItems, OrderStatusHistory, Payments, StockMovements, StockLevels |
| `updateOrderStatus` | `orders` | Orders, OrderStatusHistory (+ StockMovements on cancel) |
| `recordPayment` | `orders` | Payments |
| `createProduct`, `createAddOn` | `products` | Products, AddOns |
| `createSupplier` | `suppliers` | Suppliers |
| `createInventoryItem`, `recordSupplierPriceQuote`, `receiveStock`, `adjustStock` | `stock` | InventoryItems, SupplierPriceQuotes, PurchaseReceipts, PurchaseLines, StockMovements, StockLevels |
| `updateSettings`, `updateStaffAccess` | admin | Settings, StaffAccess |

Every write above also adds rows to `AuditLog` and `RequestLog`.
