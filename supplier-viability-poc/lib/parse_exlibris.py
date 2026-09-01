"""Ex Libris (exlibris.ch) parsers — Spiele / Spielzeug & Brettspiele.

Category listings and PDPs embed product data in Next.js `__NEXT_DATA__`.
EAN is the product id in URLs: `/…/id/{EAN}/`.
Stock is qualitative only (Sofort versandbereit / Lieferhinweis), never a qty.
"""

from __future__ import annotations

import json
import re
from typing import Any, Optional
from urllib.parse import urljoin

from lib.gtin import classify_gtin
from lib.exlibris_pricing import apply_exlibris_list_price
from lib.exlibris_filters import (
    assert_url_ean_matches,
    filter_product_store,
    filter_tile_dict,
    is_digital_category_path,
)
from lib.schema import empty_product

BASE = "https://www.exlibris.ch"

# Prefer DE paths (robots disallows most /fr/).
CATALOG_ROOTS: dict[str, str] = {
    "spiele": "/de/hobby-spiele-brettspiele/",
    "musik_cd": "/de/musik/cd/",
    "musik_vinyl": "/de/musik/vinyl/",
    "games": "/de/games/",
}

# Legacy alias used by sample script.
SPIELE_ROOT = CATALOG_ROOTS["spiele"]

# Skip listing facets that duplicate the main category tree.
SKIP_CATEGORY_SUFFIXES = (
    "/charts-aktuell/",
    "/charts-bestseller/",
    "/charts-dauerbrenner/",
    "/charts-taschenbuch/",
    "/neuheiten/",
    "/vorbestellungen/",
    "/sofort-lieferbar/",
    "/club-aktionen/",
)

SAMPLE_CATEGORIES: list[tuple[str, str]] = [
    ("gesellschaftsspiele", "/de/hobby-spiele-brettspiele/kategorien/gesellschaftsspiele/ci/15000/"),
    ("puzzles", "/de/hobby-spiele-brettspiele/kategorien/puzzles/ci/3503/"),
    ("babyspielzeug", "/de/hobby-spiele-brettspiele/kategorien/babyspielzeug/ci/15024/"),
    ("lernspielzeug", "/de/hobby-spiele-brettspiele/kategorien/lernspielzeug-spielkaesten/ci/15285/"),
    ("mal-bastel", "/de/hobby-spiele-brettspiele/kategorien/mal-bastelzubehoer/ci/15025/"),
    ("outdoor", "/de/hobby-spiele-brettspiele/kategorien/outdoorspielzeug/ci/3037/"),
    ("pluesch", "/de/hobby-spiele-brettspiele/kategorien/plueschtiere-kuscheltiere/ci/3646/"),
    ("puppen", "/de/hobby-spiele-brettspiele/kategorien/puppen/ci/15017/"),
    ("rollenspiel", "/de/hobby-spiele-brettspiele/kategorien/rollenspielzeug/ci/15013/"),
    ("spielfahrzeuge", "/de/hobby-spiele-brettspiele/kategorien/spielfahrzeuge/ci/15023/"),
    ("spielwelten", "/de/hobby-spiele-brettspiele/kategorien/spielwelten-zubehoer/ci/15027/"),
    ("brettspiele", "/de/hobby-spiele-brettspiele/kategorien/gesellschaftsspiele/brettspiele/ci/15226/"),
    ("kartenspiele", "/de/hobby-spiele-brettspiele/kategorien/gesellschaftsspiele/kartenspiele/ci/2753/"),
    ("denkspiele", "/de/hobby-spiele-brettspiele/kategorien/gesellschaftsspiele/denkspiele/ci/15227/"),
]


def extract_next_data(html: str) -> Optional[dict]:
    m = re.search(
        r'<script id="__NEXT_DATA__" type="application/json">(.*?)</script>',
        html,
        re.S,
    )
    if not m:
        return None
    try:
        return json.loads(m.group(1))
    except json.JSONDecodeError:
        return None


def _deps(next_data: dict) -> dict:
    return (next_data.get("props") or {}).get("dependencyResolver") or {}


