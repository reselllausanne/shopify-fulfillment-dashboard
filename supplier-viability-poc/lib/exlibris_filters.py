"""Ex Libris scrape filters — physical SKU only, one EAN per URL.

Do NOT expand PDP `Relationships` / `RelationshipsNew` into sibling formats
(Kartonierter Einband vs E-Book vs Fester Einband). Only the EAN in the URL counts.
"""

from __future__ import annotations

import re
from typing import Any, Optional
from urllib.parse import urlparse

# Category tree branches to never crawl.
SKIP_CATEGORY_PATH_PARTS = (
    "/e-books-",
    "/e-books/",
    "/ebooks/",
    "/ebook/",
    "/download/",
    "/buecher-buch/e-books-deutsch/",
    "/buecher-buch/e-books-",
    "/buecher-buch/englische-ebooks/",
    "/buecher-buch/franzoesische-ebooks/",
)

# ProductCategory values that are digital/download.
BLOCKED_PRODUCT_CATEGORIES = frozenset(
    {
        "b-dl",
        "b-dl-en",
        "b-dl-fr",
        "dl",
        "ebook",
        "e-book",
    }
)

_DIGITAL_FORMAT_RE = re.compile(
    r"(?:"
    r"e-?\s*book|ebook|epub|kindle|pdf\b|"
    r"download-?\s*artikel|download\b|"
    r"hörbuch.*download|audio-?\s*download|"
    r"cloud-?\s*version|streaming|"
    r"digital(?:er)?\s+(?:download|inhalt)"
    r")",
    re.I,
)


def _path_only(url_or_path: str) -> str:
    s = (url_or_path or "").strip()
    if not s:
        return ""
    if s.startswith("http"):
        return urlparse(s).path or ""
    return s if s.startswith("/") else f"/{s}"


def is_digital_category_path(path: str) -> bool:
    low = _path_only(path).lower()
    return any(part in low for part in SKIP_CATEGORY_PATH_PARTS)


def _format_blob(*parts: Optional[str]) -> str:
    return " ".join(p for p in parts if p).strip()


def is_digital_format_label(text: str) -> bool:
    return bool(_DIGITAL_FORMAT_RE.search(text or ""))


def is_physical_exlibris_item(
    *,
    url: str = "",
    path: str = "",
    medium: str = "",
    format_label: str = "",
    category_code: str = "",
    is_download_product: bool = False,
    show_download_button: bool = False,
) -> tuple[bool, str]:
    """Return (keep, reason). keep=False ⇒ skip (ebook / download / wrong branch)."""
    if is_download_product:
        return False, "is_download_product"
    if show_download_button:
        return False, "show_download_button"

    p = _path_only(path or url).lower()
    if is_digital_category_path(p):
        return False, "digital_category_path"

    cat = (category_code or "").strip().lower()
    if cat in BLOCKED_PRODUCT_CATEGORIES or cat.endswith("-dl"):
        return False, f"product_category:{cat or '?'}"

    blob = _format_blob(medium, format_label)
    if is_digital_format_label(blob):
        return False, "digital_format_label"

    return True, "physical"


def filter_tile_dict(tile: dict) -> tuple[bool, str]:
    return is_physical_exlibris_item(
        url=tile.get("url") or "",
        path=tile.get("path") or "",
        medium=tile.get("medium") or "",
        format_label=tile.get("format") or tile.get("genre") or "",
        category_code=str(tile.get("category_code") or ""),
        is_download_product=bool(tile.get("is_download_product")),
        show_download_button=bool(tile.get("show_download_button")),
    )


def filter_product_store(prod: dict, url: str = "") -> tuple[bool, str]:
    detail = prod.get("Detail") if isinstance(prod.get("Detail"), dict) else {}
    format_label = str(prod.get("Medium") or prod.get("Slot2") or "")
    if isinstance(detail, dict):
        for prop in detail.get("Properties") or []:
            if isinstance(prop, dict) and str(prop.get("Label") or "").lower() == "format":
                format_label = str(prop.get("Value") or format_label)
                break
    return is_physical_exlibris_item(
        url=url or str(prod.get("DeepLink") or ""),
        medium=format_label,
        format_label=format_label,
        category_code=str(prod.get("ProductCategory") or ""),
        is_download_product=bool(prod.get("IsDownloadProduct")),
        show_download_button=bool(prod.get("ShowDownloadButton")),
    )


def ean_from_url(url: str) -> Optional[str]:
    m = re.search(r"/id/(\d{8,14})/", url or "")
    return m.group(1) if m else None


def assert_url_ean_matches(prod: dict, url: str) -> tuple[bool, str]:
    """PDP must match URL EAN — ignore Relationships sibling formats."""
    url_ean = ean_from_url(url)
    prod_ean = str(prod.get("EAN") or prod.get("ProductId") or "")
    if url_ean and prod_ean and url_ean != prod_ean:
        return False, f"ean_mismatch:url={url_ean},product={prod_ean}"
    return True, "ok"
