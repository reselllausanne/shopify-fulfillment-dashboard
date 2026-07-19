"""Series-based basketball shoe detection (Shopify sg-1-3-5)."""

from __future__ import annotations

import json
import os
import re

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RULES_PATH = os.path.join(BASE_DIR, "basketball_shoe_series.json")
TAXONOMY_BASKETBALL_SHOES = "gid://shopify/TaxonomyCategory/sg-1-3-5"

_RULES_CACHE: dict | None = None


def load_rules(path: str = RULES_PATH) -> dict:
    global _RULES_CACHE
    if _RULES_CACHE is not None and path == RULES_PATH:
        return _RULES_CACHE
    try:
        with open(path, "r", encoding="utf-8") as f:
            rules = json.load(f)
    except FileNotFoundError:
        return {"series": []}
    if path == RULES_PATH:
        _RULES_CACHE = rules
    return rules


def _normalize(text: str) -> str:
    return re.sub(r"\s+", " ", (text or "").lower().replace("_", " ").replace("-", " ")).strip()


def _brand_in_hay(hay: str, aliases: list[str]) -> bool:
    for alias in aliases:
        a = alias.lower().strip()
        if not a:
            continue
        if a in hay or a.replace(" ", "-") in hay.replace(" ", "-"):
            return True
    return False


def product_data_from_slug(slug: str) -> dict:
    """Minimal payload for slug-only series matching (bulk sync)."""
    slug = (slug or "").strip().lower()
    return {
        "title": slug.replace("-", " "),
        "url_key": slug,
        "handle": slug,
        "slug": slug,
        "brand": slug.split("-")[0] if slug else "",
    }


def match_basketball_shoe_series(product_data: dict, rules: dict | None = None) -> dict:
    """Series-only match. No generic 'basketball' title fallback."""
    rules = rules or load_rules()
    if not product_data or not isinstance(product_data, dict):
        return {
            "is_basketball_shoe": False,
            "matched_series": None,
            "matched_brand": None,
            "reason": "empty_payload",
            "excluded_by": None,
        }

    title = str(product_data.get("title") or "")
    handle = str(
        product_data.get("url_key") or product_data.get("handle") or product_data.get("slug") or ""
    )
    brand = str(product_data.get("brand") or "")
    pt = str(product_data.get("product_type") or product_data.get("productCategory") or "")
    hay_raw = f"{title} {handle} {brand} {pt}"
    hay = _normalize(hay_raw)
    hay_slug = handle.lower().replace("_", "-")

    for term in rules.get("hard_exclude_terms", []):
        t = term.lower()
        if t in hay_raw.lower() or t in hay_slug:
            return {
                "is_basketball_shoe": False,
                "matched_series": None,
                "matched_brand": None,
                "reason": "hard_exclude",
                "excluded_by": term,
            }

    for brand_key, brand_cfg in rules.get("brands", {}).items():
        aliases = brand_cfg.get("aliases", [brand_key.replace("_", " ")])
        brand_match = _brand_in_hay(hay, aliases) or _brand_in_hay(hay_slug.replace("-", " "), aliases)
        if not brand_match and brand_key != "other":
            continue

        for series in brand_cfg.get("series", []):
            series_id = series.get("id", "")
            for pattern in series.get("patterns", []):
                pat = pattern.lower()
                try:
                    matched = re.search(pat, hay, re.I) or re.search(
                        pat, hay_slug.replace("-", " "), re.I
                    )
                except re.error:
                    matched = pat in hay or pat in hay_slug.replace("-", " ")
                if matched:
                    return {
                        "is_basketball_shoe": True,
                        "matched_series": f"{brand_key}.{series_id}",
                        "matched_brand": brand_key,
                        "reason": f"series:{pattern}",
                        "excluded_by": None,
                    }

    return {
        "is_basketball_shoe": False,
        "matched_series": None,
        "matched_brand": None,
        "reason": "no_series_match",
        "excluded_by": None,
    }


def is_basketball_shoe_product(product_data: dict) -> bool:
    return bool(match_basketball_shoe_series(product_data).get("is_basketball_shoe"))


def basketball_shoe_match_info(product_data: dict) -> dict:
    return match_basketball_shoe_series(product_data)
