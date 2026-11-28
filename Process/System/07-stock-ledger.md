# 7. Stock ledger

Stock is never typed in as a number. It is a **ledger**: every change is a row in `StockMovements`, and `StockLevels` keeps the running balance for each item, so the app doesn't have to add up the whole history on every read.

```mermaid
flowchart LR
    subgraph Sources["What creates a movement"]
        R["receiveStock<br/>(Stock page)"] -->|"receipt +qty"| M
        W["adjustStock: waste<br/>(must remove)"] -->|"waste −qty"| M
        A["adjustStock: adjustment<br/>(add or remove)"] -->|"adjustment ±qty"| M
        O["createOrder with a product/add-on<br/>linked to a stock item"] -->|"sale_reserved −qty"| M
        X["updateOrderStatus → cancelled"] -->|"sale_released +qty"| M
    end
    M["addStockMovements_()"] --> SM[("StockMovements<br/>append-only")]
    M --> SL[("StockLevels<br/>on_hand_milli updated")]
    SL --> SNAP["getStockSnapshot_()<br/>on_hand, is_low = on_hand ≤ threshold"]
    SNAP --> UI["Stock page, Dashboard low-stock list,<br/>Reports low-stock count"]
```

## Guards

| Rule | Where |
|------|-------|
| An order is refused if a linked stock item doesn't have enough on hand | `validateLinkedStock_` in `createOrder` |
| A removal adjustment cannot make the balance negative | `adjustStock` |
| Waste can only remove stock | `adjustStock` |
| Products can link only to a `finished_product` stock item. Add-ons can link only to `accessory` or `packaging` | `createProduct`, `createAddOn` |
| A receipt needs an active supplier, at least one line, and a cost above zero | `receiveStock` |

## What is not built

- Recipe-based ingredient consumption: selling a cake does not reduce flour or sugar.
- Stock for a **completed** order stays reserved. The `sale_reserved` movement *is* the deduction, and only cancelling an order releases it.

## Repair

If `StockLevels` drifts from the movements (for example after hand edits to the Sheet), the owner runs `rebuildStockLevels()` from `Recovery.gs` to recalculate every balance from `StockMovements`.