def _pick(d: dict, *keys: str, default: Any = None) -> Any:
    for k in keys:
        if k in d and d[k] is not None:
            return d[k]
    # case-insensitive fallback
    lower = {str(k).lower(): v for k, v in d.items()}
    for k in keys:
        if k.lower() in lower and lower[k.lower()] is not None:
            return lower[k.lower()]
    return default


def category_total(html: str) -> Optional[int]:
    nd = extract_next_data(html)
    if not nd:
        return None
    pcd = _deps(nd).get("CategoryPageStore", {}).get("productCategoryData") or {}
    n = pcd.get("TotalProductsNumber")
    return int(n) if n is not None else None


def extract_product_tiles(html: str) -> list[dict]:
    """Return normalized tile dicts from a category listing page."""
    nd = extract_next_data(html)
    if not nd:
        return []
    deps = _deps(nd)
    tiles: list[Any] = []
    pcd = (deps.get("CategoryPageStore") or {}).get("productCategoryData") or {}
    raw = pcd.get("ProductTiles")
    if isinstance(raw, list) and raw:
        tiles = raw
    else:
        raw = (deps.get("PaginationStore") or {}).get("productTiles")
        if isinstance(raw, list):
            tiles = raw
    out: list[dict] = []
    for t in tiles:
        if not isinstance(t, dict):
            continue
        norm = _normalize_tile(t)
        if not norm.get("ean"):
            continue
        keep, _reason = filter_tile_dict(norm)
        if keep:
            out.append(norm)
    return out


def _normalize_tile(t: dict) -> dict:
    ean = str(_pick(t, "Ean", "ean") or "")
    cover = _pick(t, "Cover", "cover") or {}
    price = _pick(t, "Price", "price") or {}
    avail = _pick(t, "Availability", "availability") or {}
    info = _pick(t, "info") or {}
    cats = _pick(t, "CategoryItems", "categoryItems") or []

    title = _pick(t, "Slot1") or (info.get("slot1") if isinstance(info, dict) else None) or ""
    author = _pick(t, "Slot2") or (info.get("slot2") if isinstance(info, dict) else None) or ""
    format_label = _pick(t, "Slot3") or (info.get("slot3") if isinstance(info, dict) else None) or ""
    medium = str(_pick(t, "Medium", "medium") or author or "").strip()
    genre = format_label or ""
    if not title and isinstance(cover, dict):
        title = _pick(cover, "AltText", "alt") or ""

    link = ""
    if isinstance(cover, dict):
        link = _pick(cover, "Link", "link") or ""
    if not link and ean:
        link = f"{SPIELE_ROOT}id/{ean}/"

    list_price = _pick(price, "List", "list") if isinstance(price, dict) else None
    sales_price = _pick(price, "Sales", "sales") if isinstance(price, dict) else None
    currency = (_pick(price, "Currency", "currency") if isinstance(price, dict) else None) or "CHF"

    avail_text = _pick(avail, "Text", "text") if isinstance(avail, dict) else ""
    avail_icon = _pick(avail, "IconKey", "iconKey") if isinstance(avail, dict) else ""
    avail_color = _pick(avail, "Color", "color", "MessageColor") if isinstance(avail, dict) else ""

    image = ""
    if isinstance(cover, dict):
        image = _pick(cover, "Url", "url") or ""
        covers = _pick(cover, "Covers", "covers") or []
        if not image and isinstance(covers, list):
            for c in covers:
                if isinstance(c, dict) and _pick(c, "Url", "url"):
                    image = _pick(c, "Url", "url")
                    break

    return {
        "ean": ean,
        "title": str(title).strip(),
        "author": str(author or "").strip(),
        "medium": str(medium or "").strip(),
        "format": str(format_label or "").strip(),
        "genre": str(genre or "").strip(),
        "categories": [str(c) for c in cats] if isinstance(cats, list) else [],
        "path": link,
        "url": urljoin(BASE, link) if link else "",
        "list_price": list_price,
        "sales_price": sales_price,
        "currency": currency,
        "availability_text": str(avail_text or ""),
        "availability_icon": str(avail_icon or ""),
        "availability_color": str(avail_color or ""),
        "image_url": image,
        "category_code": str(_pick(t, "categoryCode", "CategoryCode") or ""),
        "is_download_product": bool(_pick(t, "isDownloadProduct", "IsDownloadProduct")),
        "show_download_button": bool(_pick(t, "showDownloadButton", "ShowDownloadButton")),
    }


