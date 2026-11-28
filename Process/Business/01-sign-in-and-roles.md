# 1. Sign in, roles and page access

## Signing in

```mermaid
flowchart TB
    A["Open the POS page"] --> B["Click 'Connect' → Google pop-up"]
    B --> C{"Chose the shop<br/>Google account?"}
    C -- no --> E1["Error: 'Connect using the configured<br/>shop Google account'"] --> B
    C -- yes --> D["Username + password form appears"]
    D --> F["Enter POS username + password"]
    F --> G{"Correct and<br/>account active?"}
    G -- "wrong / disabled" --> E2["'Username or password is incorrect'"] --> F
    G -- "no password set" --> E3["'Ask an administrator'"]
    G -- yes --> H["App opens (Dashboard by default),<br/>showing only the pages you may use"]
```

Staff don't need their own Google account. The **shop** Google account is connected once in each browser, and everyone then uses their own POS login.

## Changing who is at the till

| Button | When to use it | What happens |
|--------|----------------|--------------|
| **Switch user** | Shift change, or a colleague takes over | You are signed out of the POS. The shop Google connection stays, so the next person only types their username and password |
| **Change Google account** | The wrong Google account was connected | The Google connection is removed. Connect again, then sign in |

You are signed out automatically **after 6 hours**, or straight away if an admin changes your password or disables your account.

## Roles and pages

```mermaid
flowchart LR
    subgraph Admin["Admin: always all pages"]
        direction TB
        a1[Dashboard] ~~~ a2[New Order] ~~~ a3[Orders] ~~~ a4[Products & Add-ons]
        a5[Suppliers] ~~~ a6[Stock] ~~~ a7[Reports] ~~~ a8[Settings]
    end
    subgraph Cashier["Cashier: only the pages an admin ticks"]
        direction TB
        c1["Any of: Dashboard, New Order, Orders,<br/>Products, Suppliers, Stock, Reports"]
        c2["Never: Settings"]
    end
```

- Pages you can't use are hidden in the menu, and the server refuses them as well.
- Only admins see **staff activity** in Reports.
- At least one active admin must always exist. An admin cannot remove their own admin access.
