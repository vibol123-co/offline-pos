# 5. Products and add-ons

**Page:** Products & Add-ons. **Who:** admin or staff with the `products` page.

```mermaid
flowchart TB
    A["Products & Add-ons page"] --> B{"Add what?"}
    B -->|Product| P["Name, category, size<br/>USD price and/or KHR price"]
    P --> P2{"Track it in stock?"}
    P2 -- yes --> P3["Link to a 'finished product' stock item"]
    P2 -- no --> P4["No link"]
    B -->|Add-on| D["Name<br/>USD and/or KHR price"]
    D --> D2{"Track it in stock?"}
    D2 -- yes --> D3["Link to an 'accessory' or 'packaging' stock item<br/>e.g. candles, boxes"]
    D2 -- no --> D4["No link"]
    P3 & P4 & D3 & D4 --> S["Save → appears on New Order cards"]
```

## Rules

- At least one price (USD or KHR) is required. An item with no price in a currency can't be sold in that currency.
- USD and KHR prices are **independent**. Nothing is converted automatically.
- To track a product's stock, first create the matching stock item on the **Stock** page with the right category.
- Order lines keep a **snapshot** of the name and price. Changing the catalog later does not alter past orders.

> Not in the app yet: editing or deactivating items. Today that is done by editing the `Products` / `AddOns` tab in the Sheet (set `active` to FALSE), then pressing **Refresh**.
