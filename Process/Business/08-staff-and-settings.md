# 8. Staff accounts and settings

**Page:** Settings. **Who:** admin only.

## Add or change a staff account

```mermaid
flowchart TB
    A["Settings → Staff access"] --> B{"New or existing?"}
    B -- new --> C["Clear form"]
    B -- existing --> D["Pick the staff member from the list"]
    C & D --> E["Username (3–40: letters, numbers, . _ -)<br/>Display name"]
    E --> F["Password (4–128 chars)<br/>required for new; blank = keep current"]
    F --> G{"Role"}
    G -- Admin --> H["Gets every page automatically"]
    G -- Cashier --> I["Tick the pages they may use<br/>(at least one, never Settings)"]
    H & I --> J["Active on/off"]
    J --> K["Save"]
    K --> L{"Checks"}
    L -- "username taken" --> X1["Error"]
    L -- "would leave no active admin<br/>or you removing your own admin" --> X2["Error"]
    L -- OK --> M["Saved"]
    M --> N{"Password changed<br/>or account turned on/off?"}
    N -- yes --> O["That person is signed out everywhere"]
    N -- no --> P["Takes effect on their next page load"]
```

## Shop settings

| Setting | Effect |
|---------|--------|
| Default currency (USD / KHR) | Currency picked automatically on New Order |
| Tax rate (basis points, 0–10000; e.g. 1000 = 10%) | Added to every new order: (subtotal − discount) × rate |

Backup retention (days) is read from the `Settings` tab by the backup project. It isn't set from this page.

## Good practice

- Give each person their **own** username, so the activity log stays meaningful.
- Passwords are visible to admins and are stored in plain text in the Sheet, so **never reuse a Google or personal password**.
- Disable leavers rather than deleting them, so that their past activity still has a name against it.
