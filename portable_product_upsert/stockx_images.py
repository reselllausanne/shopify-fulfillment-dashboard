"""
Pick a small set of StockX product photos instead of uploading full 360° strips.

StockX / Kicks `gallery_360` is ordered around the product (~10° per frame when
len=36). Default five views: straight front, front ¾, right profile, heel/back,
left profile (symmetric “orbit card” like common PDP grids).
"""

from __future__ import annotations

import re
from urllib.parse import urlsplit
from typing import Any, Dict, List, Sequence

# Around vertical axis (StockX img01 ≈ 0°, progression clockwise).
# Alt set with two ¾ “corners” and no pure side: (0, 45, 135, 180, 315).
DEFAULT_ORBIT_ANGLES = (0, 45, 90, 180, 270)
MAX_STATIC_FALLBACK = 5


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
    Return 5 (or fewer) image URLs for Shopify.

    - If `gallery_360` is non-empty: one URL per requested angle, deduped.
    - Else: primary `image` plus `gallery` static shots, deduped, capped.
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
        urls = _dedupe_preserve(urls)
        if urls:
            return urls

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
    flat = _dedupe_preserve(flat)
    return flat[:MAX_STATIC_FALLBACK]


def list_all_gallery_360_urls(product_data: Dict[str, Any]) -> List[str]:
    """Every frame from StockX 360 strip (deduped, order preserved). Empty if none."""
    g360 = product_data.get("gallery_360") or []
    if not isinstance(g360, list) or not g360:
        return []
    out: List[str] = []
    for item in g360:
        u = _norm_url(item)
        if u:
            out.append(u)
    return _dedupe_preserve(out)


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
    """
    ordered = _dedupe_preserve([u for u in ordered_stockx_urls if _norm_url(u)])
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
