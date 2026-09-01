"""FantasyWelt.de (JTL-Shop) parsers."""

from __future__ import annotations

import re
from typing import Optional
from urllib.parse import urljoin

from lib.gtin import classify_gtin
from lib.schema import empty_product

BASE = "https://www.fantasywelt.de"


def extract_category_product_urls(html: str, base: str = BASE) -> list[str]:
    """Collect product detail URLs from listing HTML."""
    blocked = (
        "warenkorb",
        "registrieren",
        "passwort",
        "newsletter",
        "impressum",
        "datenschutz",
        "agb",
        "kontakt",
        "login",
        "account",
        "suche",
        "wishlist",
        "wunschliste",
        "blog",
        "cms",
    )
    # Prefer productbox links; fall back to slug-like paths.
    urls: list[str] = []
    for href in re.findall(
        r'href="(https?://www\.fantasywelt\.de/[^"#?]+|/[^"#?]+)"',
        html,
        re.I,
    ):
        if href.startswith("/"):
            href = urljoin(base, href)
        if not href.startswith(base):
            continue
        path = href.replace(base, "").strip("/")
        if not path or path.count("/") > 0:
            continue
        low = path.lower()
        if any(b in low for b in blocked):
            continue
        # Category pages are often short / Title-Case without product-ish length;
        # keep medium+ slugs that look like products (contain hyphen).
        if "-" not in path or len(path) < 8:
            continue
        urls.append(href.split("#")[0].rstrip("/"))
    return list(dict.fromkeys(urls))


def _meta_itemprop(html: str, prop: str) -> Optional[str]:
    m = re.search(
        rf'itemprop=["\']{re.escape(prop)}["\'][^>]*content=["\']([^"\']+)["\']',
        html,
        re.I,
    )
    if m:
        return m.group(1).strip()
    m = re.search(
        rf'content=["\']([^"\']+)["\'][^>]*itemprop=["\']{re.escape(prop)}["\']',
        html,
        re.I,
    )
    if m:
        return m.group(1).strip()
    m = re.search(
        rf'<[^>]+itemprop=["\']{re.escape(prop)}["\'][^>]*>([^<]+)<',
        html,
        re.I,
    )
    if m:
        return re.sub(r"\s+", " ", m.group(1)).strip() or None
    return None


def _text_field(html: str, label: str) -> Optional[str]:
    m = re.search(rf"{label}\s*:\s*([^\s<]+)", html, re.I)
    return m.group(1).strip() if m else None


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product(
        "fantasywelt",
        product_url=url,
        sample_bucket=sample_bucket,
        currency="EUR",
        price_basis="gross",
        vat_rate="0.19",
        origin_country="DE",
    )
    low = html[:8000].lower()
    if (
        "just a moment" in low
        or "cf-browser-verification" in low
        or "challenge-platform" in low
        or "vérification de sécurité" in low
        or not html.strip()
    ):
        row["parse_error"] = "cloudflare_challenge_or_empty"
        return row
    try:
        title = _meta_itemprop(html, "name") or ""
        if not title:
            m = re.search(r"<title>(.*?)</title>", html, re.I | re.S)
            if m:
                title = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", m.group(1))).strip()
        # Title often: "Name - FantasyWelt.de | ..., 12,49 €"
        name = re.sub(r"\s*-\s*FantasyWelt\.de.*$", "", title, flags=re.I).strip()
        name = re.sub(r",\s*\d+[.,]\d+\s*€\s*$", "", name).strip()
        row["name"] = name[:300]

        row["supplier_sku"] = (
            _meta_itemprop(html, "sku")
            or _text_field(html, "Artikelnummer")
            or ""
        )
        row["mpn"] = row["supplier_sku"]

        # Brand: <span itemprop="brand">…<a>CMYK</a>
        m_brand = re.search(
            r'itemprop=["\']brand["\'][\s\S]{0,600}?<a[^>]*>\s*([^<]{1,80})\s*</a>',
            html,
            re.I,
        )
        if m_brand:
            row["brand"] = re.sub(r"\s+", " ", m_brand.group(1)).strip()
        else:
            brand = _text_field(html, "Hersteller")
            if brand:
                row["brand"] = brand

        # JTL puts EAN in <span itemprop="gtin13">…</span> (not always plain "EAN: digits")
        gtin = (
            _meta_itemprop(html, "gtin13")
            or _meta_itemprop(html, "gtin")
            or _text_field(html, "EAN")
            or _text_field(html, "GTIN")
            or _text_field(html, "ISBN")
        )

        price = _meta_itemprop(html, "price")
        if not price:
            m = re.search(r'itemprop=["\']price["\'][^>]*content=["\']([^"\']+)["\']', html, re.I)
            if m:
                price = m.group(1)
        if price:
            row["price"] = str(price).replace(",", ".")

        currency = _meta_itemprop(html, "priceCurrency")
        if currency:
            row["currency"] = currency

        avail_href = _meta_itemprop(html, "availability") or ""
        if "InStock" in avail_href:
            row["availability"] = "InStock"
        elif "PreOrder" in avail_href:
            row["availability"] = "PreOrder"
        elif "OutOfStock" in avail_href or "SoldOut" in avail_href:
            row["availability"] = "OutOfStock"
            row["stock"] = "out_of_stock"
        elif "LimitedAvailability" in avail_href:
            row["availability"] = "LimitedAvailability"

        text_plain = re.sub(r"<[^>]+>", " ", html)
        text_plain = re.sub(r"\s+", " ", text_plain)
        if re.search(r"auf Lager", text_plain, re.I) and not row["availability"]:
            row["availability"] = "InStock"
        m_lead = re.search(r"lieferbar ab\s+(\d{1,2}\.\d{1,2}\.\d{2,4})", text_plain, re.I)
        if m_lead:
            row["availability"] = row["availability"] or "PreOrder"
            row["lead_time_days"] = f"from_{m_lead.group(1)}"
        m_lt = re.search(r"Lieferzeit\s+(\d+)\s*[-–]\s*(\d+)\s*Werktage", text_plain, re.I)
        if m_lt and not row["lead_time_days"]:
            row["lead_time_days"] = f"{m_lt.group(1)}-{m_lt.group(2)}"

        img = _meta_itemprop(html, "image")
        if img:
            row["image_url"] = img

        # Internal JTL article id (useful for media path / debugging)
        m_a = re.search(r'name=["\']a["\']\s+value=["\'](\d+)["\']', html, re.I)
        if not m_a:
            m_a = re.search(r'name=["\']a["\'][^>]*value=["\'](\d+)["\']', html, re.I)
        if m_a and not row["supplier_sku"]:
            row["supplier_sku"] = m_a.group(1)

        cls = classify_gtin(gtin, mpn=row["mpn"] or None)
        row["gtin"] = cls["gtin"] or ""
        row["gtin_valid"] = "1" if cls["valid"] else "0"
        row["gtin_reason"] = cls["reason"]
        if cls.get("packaging_risk"):
            row["packaging"] = "possible_multipack_signal"
            if cls["valid"]:
                row["gtin_reason"] = "packaging_risk"
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return row
