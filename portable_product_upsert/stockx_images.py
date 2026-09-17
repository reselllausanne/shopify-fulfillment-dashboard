"""
Pick a small set of StockX product photos instead of uploading full 360° strips.

StockX / Kicks `gallery_360` is ordered around the product (~10° per frame when
len=36). Default five views: straight front, front ¾, right profile, heel/back,
left profile (symmetric “orbit card” like common PDP grids).

Image URLs are always upgraded past Google Merchant thumbnail size before return.
"""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlencode, urlsplit, urlunsplit
from typing import Any, Dict, List, Optional, Sequence

# Around vertical axis (StockX img01 ≈ 0°, progression clockwise).
# Alt set with two ¾ “corners” and no pure side: (0, 45, 135, 180, 315).
DEFAULT_ORBIT_ANGLES = (0, 45, 90, 180, 270)
MAX_STATIC_FALLBACK = 5
GOOGLE_IMAGE_MIN_PX = 500
TARGET_LONG_EDGE_PX = 1200
IMGIX_HOSTS = frozenset(
    {
        "images.stockx.com",
        "stockx-assets.imgix.net",
        "image.goat.com",
        "images.goat.com",
    }
)


def _norm_url(u: Any) -> str:
    if not isinstance(u, str):
        return ""
    s = u.strip()
    if not s.lower().startswith(("http://", "https://")):
        return ""
    return s


def _dedupe_preserve(urls: Sequence[str]) -> List[str]:
    out: List[str] = []
    seen = set()
    for u in urls:
        key = u.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(u)
    return out


def _declared_long_edge(url: str) -> Optional[float]:
    try:
        query = parse_qs(urlsplit(url).query)
        width = float((query.get("w") or query.get("width") or ["0"])[0])
        height = float((query.get("h") or query.get("height") or ["0"])[0])
        dpr = float((query.get("dpr") or ["1"])[0])
    except (TypeError, ValueError):
        return None
    if dpr <= 0:
        dpr = 1.0
    edges = [e * dpr for e in (width, height) if e > 0]
    if not edges:
        return None
    return max(edges)


def _declared_pixel_area(url: str) -> int:
    """Best-effort source size from StockX/imgix URL params, including DPR."""
    try:
        query = parse_qs(urlsplit(url).query)
        width = int(float((query.get("w") or query.get("width") or ["0"])[0]))
        height = int(float((query.get("h") or query.get("height") or ["0"])[0]))
        dpr = float((query.get("dpr") or ["1"])[0])
    except (TypeError, ValueError):
        return 0
    if width <= 0 or height <= 0 or dpr <= 0:
        return 0
    return int(width * dpr) * int(height * dpr)


def is_kickdb_thumbnail_url(url: str, min_px: int = GOOGLE_IMAGE_MIN_PX) -> bool:
    lower = url.lower()
    if "thumbnail" in lower or "/thumb/" in lower or "_thumb." in lower:
        return True
    if (
        "product-placeholder" in lower
        or "placeholder-default" in lower
        or "/placeholder." in lower
    ):
        return True
    edge = _declared_long_edge(url)
    if edge is None:
        return False
    return edge < min_px


def upgrade_kickdb_image_url(url: str) -> str:
    """Raise imgix w/h to TARGET_LONG_EDGE_PX; strip dpr. Identity for other hosts."""
    normalized = _norm_url(url)
    if not normalized:
        return ""
    parts = urlsplit(normalized)
    if parts.hostname and parts.hostname.lower() not in IMGIX_HOSTS:
        return normalized
    query = parse_qs(parts.query, keep_blank_values=True)
    if "w" not in query and "h" not in query:
        return normalized
    try:
        width = int(float((query.get("w") or ["0"])[0])) if "w" in query else 0
        height = int(float((query.get("h") or ["0"])[0])) if "h" in query else 0
    except (TypeError, ValueError):
        return normalized
    largest = max(width, height)
    if largest <= 0 or largest >= TARGET_LONG_EDGE_PX:
        return normalized
    factor = TARGET_LONG_EDGE_PX / float(largest)
    flat: Dict[str, str] = {}
    for key, values in query.items():
        if key.lower() == "dpr":
            continue
        if not values:
            continue
        flat[key] = values[0]
    if width > 0:
        flat["w"] = str(int(round(width * factor)))
    if height > 0:
        flat["h"] = str(int(round(height * factor)))
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(flat), parts.fragment))


def is_google_compliant_kickdb_url(url: str, min_px: int = GOOGLE_IMAGE_MIN_PX) -> bool:
    """Declared long-edge >= min_px only. Unknown size is NOT compliant (no auto-accept)."""
    normalized = _norm_url(url)
    if not normalized:
        return False
    if is_kickdb_thumbnail_url(normalized, min_px=min_px):
        return False
    edge = _declared_long_edge(normalized)
    if edge is None:
        return False
    return edge >= min_px


def _largest_declared_first(urls: Sequence[str]) -> List[str]:
    """Stable order for equal/unknown sizes; prevent API thumbnails becoming hero."""
    return sorted(urls, key=_declared_pixel_area, reverse=True)


def _canonicalize_urls(urls: Sequence[str]) -> List[str]:
    """Upgrade + drop sub-min images. Never returns a thumbnail."""
    out: List[str] = []
    seen = set()
    for raw in _largest_declared_first(urls):
        upgraded = upgrade_kickdb_image_url(raw)
        if not upgraded or not is_google_compliant_kickdb_url(upgraded):
            continue
        key = upgraded.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(upgraded)
    return out


