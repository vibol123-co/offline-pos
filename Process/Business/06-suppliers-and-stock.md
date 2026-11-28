# 6. Suppliers, stock and price history

**Pages:** Suppliers, Stock & Price History. **Who:** admin or staff with those pages.

## Setting up

```mermaid
flowchart LR
    A["Suppliers page:<br/>add supplier<br/>name, phone, email, notes"] --> C
    B["Stock page:<br/>add stock item<br/>name, category, unit g/ml/each,<br/>low-stock threshold"] --> C["Ready to receive stock<br/>and record prices"]
```

Stock categories: **ingredient** (flour, butter), **packaging** (boxes), **finished product** (cakes for sale, which can be linked to a product), **accessory** (candles, which can be linked to an add-on).

## Day-to-day stock tasks

```mermaid
flowchart TB
    S["Stock page"] --> R & W & Q & H
    R["Receive delivery"] --> R1["Pick supplier, currency, reference/invoice no."]
    R1 --> R2["Add one or more lines:<br/>stock item, quantity, total cost"]
    R2 --> R3["Save → stock goes UP<br/>purchase kept for price history"]

    W["Waste / adjustment"] --> W1{"Type"}
    W1 -- "Waste (spoiled, dropped)" --> W2["Quantity to remove"]
    W1 -- "Adjustment (count correction)" --> W3["Add or remove quantity"]
    W2 & W3 --> W4{"Would go below 0?"}
    W4 -- yes --> W5["Error: cannot go negative"]
    W4 -- no --> W6["Saved → stock updated"]

    Q["Record price quote"] --> Q1["Supplier, stock item,<br/>package size, price, date"]
    Q1 --> Q2["Saved for comparison.<br/>Stock does NOT change"]

    H["Price history"] --> H1["Pick a stock item"]
    H1 --> H2["Chart + list of purchases and quotes<br/>by supplier and date"]
```

## How stock changes automatically

| Event | Stock effect |
|-------|--------------|
| Order saved with a linked product or add-on | Goes down (reserved) |
| That order is cancelled | Goes back up |
| Order completed | No further change. The reservation was the sale |

Items at or below their **low-stock threshold** are flagged on the Stock page and the Dashboard.

> Not built: recipe-based use of ingredients. Selling a cake does not reduce flour. Record ingredient use with a **waste/adjustment** entry, or with regular stock counts.