def tile_to_product(tile: dict, *, sample_bucket: str = "") -> Optional[dict]:
    keep, reason = filter_tile_dict(tile)
    if not keep:
        return None

    ean = tile.get("ean") or ""
    price = tile.get("sales_price")
    if price is None:
        price = tile.get("list_price")
    fmt = tile.get("format") or tile.get("genre") or ""
    row = empty_product(
        "exlibris",
        product_url=tile.get("url") or "",
        supplier_sku=ean,
        name=tile.get("title") or "",
        gtin=ean,
        price=str(price) if price is not None else "",
        currency=tile.get("currency") or "CHF",
        price_basis="gross",
        vat_rate="0.081",  # CH standard; confirm per category later
        image_url=tile.get("image_url") or "",
        sample_bucket=sample_bucket or tile.get("genre") or "",
        availability=tile.get("availability_text") or "",
        stock=_stock_label(tile.get("availability_icon"), tile.get("availability_color")),
        sales_unit=fmt or "1",
    )
    cats = tile.get("categories") or []
    if cats:
        row["packaging"] = ""  # keep packaging for multipack hints only
        row["sales_unit"] = "1"
    if tile.get("medium"):
        row["mpn"] = ""  # medium is format, not MPN
    cls = classify_gtin(ean)
    row["gtin"] = cls["gtin"] or ean
    row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
    row["gtin_reason"] = cls["reason"]
    # stash category path in parse_error-free side: use brand for producer later from PDP
    if cats:
        row["brand"] = ""  # filled from PDP Producer when available
    # encode browse genre into sample_bucket if empty
    if not row["sample_bucket"] and cats:
        row["sample_bucket"] = "/".join(cats[:3])
    return apply_exlibris_list_price(row)


def _stock_label(icon: Optional[str], color: Optional[str]) -> str:
    icon = (icon or "").lower()
    color = (color or "").lower()
    if "nicht" in icon or color == "red":
        return "out_of_stock"
    if "vorbestell" in icon or "preorder" in icon:
        return "preorder"
    if icon or color == "green":
        return "in_stock_unquantified"
    return "unknown"


