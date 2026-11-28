# Bakery POS: new look (build guide)

This folder is the design source for restyling the app in `apps_script/`. It is a **restyle only**: the logic is done and tested.

## Files

| Path | What it is |
|---|---|
| `mockups/tokens.css` | Design tokens and shared components. Copy into `apps_script/Styles.html`. |
| `mockups/*.html` | One mockup per screen. Open them in a browser; this is the source of truth. |
| `mockups/notes.js` | Builder overlay. Add `?notes` to any mockup URL (for example `orders.html?notes`). |
| `mockups/phone-frame.html` | Shows a mockup at a true 390 px width: `phone-frame.html?src=orders.html&h=1900`. |
| `screenshots/` | PNGs of every screen and state. `screenshots/notes/` = the same with the overlay on. |

## Reading the overlay (`?notes`)

- **Purple tag**: the real element in `apps_script/index.html` or the real form field `name` this part restyles. Keep that id/name.
- **Pink tag "OPTIONAL"**: a display-only extra that does not exist today. Build it only if the owner approves; skip it otherwise.
- Untagged parts are layout and decoration around those elements.
- Each mockup starts with a `BUILD NOTES` comment listing its states (`#hash`) and rules. Read it first.

## Rules

1. Do not change calculations, element ids, form field names, server calls, the offline queue, or any `.gs` file.
2. Edit only `index.html` (markup/layout), `Styles.html` (CSS) and `Client.html` for presentation only (classes, show/hide, text formatting, splitting an existing text into styled parts).
3. Keep every feature and page reachable. Menu labels may change ("Products & add-ons" shows as **Catalog**), but `data-screen` values and staff page permissions stay the same. **Suppliers stays its own page.**
4. No new libraries or web fonts. WCAG AA contrast. Touch targets at least 44 px.
5. Test with sample data only.

## Screens and states

| Screen | Mockup | States |
|---|---|---|
| Dashboard | `dashboard.html` | `#expired` (sign-in expired) |
| New order | `new-order.html` | `#exact` (no change due), `#details` (order details open, custom cake) |
| Orders + Record payment | `orders.html` | `#payment` |
| Stock | `stock.html` | `#receive` (receive drawer), `#history` (price history tab) |
| Catalog (Products & add-ons) | `catalog.html` | `#add` (add product drawer) |
| Settings | `settings.html` | |
| Receipt (screen and 80 mm print) | `receipt.html` | |

Not mocked: Sign-in, Suppliers, Reports. Restyle them with the same tokens and components (card, form fields, table, buttons).

## Sync pill (replaces `#refresh-button`)

The app has **no timed auto-refresh**, so the pill is the manual refresh and shows how fresh the data is. Use existing state only (`lastRefreshAt`, `navigator.onLine`, queue count, `accessTokenExpiresAt`):

| State | Look | Action |
|---|---|---|
| Fresh | green "Synced · N min ago ⟳" | click = `refreshData()` |
| Stale (> 10 min) | amber "Last synced N min ago" + **Refresh** button | `refreshData()` |
| Refreshing | grey "Refreshing…" | disabled |
| Offline | amber "Offline · N queued" | disabled |
| Sign-in expired | red "Sign-in expired" + **Reconnect** button + red banner | existing sign-in flow |

A timer that only updates the "N min ago" text and the stale state is allowed. It must never trigger loading.

## Open decisions (ask the owner)

- KHR display `៛50,700` instead of `KHR 50,700` (only `moneyFromMinor` formatting). Test the ៛ glyph on the shop device and the receipt printer first.
- All pink "OPTIONAL" extras.

## Done means

- No id or field name changed (diff check); no `.gs` change.
- Checked at 390, 1024 and 1440 px, plus browser print preview of a new receipt and a reprint.
- Full flow works: sign in, new order (received in USD and in KHR, with and without change), receipt, status changes, record payment, reprint, offline order, back online sync.
