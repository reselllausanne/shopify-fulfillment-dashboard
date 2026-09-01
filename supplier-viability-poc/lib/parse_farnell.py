"""Farnell / element14 API + limited HTML."""

from __future__ import annotations

import json
import re
from typing import Optional
from urllib.parse import urlencode

from lib.gtin import classify_gtin
from lib.schema import empty_product

API_BASE = "https://api.element14.com/catalog/products"
STORE_ID = "ch.farnell.com"


def api_configured(api_key: Optional[str]) -> bool:
    return bool(api_key and api_key.strip() and api_key.strip() not in ("YOUR_KEY", "changeme"))


def build_api_url(term: str, api_key: str, *, offset: int = 0, n: int = 20) -> str:
    q = {
        "term": term,
        "storeInfo.id": STORE_ID,
        "resultsSettings.offset": str(offset),
        "resultsSettings.numberOfResults": str(n),
        "resultsSettings.responseGroup": "large",
        "callInfo.apiKey": api_key,
        "callInfo.responseDataFormat": "JSON",
    }
    return f"{API_BASE}?{urlencode(q)}"


def parse_api_product(item: dict, *, sample_bucket: str = "") -> dict:
    row = empty_product("farnell", sample_bucket=sample_bucket, currency="CHF")
    row["supplier_sku"] = str(item.get("sku") or item.get("id") or "")
    row["name"] = item.get("displayName") or item.get("productDescription") or ""
    row["brand"] = item.get("brandName") or ""
    row["mpn"] = item.get("translatedManufacturerPartNumber") or item.get("manufacturerPartNumber") or ""
    row["product_url"] = item.get("productUrl") or ""
    prices = item.get("prices") or []
    if prices:
        row["price"] = str(prices[0].get("cost") or "")
        row["price_tiers"] = json.dumps(prices)[:500]
    inv = item.get("inventory") or {}
    if isinstance(inv, dict):
        row["stock"] = str(inv.get("quantities") or inv.get("status") or "")
    gtin = None
    for a in item.get("attributes") or []:
        if not isinstance(a, dict):
            continue
        label = str(a.get("attributeLabel") or a.get("label") or "").lower()
        if "ean" in label or "gtin" in label or "upc" in label:
            gtin = a.get("attributeValue") or a.get("value")
            break
    packing = str(item.get("packSize") or "")
    row["packaging"] = packing
    cls = classify_gtin(gtin, mpn=row["mpn"] or None, packaging_hint=packing or None)
    row["gtin"] = cls["gtin"] or ""
    row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
    row["gtin_reason"] = cls["reason"]
    row["price_basis"] = "net"
    row["vat_rate"] = "0.081"
    return row


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product("farnell", product_url=url, sample_bucket=sample_bucket, currency="CHF")
    try:
        m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
        if m:
            row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()[:300]
        for pat in [r'"ean"\s*:\s*"(\d{8,14})"', r'"gtin"\s*:\s*"(\d{8,14})"', r"EAN[^0-9]{0,20}(\d{8,14})"]:
            m = re.search(pat, html, re.I)
            if m:
                row["gtin"] = m.group(1)
                break
        cls = classify_gtin(row["gtin"], mpn=row.get("mpn") or None)
        row["gtin"] = cls["gtin"] or ""
        row["gtin_valid"] = "1" if cls["valid"] else "0"
        row["gtin_reason"] = cls["reason"]
        low = html[:3000].lower()
        if "access denied" in low or "just a moment" in low:
            row["parse_error"] = "blocked_or_access_denied"
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return row
