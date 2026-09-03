"""Pollin parsers."""

from __future__ import annotations

import json
import re
from typing import Optional

from lib.gtin import classify_gtin
from lib.schema import empty_product


def extract_product_urls_from_sitemap(xml_text: str) -> list[str]:
    return re.findall(r"<loc>(https://www\.pollin\.de/p/[^<]+)</loc>", xml_text)


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product("pollin", product_url=url, sample_bucket=sample_bucket, currency="EUR")
    try:
        m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
        if m:
            row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).split("|")[0].strip()
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
                offers = node.get("offers")
                offer = offers[0] if isinstance(offers, list) and offers else offers
                if isinstance(offer, dict):
                    row["price"] = str(offer.get("price") or row["price"])
                    row["currency"] = offer.get("priceCurrency") or "EUR"
                    avail = str(offer.get("availability") or "")
                    row["availability"] = avail.split("/")[-1]
                    if "InStock" in avail:
                        row["stock"] = "in_stock"
                    elif "OutOfStock" in avail or "SoldOut" in avail:
                        row["stock"] = "out_of_stock"
                gtin = node.get("gtin13") or node.get("gtin") or node.get("gtin12")
                if gtin:
                    row["gtin"] = str(gtin)
        if not row["gtin"]:
            for pat in [
                r'class="product-detail-ean"[^>]*>\s*(\d{8,14})',
                r'"ean"\s*:\s*"(\d{8,14})"',
            ]:
                m = re.search(pat, html, re.I | re.S)
                if m:
                    row["gtin"] = m.group(1)
                    break
        if not row["supplier_sku"]:
            m = re.search(r'class="product-detail-ordernumber"[^>]*>\s*([^<\s]+)', html)
            if m:
                row["supplier_sku"] = m.group(1).strip()
            else:
                m = re.search(r"-(\d{5,})(?:\?|$)", url)
                if m:
                    row["supplier_sku"] = m.group(1)
        if not row["price"]:
            m = re.search(r'itemprop="price"\s+content="([0-9.]+)"', html)
            if m:
                row["price"] = m.group(1)
        row["price_basis"] = "gross"
        row["vat_rate"] = "0.19"
        packing = "possible_multipack_or_set" if re.search(r"multipack|vpe|Set\s*\d+", html, re.I) else ""
        row["packaging"] = packing
        cls = classify_gtin(row["gtin"], mpn=row["mpn"] or None, packaging_hint=packing or None)
        row["gtin"] = cls["gtin"] or ""
        row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
        row["gtin_reason"] = cls["reason"]
        img = re.search(r'property="og:image"\s+content="([^"]+)"', html)
        if img:
            row["image_url"] = img.group(1)
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return row
