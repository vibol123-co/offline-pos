# 0. A day in the shop (end to end)

How the screens fit together in a normal working day. Each box links to a detailed process.

```mermaid
flowchart TB
    subgraph Open["Opening"]
        O1["Open the POS link on the shop device"] --> O2["Connect the shop Google account<br/>(once per browser session)"]
        O2 --> O3["Staff sign in with their POS username + password"]
        O3 --> O4["Dashboard: orders needing attention,<br/>low-stock items, today's sales"]
    end

    subgraph Sell["Selling, all day"]
        S1["New Order: pick items, customer,<br/>channel, payment"] --> S2["Receipt shown;<br/>order status = new"]
        S2 --> S3["Orders: Start preparing → Mark ready → Complete"]
        S3 --> S4["Record payment for any balance due"]
        S1 -. "deposit for advance / custom cake" .-> S4
    end

    subgraph Back["Back office, as needed"]
        B1["Stock: receive a supplier delivery"]
        B2["Stock: record waste / adjustment"]
        B3["Suppliers: add a supplier,<br/>Stock: record a price quote"]
        B4["Products & Add-ons: add new items"]
    end

    subgraph Close["Closing"]
        C1["Orders: check nothing is left open<br/>or cancel no-shows"] --> C2["Reports: sales by currency,<br/>stock movements, staff activity"]
        C2 --> C3["Switch user / close browser"]
        C3 --> C4["About 2 AM: automatic Drive backup"]
    end

    Open --> Sell --> Close
    Sell <--> Back
```

## Detailed processes

1. [Sign in, roles and page access](01-sign-in-and-roles.md)
2. [Take a new order](02-take-a-new-order.md)
3. [Order lifecycle](03-order-lifecycle.md)
4. [Record a payment](04-record-a-payment.md)
5. [Products and add-ons](05-products-and-addons.md)
6. [Suppliers and stock](06-suppliers-and-stock.md)
7. [Dashboard and reports](07-dashboard-and-reports.md)
8. [Staff accounts and settings](08-staff-and-settings.md)
9. [Working offline](09-working-offline.md)
