# Product and add-on photos

Put photos for the New Order product cards in this folder. They are published with the website, so **only use photos that are fine to be public**.

## Add a photo to a product

1. **Prepare the photo**
   - Square works best (cards are square), around **400 × 400 px**.
   - JPG for photos, PNG for graphics. Keep each file under about **150 KB** so the till loads fast.
   - File name: letters, numbers, `-`, `_` or `.` only, no spaces, e.g. `chocolate-cake-6in.jpg`.
2. **Copy the file into this folder** (`apps_script/web/products/`).
3. **Link it to the product**, in either of two ways:
   - **New product:** type the file name in **Photo (optional)** on the Products & Add-ons page.
   - **Existing product:** open the POS Google Sheet, go to the `Products` (or `AddOns`) tab, and type the file name in the `image` column of that row. Then press **Refresh** in the POS.
4. **Publish:** rebuild and deploy the site (`python scripts/build_github_pages.py`, or push to `main`). Until then, the card shows the default emoji.

You can also use a full `https://…` link to an image hosted elsewhere, but it breaks if that site moves or removes the picture.

If the file name is wrong or the file is missing, the card falls back to the emoji icon. Nothing breaks.
