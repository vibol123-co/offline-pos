# 2. Take a new order

**Page:** New Order. **Who:** cashier or admin with the `new-order` page.

```mermaid
flowchart TB
    A["Open New Order"] --> B["Choose currency: USD or KHR<br/>(no automatic conversion)"]
    B --> C["Tap product / add-on cards to add to cart<br/>or add a custom item with name + price"]
    C --> D["Adjust quantities in the cart"]
    D --> E["Customer phone (optional)"]
    E --> F{"Phone matches a<br/>previous customer?"}
    F -- yes --> G["Name + location filled in automatically"]
    F -- no --> H["Type name / location"]
    G & H --> I["Order type"]
    I --> I1["Walk-in"]
    I --> I2["Advance order<br/>set pickup date/time"]
    I --> I3["Custom cake<br/>flavor, size, inscription + pickup time"]
    I1 & I2 & I3 --> J["Channel"]
    J --> J1["Walk-in → pickup"]
    J --> J2["Grab → delivery<br/>delivery fee"]
    J --> J3["Other"]
    J1 & J2 & J3 --> K["Discount (optional)"]
    K --> L["Amount paid now + method<br/>cash / card terminal / other<br/>(0 = pay later, part = deposit)"]
    L --> M["Notes → Save order"]
    M --> N{"Server checks"}
    N -- "item has no price in this currency" --> X1["Error: pick another currency or item"]
    N -- "not enough linked stock" --> X2["Error: 'Not enough stock for …'"]
    N -- "discount > subtotal<br/>or paid > total" --> X3["Error: fix the amounts"]
    N -- OK --> O["Receipt with order number BP-yyyyMMdd-XXXXXX<br/>status = new; cart cleared"]
    N -- "device offline" --> P["Receipt shows 'Pending sync'<br/>see 09-working-offline"]
```

## How the total is calculated (on the server)

```
subtotal  = Σ (unit price × quantity)          prices come from the catalog, not the screen
tax       = (subtotal − discount) × tax rate    tax rate is set in Settings
total     = subtotal − discount + tax + delivery fee
balance   = total − payments received
```

## Rules to know

- An order needs **at least one item**.
- Each catalog item must have a price in the chosen currency.
- A **Grab** order is always delivery, and a **walk-in** order is always pickup.
- Products linked to stock (for example ready-made cakes) **reserve stock** as soon as the order is saved.
- Customers are remembered by phone number from past orders. There is no separate customer list to maintain.