def parse_product_html(html: str, url: str, *, sample_bucket: str = "") -> dict:
    row = empty_product(
        "exlibris",
        product_url=url,
        sample_bucket=sample_bucket,
        currency="CHF",
        price_basis="gross",
        vat_rate="0.081",
    )
    try:
        nd = extract_next_data(html)
        if not nd:
            # URL EAN fallback
            m = re.search(r"/id/(\d{8,14})/", url)
            if m:
                row["gtin"] = m.group(1)
                row["supplier_sku"] = m.group(1)
            row["parse_error"] = "no_next_data"
            return row
        prod = (_deps(nd).get("ProductStore") or {}).get("product")
        if not isinstance(prod, dict):
            row["parse_error"] = "no_product_store"
            return row

        keep, skip_reason = filter_product_store(prod, url)
        if not keep:
            row["parse_error"] = f"skip_digital:{skip_reason}"
            return row

        ok, match_reason = assert_url_ean_matches(prod, url)
        if not ok:
            row["parse_error"] = f"skip_{match_reason}"
            return row

        ean = str(_pick(prod, "EAN", "Ean", "ProductId") or "")
        row["gtin"] = ean
        row["supplier_sku"] = ean
        row["name"] = str(_pick(prod, "Title", "Slot1") or "")
        row["sales_unit"] = str(_pick(prod, "Medium") or "")
        detail = _pick(prod, "Detail") or {}
        if isinstance(detail, dict):
            row["brand"] = str(
                _pick(detail, "Producer", "Publisher") or row["brand"]
            )
            genre = ""
            genres = _pick(detail, "Genres")
            if isinstance(genres, dict):
                genre = str(genres.get("Title") or "")
            if not genre:
                genre = str(_pick(detail, "Genre") or "")
            if genre and not sample_bucket:
                row["sample_bucket"] = genre

        price = _pick(prod, "SalesPrice")
        if price is None:
            pi = _pick(prod, "PriceInformation") or {}
            if isinstance(pi, dict):
                price = pi.get("SalesPrice")
        if price is None:
            price = _pick(prod, "ListPrice")
        # Never use RelationshipsNew.LowestPrice — that can be an E-Book sibling.
        row["price"] = str(price) if price is not None else ""

        avail = _pick(prod, "Availability") or {}
        if isinstance(avail, dict):
            row["availability"] = str(_pick(avail, "Text") or "")
            row["stock"] = _stock_label(
                str(_pick(avail, "IconKey") or ""),
                str(_pick(avail, "MessageColor") or ""),
            )

        cover = _pick(prod, "CoverURL") or _pick(prod, "CoverLargeURL") or ""
        if not cover:
            covers = _pick(prod, "Covers") or []
            if isinstance(covers, list) and covers and isinstance(covers[0], dict):
                cover = covers[0].get("Url") or ""
        row["image_url"] = str(cover or "")

        deep = _pick(prod, "DeepLink")
        if deep:
            row["product_url"] = urljoin(BASE, str(deep))

        # free CH delivery often in Detail.Remarks
        if isinstance(detail, dict):
            remarks = detail.get("Remarks") or []
            if isinstance(remarks, list):
                for r in remarks:
                    if not isinstance(r, dict):
                        continue
                    title = str(r.get("Title") or "").lower()
                    if "kostenlose lieferung" in title or "portofrei" in title:
                        row["origin_country"] = "CH"  # sold from CH shop; not HS origin
                        break

        cls = classify_gtin(ean)
        row["gtin"] = cls["gtin"] or ean
        row["gtin_valid"] = "1" if cls["valid"] and not cls["mpn_collision"] else "0"
        row["gtin_reason"] = cls["reason"]
    except Exception as e:
        row["parse_error"] = str(e)[:200]
    return apply_exlibris_list_price(row)


def ean_from_url(url: str) -> Optional[str]:
    m = re.search(r"/id/(\d{8,14})/", url)
    return m.group(1) if m else None


def catalog_prefix(catalog: str) -> str:
    if catalog in CATALOG_ROOTS:
        return CATALOG_ROOTS[catalog]
    if catalog.startswith("/de/"):
        return catalog if catalog.endswith("/") else catalog + "/"
    raise ValueError(f"unknown catalog {catalog!r}; choose from {sorted(CATALOG_ROOTS)}")


def category_page_url(path: str, page: int = 1) -> str:
    path = path if path.startswith("/") else f"/{path}"
    if page <= 1:
        return urljoin(BASE, path)
    base = path.rstrip("/")
    return urljoin(BASE, f"{base}/?page={page}")


def discover_category_paths(html: str, catalog_prefix_path: str) -> list[str]:
    """Return unique `/…/ci/{id}/` category paths under a catalog root."""
    prefix = catalog_prefix_path if catalog_prefix_path.endswith("/") else catalog_prefix_path + "/"
    found: list[str] = []
    seen: set[str] = set()
    for href in re.findall(r'href="(/de/[^"]+/ci/\d+/)"', html):
        if not href.startswith(prefix):
            continue
        if is_digital_category_path(href):
            continue
        if any(href.endswith(s) for s in SKIP_CATEGORY_SUFFIXES):
            continue
        if href in seen:
            continue
        seen.add(href)
        found.append(href)
    return found


def merge_pdp_into_row(row: dict, pdp: dict) -> dict:
    """Overlay PDP fields onto a listing row."""
    for key in ("brand", "name", "availability", "stock", "image_url", "price", "product_url"):
        if pdp.get(key):
            row[key] = pdp[key]
    if pdp.get("sample_bucket") and not row.get("sample_bucket"):
        row["sample_bucket"] = pdp["sample_bucket"]
    if pdp.get("parse_error"):
        row["parse_error"] = pdp["parse_error"]
    if pdp.get("gtin_valid"):
        row["gtin_valid"] = pdp["gtin_valid"]
        row["gtin_reason"] = pdp.get("gtin_reason") or row.get("gtin_reason")
    return row
