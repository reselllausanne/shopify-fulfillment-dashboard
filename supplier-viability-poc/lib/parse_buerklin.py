"""Bürklin parser."""

from __future__ import annotations

import json
import re

from lib.gtin import classify_gtin
from lib.schema import empty_product


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product("buerklin", product_url=url, sample_bucket=sample_bucket, currency="EUR")
    low = html[:5000].lower()
    if "just a moment" in low or "cf-browser-verification" in low or "challenge-platform" in low or not html.strip():
        row["parse_error"] = "cloudflare_challenge_or_empty"
        return row
    try:
        m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
        if m:
            row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()[:300]
        for block in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html,
            re.I | re.S,
        ):
            try:
                data = json.loads(block.group(1))
            except json.JSONDecodeError:
                continue
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                if not isinstance(node, dict) or node.get("@type") != "Product":
                    continue
                row["name"] = node.get("name") or row["name"]
                row["supplier_sku"] = str(node.get("sku") or row["supplier_sku"])
                row["mpn"] = str(node.get("mpn") or row["mpn"])
                brand = node.get("brand")
                if isinstance(brand, dict):
                    row["brand"] = brand.get("name") or ""
                gtin = node.get("gtin13") or node.get("gtin")
                if gtin:
                    row["gtin"] = str(gtin)
                offers = node.get("offers")
                offer = offers[0] if isinstance(offers, list) and offers else offers
                if isinstance(offer, dict):
                    row["price"] = str(offer.get("price") or "")
                    row["currency"] = offer.get("priceCurrency") or "EUR"
        cls = classify_gtin(row["gtin"], mpn=row["mpn"] or None)
        row["gtin"] = cls["gtin"] or ""
        row["gtin_valid"] = "1" if cls["valid"] else "0"
        row["gtin_reason"] = cls["reason"]
        row["price_basis"] = "gross"
        row["vat_rate"] = "0.19"
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return row
