"""BerryBase parsers."""

from __future__ import annotations

import json
import re
from typing import Optional
from urllib.parse import urljoin

from lib.gtin import classify_gtin
from lib.schema import empty_product


def extract_category_product_urls(html: str, base: str = "https://www.berrybase.de") -> list[str]:
    blocked = (
        "account", "checkout", "wishlist", "widgets", "navigation", "agb",
        "datenschutz", "impressum", "login", "suche", "search", "cart",
        "newsletter", "cms", "brand", "informationen", "jobs", "abholung",
    )
    urls: list[str] = []
    for href in re.findall(r'href="([^"]+)"', html):
        if href.startswith("/"):
            href = urljoin(base, href)
        if not href.startswith(base) or href.endswith("/") or "?" in href:
            continue
        path = href.replace(base, "").strip("/")
        if not path or "/" in path:
            continue
        if any(b in path.lower() for b in blocked):
            continue
        urls.append(href.split("#")[0])
    return list(dict.fromkeys(urls))


def _ean(html: str) -> Optional[str]:
    for pat in [
        r'"EAN"\s*:\s*"(\d{8,14})"',
        r'"ean"\s*:\s*"(\d{8,14})"',
        r'"gtin13"\s*:\s*"(\d{8,14})"',
        r'":"(\d{8,14})","productSku"',
    ]:
        m = re.search(pat, html, re.I)
        if m:
            return m.group(1)
    return None


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product("berrybase", product_url=url, sample_bucket=sample_bucket, currency="EUR")
    try:
        products = []
        for m in re.finditer(
            r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
            html,
            re.I | re.S,
        ):
            try:
                data = json.loads(m.group(1).strip())
            except json.JSONDecodeError:
                continue
            nodes = data if isinstance(data, list) else [data]
            for node in nodes:
                if isinstance(node, dict) and node.get("@type") == "Product":
                    products.append(node)
        p = products[0] if products else {}
        row["name"] = p.get("name") or ""
        row["supplier_sku"] = str(p.get("sku") or "")
        row["mpn"] = str(p.get("mpn") or "")
        brand = p.get("brand")
        if isinstance(brand, dict):
            row["brand"] = brand.get("name") or ""
        elif isinstance(brand, str):
            row["brand"] = brand
        images = p.get("image")
        if isinstance(images, list) and images:
            row["image_url"] = images[0]
        elif isinstance(images, str):
            row["image_url"] = images
        offers = p.get("offers")
        offer = offers[0] if isinstance(offers, list) and offers else offers
        if isinstance(offer, dict):
            row["price"] = str(offer.get("price") or "")
            row["currency"] = offer.get("priceCurrency") or "EUR"
            avail = str(offer.get("availability") or "")
            row["availability"] = avail.split("/")[-1]
            if "InStock" in avail:
                row["stock"] = "in_stock"
            elif "OutOfStock" in avail or "SoldOut" in avail:
                row["stock"] = "out_of_stock"
        row["price_basis"] = "gross"
        row["vat_rate"] = "0.19"
        gtin = p.get("gtin13") or p.get("gtin") or _ean(html)
        packing = "possible_multipack_signal" if re.search(r"multipack|vpe|carton", html, re.I) else ""
        row["packaging"] = packing
        cls = classify_gtin(gtin, mpn=row["mpn"] or None, packaging_hint=packing or None)
        row["gtin"] = cls["gtin"] or ""
        row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
        row["gtin_reason"] = cls["reason"]
        if not row["name"]:
            m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
            if m:
                row["name"] = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).split("-")[0].strip()
        if not row["price"]:
            m = re.search(r'"price"\s*:\s*([0-9]+(?:\.[0-9]+)?)', html)
            if m:
                row["price"] = m.group(1)
        if not row["supplier_sku"]:
            m = re.search(r'"sku"\s*:\s*"([^"]+)"', html)
            if m:
                row["supplier_sku"] = m.group(1)
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return row
