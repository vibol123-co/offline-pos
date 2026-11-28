# 7. Dashboard and reports

## Dashboard: what needs attention right now

```mermaid
flowchart LR
    D["Dashboard"] --> K1["Orders today<br/>(not cancelled)"]
    D --> K2["Sales today USD<br/>(completed orders only)"]
    D --> K3["Sales today KHR<br/>(completed orders only)"]
    D --> K4["Low-stock count"]
    D --> L1["Up to 8 open orders<br/>new / preparing / ready<br/>tap → order detail"]
    D --> L2["Up to 8 low-stock items<br/>with quantity on hand"]
```

## Reports: a chosen period

```mermaid
flowchart TB
    A["Reports page"] --> B["Pick From / To dates"]
    B --> C["Run report"]
    C --> R1["Orders in period<br/>(excludes cancelled)"]
    C --> R2["Sales USD and Sales KHR<br/>(completed orders only)"]
    C --> R3["Low-stock items (now)"]
    C --> R4["Stock movements in period"]
    C --> R5{"Admin?"}
    R5 -- yes --> R6["Staff activity: latest 200 actions<br/>time, staff, action, record"]
    R5 -- no --> R7["Activity hidden"]
```

## Reading the numbers correctly

- **Sales count only completed orders.** An order that is paid but not yet marked Complete is not in sales yet.
- USD and KHR are reported **separately** and are never added together.
- Staff activity shows who created or changed what (orders, payments, stock, staff, settings). It comes from `AuditLog`.

> Using the staff activity log to judge a staff member's performance or to discipline them is a people decision. It needs proper context and HR process, not just this log.
