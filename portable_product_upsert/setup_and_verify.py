#!/usr/bin/env python3
"""
One-shot setup for the portable product upsert package.

1) Load .env
2) Create Shopify metafield definition custom.price_locked (boolean on ProductVariant)
3) Smoke-check Admin API + Kicks resolve

Usage:
  cp .env.example .env   # paste secrets from main codebase
  pip install -r requirements.txt
  python3 setup_and_verify.py
"""

from __future__ import annotations

import os
import sys

from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))


def _require_env():
    shop = (os.getenv("SHOP_NAME_SHOPIFY") or "").strip()
    token = (os.getenv("ACCESS_TOKEN_SHOPIFY") or os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN") or "").strip()
    missing = []
    if not shop:
        missing.append("SHOP_NAME_SHOPIFY")
    if not token:
        missing.append("ACCESS_TOKEN_SHOPIFY (or SHOPIFY_ADMIN_ACCESS_TOKEN)")
    if missing:
        print("[FAIL] Missing env:", ", ".join(missing))
        print("Copy .env.example → .env and paste values from the main automation codebase.")
        return False
    print(f"[OK] Shop={shop} token=***{token[-6:]}")
    return True


def main() -> int:
    if not _require_env():
        return 1

    from shopifyAPI_GQL import (
        ensure_price_locked_metafield_definition,
        get_first_location_id,
        search_products,
    )
    import stockXAPI

    print("\n== Create / verify custom.price_locked metafield ==")
    mf = ensure_price_locked_metafield_definition(force=True)
    if not mf.get("ok"):
        print("[FAIL] metafield definition:", mf)
        return 2
    print("[OK] metafield:", mf)

    print("\n== Shopify location ==")
    loc = get_first_location_id(force_refresh=True)
    print("[OK] online location:", loc)

    print("\n== Shopify search smoke ==")
    hits = search_products("status:active", limit=1)
    print("[OK] products search hits:", len(hits), (hits[0].get("handle") if hits else None))

    print("\n== Kicks/StockX resolve smoke ==")
    slug = stockXAPI.resolve_slug_from_query("HF5386-001")
    print("[OK] resolve HF5386-001 ->", slug)

    print("\n[READY] Drop this folder into the other codebase, keep .env, then:")
    print("  from product_upsert_api import upsert_product, lock_price, mark_sold")
    print("  upsert_product('<slug|sku|gtin>')")
    return 0


if __name__ == "__main__":
    sys.exit(main())
