# Portable Product Upsert (Shopify + StockX/Kicks)

Self-contained drop-in package. Same create/update pipeline as the Resell Lausanne automation.

**Already done on current store:** metafield `custom.price_locked` (boolean, ProductVariant) created.  
`setup_and_verify.py` / import of `product_upsert_api` recreates it on any store if missing.

---

## Transfer (other codebase)

1. Copy whole folder `portable_product_upsert/` into the other project.
2. Copy `.env` from this automation codebase into the folder (or fill `.env.example`).
3. Install deps + setup:

```bash
cd portable_product_upsert
cp /path/to/main/codebase/.env .env    # or fill .env.example
pip install -r requirements.txt
python3 setup_and_verify.py
```

4. Plug in:

```python
import sys
sys.path.insert(0, "/absolute/path/to/portable_product_upsert")

from product_upsert_api import (
    upsert_product, resolve_input,
    lock_price, unlock_price, set_variant_price, mark_sold,
)

# Create if missing / update if exists (full product: images, variants, metafields, publish)
upsert_product("nike-dunk-low-retro-white-black-2021")
upsert_product("HF5386-001")        # style SKU
upsert_product("197594626522")      # GTIN/barcode

# Lock price so automation will not overwrite until sold
lock_price(barcode="197594626522")
set_variant_price(199.0, barcode="197594626522", lock=True)

# Sold → qty=0, keep price, unlock
mark_sold(barcode="197594626522")
```

CLI:

```bash
python3 product_upsert_api.py resolve <slug|sku|gtin>
python3 product_upsert_api.py upsert <slug|sku|gtin> --lock
python3 product_upsert_api.py set-price <gtin|variant_gid> 199
python3 product_upsert_api.py mark-sold <gtin|variant_gid>
python3 product_upsert_api.py lock <gtin|variant_gid>
python3 product_upsert_api.py unlock <gtin|variant_gid>
```

---

## Env keys (must match main codebase)

| Key | Required |
|---|---|
| `SHOP_NAME_SHOPIFY` | yes |
| `ACCESS_TOKEN_SHOPIFY` | yes |
| `API_VERSION_SHOPIFY` | yes (e.g. `2026-04`) |
| `SHOPIFY_ONLINE_LOCATION_ID` | recommended |
| `KICKSDB_API_KEY` | optional (fallback baked in) |

---

## Behavior

| Action | What happens |
|---|---|
| `upsert` missing | Full create: productCreate → images → metafields → variants → publish |
| `upsert` exists | Full update; **skips price** if `custom.price_locked=true` |
| `lock` | Sets variant metafield `custom.price_locked=true` |
| `mark-sold` | Inventory qty → 0, keep price, unlock by default |
| Input | StockX slug, URL, style SKU, or GTIN |

Variant match: size title (EU) or barcode.

---

## Files

- `product_upsert_api.py` — public API / CLI
- `setup_and_verify.py` — creates metafield + smoke checks
- `main.py`, `shopifyAPI_GQL.py`, `stockXAPI.py`, … — create/update engine
- `.env.example` — template (paste real `.env` from main codebase)

Do **not** commit real `.env`.
