"""
Hard-skip list for in-store fixed-price clothing (Essentials / Bape / AP×Travis).

StockX / SSE / main.py must NEVER rewrite price, express_price, compareAt, or
Chemin qty for these. Keep in sync with:
  shopify/protection/adminOnlyProducts.ts
  shopify/inventory/inStockFixedPrice.ts

Essentials sacred prices (in-stock):
  sell = 59 CHF, express = 89 CHF

Env override (comma-separated numeric or GID ids):
  SHOPIFY_ADMIN_ONLY_PRODUCT_IDS=15340410732930,...
"""

from __future__ import annotations

import os
import re
from typing import Optional

# Essentials storefront — never StockX
ESSENTIALS_SELL_CHF = 59
ESSENTIALS_EXPRESS_CHF = 89

# Audemars × Travis — never StockX; express only when physical stock > 0
AUDEMARS_TRAVIS_SELL_CHF = 89
AUDEMARS_TRAVIS_EXPRESS_CHF = 109

# Bape — never StockX; express only when physical stock > 0
BAPE_SELL_CHF = 69
BAPE_EXPRESS_CHF = 99

AUDEMARS_TRAVIS_PRODUCT_IDS = frozenset(
    {
        "15115016733058",  # Vintage Tee Black
        "15115016831362",  # Watch Face Tee Green
    }
)

BAPE_PRODUCT_IDS = frozenset(
    {
        "15356478325122",  # Check by Bathing Tee
        "15356478357890",  # Big Ape Head Tee
    }
)

ESSENTIALS_PRODUCT_IDS = frozenset(
    {
        "15340410732930",  # Shorts Stretch Limo
        "15340410831234",  # Shorts Dark Oatmeal
        "15340410896770",  # Shorts Light Oatmeal
        "15340411617666",  # Tee Stretch Limo
        "15349630501250",  # Tee Light Oatmeal
        "15369534538114",  # Tee Dark Oatmeal
    }
)

# Mirror shopify/protection/adminOnlyProducts.ts HARDCODED_PRODUCT_IDS
HARDCODED_PRODUCT_IDS = frozenset(
    {
        *ESSENTIALS_PRODUCT_IDS,
        *AUDEMARS_TRAVIS_PRODUCT_IDS,
        *BAPE_PRODUCT_IDS,
    }
)

# Title patterns — store titles for in-stock lane only.
# Do NOT match broad "Fear of God Essentials *" (those are StockX dropship).
_TITLE_PATTERNS = tuple(
    re.compile(p, re.I)
    for p in (
        r"^Essentials Hoodie\b",
        r"^Essentials Tee\b",
        r"^Essentials Shorts\b",
        r"^Essentials Tees\b",
        r"^BAPE\b.*\bTee\b",
        r"A Bathing Ape.*\bTee\b",
        r"Big Ape Head Tee\b",
        r"Travis Scott.*Audemars.*\bTee\b",
        r"Audemars Piguet.*\bTee\b",
    )
)

# SKU bases from inStockFixedPrice.ts
_SKU_BASES = (
    "192HO246258F",
    "192HO246250F",
    "125HO244368F",
    "160BT212012F",
    "160BT212013F",
)


def normalize_shopify_numeric_id(value: Optional[str]) -> str:
    raw = str(value or "").strip()
    if not raw:
        return ""
    m = re.search(r"/(\d+)$", raw)
    if m:
        return m.group(1)
    digits = re.sub(r"\D", "", raw)
    return digits or raw


def _env_product_ids() -> set[str]:
    ids = set(HARDCODED_PRODUCT_IDS)
    raw = os.environ.get("SHOPIFY_ADMIN_ONLY_PRODUCT_IDS") or ""
    for part in raw.split(","):
        n = normalize_shopify_numeric_id(part.strip())
        if n:
            ids.add(n)
    return ids


def is_admin_only_product_id(product_id: Optional[str]) -> bool:
    n = normalize_shopify_numeric_id(product_id)
    return bool(n and n in _env_product_ids())


def _sku_matches_base(sku: str, base: str) -> bool:
    s = sku.strip().upper()
    b = base.strip().upper()
    return s == b or s.startswith(f"{b}-")


def is_in_stock_fixed_price_product(
    *,
    product_id: Optional[str] = None,
    title: Optional[str] = None,
    sku: Optional[str] = None,
) -> bool:
    """True if this listing is the fixed-price in-store clothing lane."""
    if is_admin_only_product_id(product_id):
        return True
    t = (title or "").strip()
    if t and any(p.search(t) for p in _TITLE_PATTERNS):
        return True
    s = (sku or "").strip()
    if s and any(_sku_matches_base(s, base) for base in _SKU_BASES):
        return True
    return False


def admin_only_skip_reason() -> str:
    return "admin_only_fixed_price_instock"
