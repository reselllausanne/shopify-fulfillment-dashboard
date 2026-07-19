#!/usr/bin/env python3
"""
Create a single product from StockX URL using the full main.py pipeline.
Usage: python3 create_single.py <stockx-url-slug>
Example: python3 create_single.py nike-dunk-low-panda
"""

import sys

from shopifyAPI_GQL import find_product_by_stockx_slug
from main import process_single_url_enhanced


def create_single_product(url_slug):
    """Create via main.py if missing; update if legacy handle match finds existing product."""
    url_slug = (url_slug or "").strip()
    if not url_slug:
        print("[ERROR] Empty slug")
        return False

    print(f"\n[INFO] Processing via main.py pipeline: {url_slug}")

    existing, via = find_product_by_stockx_slug(url_slug)
    if existing:
        print(f"[INFO] Product already exists ({via}): {existing.get('title')}")
        print(f"[INFO] Running full UPDATE (prices, metafields, SEO, alt, slug sync)...")
        action = "update"
    else:
        print(f"[INFO] No existing product — running full CREATE...")
        action = "create"

    return bool(process_single_url_enhanced(url_slug, action, shopify_products=[], skip_creates_on_limit=True))


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python3 create_single.py <stockx-url-slug>")
        print("Example: python3 create_single.py nike-dunk-low-panda")
        sys.exit(1)

    success = create_single_product(sys.argv[1])
    sys.exit(0 if success else 1)
