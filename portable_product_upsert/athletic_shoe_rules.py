"""StockX breadcrumb rules → Shopify Athletic Shoes (aa-8-1). Basketball excluded."""

from __future__ import annotations

import html
import re

from basketball_shoe_rules import is_basketball_shoe_product

TAXONOMY_ATHLETIC_SHOES = "gid://shopify/TaxonomyCategory/aa-8-1"
TAXONOMY_SNEAKERS = "gid://shopify/TaxonomyCategory/aa-8-8"

# (L1, L2) StockX breadcrumb values (lowercase)
_ATHLETIC_L2 = frozenset({"performance", "spikes", "trail", "running"})
# Performance L2 alone is too broad (SB Dunk etc.) — only these L2 always map.
_ATHLETIC_L2_STRICT = frozenset({"spikes", "trail", "running"})

# StockX tags skate SB as Sneakers > Performance — keep Sneakers.
_PERFORMANCE_EXCLUDE_RE = re.compile(
    r"(?:"
    r"sb[-\s]+dunk|dunk[-\s]+sb|nike[-\s]+sb|"
    r"skateboard|skate[-\s]?board|"
    r"dunk[-\s]+low[-\s]+pro|dunk[-\s]+high[-\s]+pro"
    r")",
    re.I,
)


def _product_haystack(product_data: dict) -> str:
    title = str(product_data.get("title") or "")
    handle = str(
        product_data.get("handle") or product_data.get("url_key") or product_data.get("slug") or ""
    )
    return f"{title} {handle}".lower()


def _is_performance_skate_exclusion(product_data: dict) -> bool:
    """SB Dunk / skate Performance — stay Sneakers, not Athletic Shoes."""
    hay = _product_haystack(product_data)
    if _PERFORMANCE_EXCLUDE_RE.search(hay):
        return True
    cat = parse_category_from_description(product_data.get("description") or "").lower()
    if "skateboard" in cat or "skate" in cat.split(">"):
        return True
    return False


def _breadcrumb_map(product_data: dict) -> dict[int, str]:
    out: dict[int, str] = {}
    for b in product_data.get("breadcrumbs") or []:
        if not isinstance(b, dict):
            continue
        level = b.get("level")
        val = (b.get("value") or b.get("alias") or "").strip().lower()
        if level is not None and val:
            out[int(level)] = val
    return out


def parse_stockx_category_label(label: str) -> tuple[str, str]:
    """Parse 'Sneakers > Performance' → ('sneakers', 'performance')."""
    if not label:
        return "", ""
    parts = [p.strip().lower() for p in re.split(r"\s*>\s*", label) if p.strip()]
    if len(parts) >= 2:
        return parts[0], parts[1]
    if len(parts) == 1:
        return parts[0], ""
    return "", ""


def parse_category_from_description(description: str) -> str:
    """Extract 'Sneakers > Performance' from Shopify/StockX description HTML."""
    if not description:
        return ""
    text = html.unescape(description)
    m = re.search(r"Category:</strong>\s*([^<\n]+)", text, re.I)
    if m:
        return m.group(1).strip()
    m = re.search(r"Category:\s*([^\n<]+)", text, re.I)
    return m.group(1).strip() if m else ""


def product_data_from_description(description: str, *, title: str = "", handle: str = "") -> dict:
    """Build minimal product_data dict from embedded Category line."""
    cat = parse_category_from_description(description)
    payload: dict = {"description": description, "title": title, "handle": handle, "breadcrumbs": []}
    if not cat:
        return payload
    parts = [p.strip() for p in re.split(r"\s*>\s*", cat) if p.strip()]
    if parts:
        payload["breadcrumbs"].append({"level": 1, "value": parts[0]})
    if len(parts) >= 2:
        payload["breadcrumbs"].append({"level": 2, "value": parts[1]})
    return payload


def is_athletic_shoe_product(product_data: dict | None) -> bool:
    """
    True when StockX classifies as performance / spikes / trail / running shoe.
    False for basketball (series rules) and lifestyle sneakers.
    """
    if not product_data or not isinstance(product_data, dict):
        return False
    if is_basketball_shoe_product(product_data):
        return False

    bc = _breadcrumb_map(product_data)
    l1 = bc.get(1, "")
    l2 = bc.get(2, "")
    if l1 in ("sneakers", "shoes"):
        if l2 in _ATHLETIC_L2_STRICT:
            return True
        if l2 == "performance" and not _is_performance_skate_exclusion(product_data):
            return True

    # Fallback: Category line embedded in description (bulk fix without StockX).
    cat_label = parse_category_from_description(product_data.get("description") or "")
    if cat_label:
        p1, p2 = parse_stockx_category_label(cat_label)
        if p1 in ("sneakers", "shoes"):
            if p2 in _ATHLETIC_L2_STRICT:
                return True
            if p2 == "performance" and not _is_performance_skate_exclusion(product_data):
                return True

    return False


def athletic_shoe_match_reason(product_data: dict) -> str:
    bc = _breadcrumb_map(product_data)
    if bc.get(2) in _ATHLETIC_L2:
        return f"breadcrumb:{bc.get(1)}>{bc.get(2)}"
    cat = parse_category_from_description(product_data.get("description") or "")
    if cat:
        return f"description:{cat}"
    return "no_match"
