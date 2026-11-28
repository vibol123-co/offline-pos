# 6. Data model (Google Sheet tabs)

Each table is one tab in the operational spreadsheet. `Schema.gs` (`TABLE_SCHEMAS`) defines the column order and checks it. Renaming or reordering columns stops the API. Money is stored as integer minor units (USD cents, whole KHR riel). Quantities are stored ×1000 (`_milli`).

```mermaid
erDiagram
    Orders ||--|{ OrderItems : contains
    Orders ||--o{ Payments : "paid by"
    Orders ||--|{ OrderStatusHistory : "status changes"
    Products ||--o{ OrderItems : "item_type=product"
    AddOns ||--o{ OrderItems : "item_type=add_on"
    InventoryItems |o--o{ Products : "linked finished_product"
    InventoryItems |o--o{ AddOns : "linked accessory/packaging"
    InventoryItems ||--o{ StockMovements : ledger
    InventoryItems ||--|| StockLevels : "current balance"
    Suppliers ||--o{ PurchaseReceipts : delivers
    PurchaseReceipts ||--|{ PurchaseLines : lines
    InventoryItems ||--o{ PurchaseLines : received
    Suppliers ||--o{ SupplierPriceQuotes : quotes
    InventoryItems ||--o{ SupplierPriceQuotes : "priced item"
    StaffAccess ||--o{ AuditLog : "actor_id"

    Orders {
        string id PK
        string order_number "BP-yyyyMMdd-XXXXXX"
        string customer_name
        string customer_phone
        string order_type "walk_in|advance|custom_cake"
        string order_channel "walk_in|grab|other"
        string fulfillment_method "pickup|delivery"
        string status "new|preparing|ready|completed|cancelled"
        string currency "USD|KHR"
        int subtotal_minor
        int discount_minor
        int tax_minor
        int delivery_fee_minor
        int total_minor
        string custom_details_json "flavor,size,inscription"
    }
    OrderItems {
        string id PK
        string order_id FK
        string item_type "product|add_on|custom"
        string catalog_item_id
        string name_snapshot
        string inventory_item_id
        int quantity
        int unit_price_minor
    }
    Payments {
        string id PK
        string order_id FK
        int amount_minor
        string method "cash|card_terminal|other"
        string status "completed"
    }
    Products {
        string id PK
        string name
        string category
        string size
        int price_usd_minor
        int price_khr_minor
        string inventory_item_id FK
        bool active
    }
    AddOns {
        string id PK
        string name
        int price_usd_minor
        int price_khr_minor
        string inventory_item_id FK
    }
    InventoryItems {
        string id PK
        string name
        string category "ingredient|packaging|finished_product|accessory"
        string base_unit "g|ml|each"
        int low_stock_threshold_milli
    }
    StockMovements {
        string id PK
        string inventory_item_id FK
        string movement_type "receipt|waste|adjustment|sale_reserved|sale_released"
        int quantity_delta_milli
        string reference_id
    }
    StockLevels {
        string id PK
        int on_hand_milli
    }
    StaffAccess {
        string id PK
        string username
        string password "plaintext by design"
        string role "admin|cashier"
        string allowed_pages_json
        int session_version
        bool active
    }
    AuditLog {
        string id PK
        string actor_id FK
        string action
        string entity_id
    }
```

## Support tables (no relationships drawn)

| Tab | Purpose |
|-----|---------|
| `Settings` | `default_currency`, `tax_rate_basis_points`, `supported_currencies`, `backup_retention_days` |
| `RequestLog` | One row per successful write (request ID → stored result), used for duplicate-safe retries |
| `BackupLog` | Written by the backup project: file ID, name, status, message |

## Customer directory

Customers are not stored in a table of their own. `getCustomerDirectory_` builds them from `Orders`, grouped by phone number (digits only, at least 5). It keeps the latest name and location and counts the orders.