def _url_match_keys(u: Any) -> set[str]:
    """
    Build loose match keys so StockX source URLs and Shopify CDN URLs for the
    same uploaded image compare equal even when host/query/extension changed.
    """
    normalized = _norm_url(u)
    if not normalized:
        return set()

    parts = urlsplit(normalized)
    path = (parts.path or "").strip()
    lower_path = path.lower()
    keys = {normalized.lower()}

    if lower_path:
        keys.add(lower_path)
        no_ext = re.sub(r"\.[a-z0-9]+$", "", lower_path)
        keys.add(no_ext)

        tail_parts = [p for p in lower_path.split("/") if p]
        if tail_parts:
            basename = tail_parts[-1]
            keys.add(basename)
            keys.add(re.sub(r"\.[a-z0-9]+$", "", basename))
            if len(tail_parts) >= 2:
                keys.add("/".join(tail_parts[-2:]))

            # Only basename tokens — avoids false matches (e.g. path segment "360"
            # matching unrelated digits in Shopify CDN URLs).
            for token in re.findall(r"(img\d+|frame[-_ ]?\d+)", basename):
                keys.add(token)

    return {k for k in keys if k}


def _pick_indices_for_angles(n: int, angles: Sequence[float]) -> List[int]:
    """Map each angle to a frame index; avoid duplicate indices when rounding collides."""
    used: set[int] = set()
    out: List[int] = []
    for deg in angles:
        raw = int(round((float(deg) % 360.0) / 360.0 * n)) % n
        idx = raw
        if idx in used:
            for delta in range(1, n):
                right = (raw + delta) % n
                if right not in used:
                    idx = right
                    break
                left = (raw - delta) % n
                if left not in used:
                    idx = left
                    break
        used.add(idx)
        out.append(idx)
    return out


def select_stockx_product_images(
    product_data: Dict[str, Any],
    angles_deg: Sequence[float] = DEFAULT_ORBIT_ANGLES,
) -> List[str]:
    """
    Return 5 (or fewer) Google-compliant image URLs for Shopify.

    - If `gallery_360` is non-empty: one URL per requested angle, deduped, upgraded.
    - Else: primary `image` plus `gallery` static shots, HD-first, thumbnails upgraded/dropped.
    """
    g360 = product_data.get("gallery_360") or []
    if isinstance(g360, list) and g360:
        urls: List[str] = []
        n = len(g360)
        for i in _pick_indices_for_angles(n, angles_deg):
            if 0 <= i < n:
                u = _norm_url(g360[i])
                if u:
                    urls.append(u)
        canonical = _canonicalize_urls(_dedupe_preserve(urls))
        if canonical:
            return canonical

    primary = _norm_url(product_data.get("image"))
    gallery = product_data.get("gallery") or []
    flat: List[str] = []
    if primary:
        flat.append(primary)
    if isinstance(gallery, list):
        for item in gallery:
            u = _norm_url(item)
            if u:
                flat.append(u)
    return _canonicalize_urls(_dedupe_preserve(flat))[:MAX_STATIC_FALLBACK]


def list_all_gallery_360_urls(product_data: Dict[str, Any]) -> List[str]:
    """Every frame from StockX 360 strip (deduped, upgraded, compliant). Empty if none."""
    g360 = product_data.get("gallery_360") or []
    if not isinstance(g360, list) or not g360:
        return []
    out: List[str] = []
    for item in g360:
        u = _norm_url(item)
        if u:
            out.append(u)
    return _canonicalize_urls(_dedupe_preserve(out))


def should_auto_rebuild_product_images(
    existing_media_count: int,
    target_image_count: int,
    *,
    full_360: bool = False,
    explicit_rebuild: bool = False,
) -> bool:
    """
    Wipe Shopify media and re-upload target_image_count URLs only when safe.

    Default orbit sync (~5 images) never auto-shrinks a larger gallery — products
    with a prior --full-360 upload keep all frames on price/title updates.
    """
    if explicit_rebuild:
        return True
    if not full_360:
        return False
    return existing_media_count > target_image_count and target_image_count > 0


def urls_to_add_for_gallery_sync(
    ordered_stockx_urls: Sequence[str],
    existing_shopify_urls: Sequence[str],
    *,
    skip_first_slot_if_has_media: bool = True,
) -> List[str]:
    """
    If skip_first_slot_if_has_media and Shopify already has images: treat slot 0 as hero
    already on the store → only append ordered[1:] not yet present.

    If not skip_first_slot_if_has_media (full 360 strip test): append every ordered URL
    that is not already on the product (keeps img01 in sequence when URLs differ from hero).

    If Shopify has zero images: append full ordered list (deduped vs empty set).

    Never returns a thumbnail URL (inputs are expected pre-canonicalized).
    """
    ordered = _canonicalize_urls([u for u in ordered_stockx_urls if _norm_url(u)])
    if not ordered:
        return []

    existing = [u for u in existing_shopify_urls if isinstance(u, str) and u.strip()]
    existing_keys = set()
    for u in existing:
        existing_keys.update(_url_match_keys(u))

    if not existing:
        return ordered

    to_scan = ordered[1:] if skip_first_slot_if_has_media else ordered
    out: List[str] = []
    for u in to_scan:
        match_keys = _url_match_keys(u)
        if not (match_keys & existing_keys):
            out.append(u)
            existing_keys.update(match_keys)
    return out
