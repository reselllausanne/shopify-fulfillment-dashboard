#!/usr/bin/env python3
"""
External-ready product upsert API for this Shopify automation codebase.

Copy this file + keep deps (main.py, shopifyAPI_GQL.py, stockXAPI.py, .env).

Capabilities
------------
1) Resolve input: StockX slug / URL / style SKU / GTIN(barcode)
2) CREATE full product (same pipeline as create_single / main)
3) UPDATE existing: match variant by size OR barcode, change price/qty
4) Mark sold (qty=0, keep price)
5) Price lock: locked variants keep price until unlock or mark_sold

CLI
---
  python3 product_upsert_api.py upsert <slug|url|sku|gtin> [--lock]
  python3 product_upsert_api.py resolve <slug|url|sku|gtin>
  python3 product_upsert_api.py lock <variant_gid_or_barcode>
  python3 product_upsert_api.py unlock <variant_gid_or_barcode>
  python3 product_upsert_api.py mark-sold <variant_gid_or_barcode> [--unlock]
  python3 product_upsert_api.py set-price <variant_gid_or_barcode> <price> [--lock]

Python
------
  from product_upsert_api import upsert_product, mark_sold, lock_price, unlock_price
  upsert_product("nike-dunk-low-retro-white-black-2021")
  upsert_product("197594626522")          # GTIN on Shopify or searchable
  upsert_product("HF5386-001")            # style SKU via Kicks search
  lock_price(variant_id="gid://shopify/ProductVariant/...")
  mark_sold(barcode="197594626522")
"""

from __future__ import annotations

import argparse
import os
import re
import sys
from typing import Any, Dict, List, Optional, Tuple

from dotenv import load_dotenv

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
load_dotenv(os.path.join(BASE_DIR, ".env"))

import stockXAPI
from shopifyAPI_GQL import (
    RateLimitException,
    ensure_price_locked_metafield_definition,
    find_product_by_stockx_slug,
    find_variant_by_barcode,
    get_first_location_id,
    get_product_variants,
    get_variant_price_locked,
    inventory_set_quantities_bulk,
    set_variant_price_locked,
    update_variants_bulk,
)
from main import process_single_url_enhanced, set_physical_restock_gtin

# Auto-create custom.price_locked definition on first import (idempotent).
try:
    ensure_price_locked_metafield_definition()
except Exception as _e:
    print(f"[WARNING] price_locked metafield ensure skipped on import: {_e}")


# ---------------------------------------------------------------------------
# Resolve
# ---------------------------------------------------------------------------

def _normalize_slug(value: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return ""
    # URL → last path segment
    if "://" in raw or raw.startswith("www.") or "/" in raw:
        raw = raw.split("?")[0].rstrip("/").split("/")[-1]
    return raw.strip()


def _looks_like_gtin(value: str) -> bool:
    s = re.sub(r"\D", "", value or "")
    return len(s) in (8, 12, 13, 14) and s.isdigit()


def _looks_like_style_sku(value: str) -> bool:
    s = (value or "").strip()
    # Nike/Adidas style ids like DJ0950-001 / HF5386-001 / IB2263-300
    return bool(re.match(r"^[A-Za-z0-9]{2,}[-_][A-Za-z0-9]{2,}$", s))


def resolve_input(identifier: str) -> Dict[str, Any]:
    """
    Resolve any identifier into a structured result.

    Returns:
      {
        "input": str,
        "kind": "slug"|"gtin"|"sku"|"unknown",
        "slug": str|None,
        "shopify_product": dict|None,
        "shopify_variant": dict|None,   # when GTIN matched a variant
        "matched_via": str|None,
        "error": str|None,
      }
    """
    raw = (identifier or "").strip()
    out: Dict[str, Any] = {
        "input": raw,
        "kind": "unknown",
        "slug": None,
        "shopify_product": None,
        "shopify_variant": None,
        "matched_via": None,
        "error": None,
    }
    if not raw:
        out["error"] = "empty_input"
        return out

    # 1) GTIN → Shopify variant first (exact store match)
    digits = re.sub(r"\D", "", raw)
    if _looks_like_gtin(raw) or _looks_like_gtin(digits):
        out["kind"] = "gtin"
        hit = find_variant_by_barcode(digits or raw)
        if hit:
            out["shopify_variant"] = hit
            out["shopify_product"] = hit.get("product") or {}
            out["matched_via"] = "shopify_barcode"
            # Prefer style SKU → Kicks slug so create/update can fetch StockX
            sku = (hit.get("sku") or "").strip()
            handle = ((hit.get("product") or {}).get("handle") or "").strip()
            if sku:
                slug = stockXAPI.resolve_slug_from_query(sku)
                if slug:
                    out["slug"] = slug
                    return out
            if handle:
                out["slug"] = handle
                return out
            out["slug"] = handle or None
            return out
        # Not on Shopify yet — try Kicks search with GTIN
        slug = stockXAPI.resolve_slug_from_query(digits or raw)
        if slug:
            out["slug"] = slug
            out["matched_via"] = "kicks_search_gtin"
            return out
        out["error"] = "gtin_not_found"
        return out

    # 2) Style SKU → Kicks search
    candidate = _normalize_slug(raw)
    if _looks_like_style_sku(candidate) or _looks_like_style_sku(raw):
        out["kind"] = "sku"
        slug = stockXAPI.resolve_slug_from_query(raw)
        if slug:
            out["slug"] = slug
            out["matched_via"] = "kicks_search_sku"
            product, via = find_product_by_stockx_slug(slug)
            if product:
                out["shopify_product"] = product
                out["matched_via"] = f"{out['matched_via']}+{via}"
            return out
        # Fall through: maybe it's already a slug that looks like sku-ish

    # 3) Slug / URL
    slug = candidate
    out["kind"] = "slug"
    out["slug"] = slug
    product, via = find_product_by_stockx_slug(slug)
    if product:
        out["shopify_product"] = product
        out["matched_via"] = via
    else:
        # Confirm StockX knows this slug
        data = stockXAPI.getOne(slug)
        if not data or not data.get("data"):
            # Last chance: Kicks search by raw text
            found = stockXAPI.resolve_slug_from_query(raw)
            if found and found != slug:
                out["slug"] = found
                out["matched_via"] = "kicks_search_text"
                product, via = find_product_by_stockx_slug(found)
                if product:
                    out["shopify_product"] = product
                    out["matched_via"] = f"kicks_search_text+{via}"
                return out
            out["error"] = "slug_not_on_stockx"
            return out
        out["matched_via"] = "stockx_slug"
    return out


# ---------------------------------------------------------------------------
# Upsert
# ---------------------------------------------------------------------------

def upsert_product(
    identifier: str,
    *,
    lock_after: bool = False,
    lock_sizes: Optional[List[str]] = None,
    price_only: bool = False,
    physical_gtin: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Create or update a product from slug/URL/SKU/GTIN.

    - Missing on Shopify → full create (images, metafields, variants, publish)
    - Exists → full update (same as main pipeline), respecting price_locked
    - price_only=True → skip create; if exists, only sync price/qty for matched sizes
      (still uses main update for now; use set_variant_price for single-variant edits)

    Returns result dict with ok/action/slug/product_id/details/error.
    """
    resolved = resolve_input(identifier)
    result: Dict[str, Any] = {
        "ok": False,
        "action": None,
        "input": identifier,
        "resolved": resolved,
        "slug": resolved.get("slug"),
        "product_id": None,
        "error": None,
    }
    if resolved.get("error") and not resolved.get("slug"):
        result["error"] = resolved["error"]
        return result

    slug = resolved.get("slug")
    if not slug:
        result["error"] = "could_not_resolve_slug"
        return result

    existing = resolved.get("shopify_product")
    if not existing:
        existing, via = find_product_by_stockx_slug(slug)
        if existing:
            resolved["shopify_product"] = existing
            resolved["matched_via"] = via

    action = "update" if existing else "create"
    if price_only and not existing:
        result["error"] = "price_only_requires_existing_product"
        result["action"] = "skipped"
        return result

    try:
        set_physical_restock_gtin(physical_gtin)
        ok = process_single_url_enhanced(
            slug,
            action,
            shopify_products=[],
            skip_creates_on_limit=True,
        )
    except RateLimitException as e:
        result["error"] = f"rate_limited:{e}"
        result["action"] = action
        return result
    finally:
        set_physical_restock_gtin(None)

    if ok is None:
        result["error"] = "deferred_variant_creation_limit"
        result["action"] = action
        return result
    if not ok:
        result["error"] = f"{action}_failed"
        result["action"] = action
        return result

    product, via = find_product_by_stockx_slug(slug)
    result["ok"] = True
    result["action"] = action if not existing else "update"
    result["product_id"] = (product or {}).get("id")
    result["matched_via"] = via
    result["product"] = product

    # Optional lock after upsert
    sizes_to_lock = lock_sizes
    if lock_after and product:
        variants = get_product_variants(product["id"], include_lock=True)
        locked = []
        for v in variants:
            title = str(v.get("title") or "")
            if sizes_to_lock and title not in sizes_to_lock:
                continue
            if set_variant_price_locked(v["id"], True):
                locked.append({"id": v["id"], "size": title})
        result["locked_variants"] = locked

    return result


# ---------------------------------------------------------------------------
# Price / sold / lock
# ---------------------------------------------------------------------------

def _resolve_variant_ref(
    *,
    variant_id: Optional[str] = None,
    barcode: Optional[str] = None,
    product_id: Optional[str] = None,
    size: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    if variant_id:
        return {"id": variant_id, "barcode": barcode, "title": size}
    if barcode:
        hit = find_variant_by_barcode(barcode)
        if not hit:
            return None
        return {
            "id": hit["variant_id"],
            "barcode": hit.get("barcode"),
            "title": hit.get("title"),
            "price": hit.get("price"),
            "product_id": (hit.get("product") or {}).get("id"),
            "sku": hit.get("sku"),
        }
    if product_id and size:
        variants = get_product_variants(product_id, include_lock=True)
        size_n = str(size).strip()
        for v in variants:
            if str(v.get("title") or "").strip() == size_n:
                return v
    return None


def lock_price(
    *,
    variant_id: Optional[str] = None,
    barcode: Optional[str] = None,
    product_id: Optional[str] = None,
    size: Optional[str] = None,
) -> Dict[str, Any]:
    v = _resolve_variant_ref(variant_id=variant_id, barcode=barcode, product_id=product_id, size=size)
    if not v or not v.get("id"):
        return {"ok": False, "error": "variant_not_found"}
    ok = set_variant_price_locked(v["id"], True)
    return {"ok": ok, "variant_id": v["id"], "size": v.get("title"), "locked": True}


def unlock_price(
    *,
    variant_id: Optional[str] = None,
    barcode: Optional[str] = None,
    product_id: Optional[str] = None,
    size: Optional[str] = None,
) -> Dict[str, Any]:
    v = _resolve_variant_ref(variant_id=variant_id, barcode=barcode, product_id=product_id, size=size)
    if not v or not v.get("id"):
        return {"ok": False, "error": "variant_not_found"}
    ok = set_variant_price_locked(v["id"], False)
    return {"ok": ok, "variant_id": v["id"], "size": v.get("title"), "locked": False}


def set_variant_price(
    price: float,
    *,
    variant_id: Optional[str] = None,
    barcode: Optional[str] = None,
    product_id: Optional[str] = None,
    size: Optional[str] = None,
    lock: bool = True,
    force: bool = False,
) -> Dict[str, Any]:
    """
    Set absolute sell price on one variant.
    By default locks price so main automation will not overwrite it.
    If already locked and force=False → refuse (unless you own the lock intent via force).
    """
    v = _resolve_variant_ref(variant_id=variant_id, barcode=barcode, product_id=product_id, size=size)
    if not v or not v.get("id"):
        return {"ok": False, "error": "variant_not_found"}

    vid = v["id"]
    pid = v.get("product_id") or product_id
    if not pid and barcode:
        hit = find_variant_by_barcode(barcode)
        pid = (hit or {}).get("product", {}).get("id")
    if not pid:
        # fetch via variant query
        from shopifyAPI_GQL import _run_query
        q = """
        query($id: ID!) {
          productVariant(id: $id) { id product { id } inventoryItem { id } }
        }
        """
        data = _run_query(q, {"id": vid})
        pid = (((data.get("productVariant") or {}).get("product") or {}).get("id"))
        inv_id = (((data.get("productVariant") or {}).get("inventoryItem") or {}).get("id"))
    else:
        inv_id = v.get("inventoryItemId")

    if get_variant_price_locked(vid) and not force and not lock:
        return {"ok": False, "error": "price_locked", "variant_id": vid}

    price_f = float(price)
    if price_f <= 0:
        return {"ok": False, "error": "price_must_be_positive"}

    # Need product id for bulk update
    if not pid:
        return {"ok": False, "error": "product_id_missing"}

    update_variants_bulk(pid, [{
        "id": vid,
        "price": str(price_f),
        "inventoryItem": {"cost": str(round(price_f * 0.80, 2))},
    }])

    locked = False
    if lock:
        locked = set_variant_price_locked(vid, True)

    return {
        "ok": True,
        "variant_id": vid,
        "product_id": pid,
        "price": price_f,
        "locked": locked or get_variant_price_locked(vid),
        "inventory_item_id": inv_id,
    }


def mark_sold(
    *,
    variant_id: Optional[str] = None,
    barcode: Optional[str] = None,
    product_id: Optional[str] = None,
    size: Optional[str] = None,
    unlock: bool = True,
    keep_price: bool = True,
) -> Dict[str, Any]:
    """
    Mark a variant sold: qty → 0 at online location. Price kept by default.
    Unlocks price_locked so future restocks can get fresh pricing (default unlock=True).
    """
    v = _resolve_variant_ref(variant_id=variant_id, barcode=barcode, product_id=product_id, size=size)
    if not v or not v.get("id"):
        return {"ok": False, "error": "variant_not_found"}

    vid = v["id"]
    # Ensure we have inventory item + current price + product
    from shopifyAPI_GQL import _run_query
    q = """
    query($id: ID!) {
      productVariant(id: $id) {
        id
        title
        price
        product { id }
        inventoryItem { id }
      }
    }
    """
    data = _run_query(q, {"id": vid})
    node = data.get("productVariant") or {}
    inv_id = ((node.get("inventoryItem") or {}).get("id"))
    pid = ((node.get("product") or {}).get("id"))
    current_price = node.get("price") or v.get("price") or "999.99"
    if float(current_price or 0) <= 0:
        current_price = "999.99"

    if not inv_id:
        return {"ok": False, "error": "inventory_item_missing", "variant_id": vid}

    location_id = get_first_location_id()
    inventory_set_quantities_bulk(
        [{"inventoryItemId": inv_id, "quantity": 0}],
        location_id,
        reason="correction",
        reference_document_uri=f"gid://resell-lausanne/MarkSold/{vid}",
    )

    if keep_price and pid:
        # Explicitly keep price (never 0)
        update_variants_bulk(pid, [{
            "id": vid,
            "price": str(current_price),
            "inventoryItem": {"cost": str(round(float(current_price) * 0.80, 2))},
        }])

    unlocked = False
    if unlock:
        unlocked = set_variant_price_locked(vid, False)

    return {
        "ok": True,
        "variant_id": vid,
        "product_id": pid,
        "size": node.get("title") or v.get("title"),
        "quantity": 0,
        "price_kept": current_price if keep_price else None,
        "unlocked": unlocked,
    }


def match_and_update_variant_price(
    identifier: str,
    *,
    size: Optional[str] = None,
    barcode: Optional[str] = None,
    price: Optional[float] = None,
    mark_as_sold: bool = False,
    lock: bool = False,
) -> Dict[str, Any]:
    """
    Find product from identifier, match one variant (size or barcode), then:
      - set price (optional)
      - mark sold (optional)
      - lock (optional)
    """
    resolved = resolve_input(identifier)
    if barcode or (resolved.get("kind") == "gtin" and resolved.get("shopify_variant")):
        bc = barcode or resolved["input"]
        bc = re.sub(r"\D", "", bc) or bc
        if mark_as_sold:
            return mark_sold(barcode=bc, unlock=not lock)
        if price is not None:
            return set_variant_price(price, barcode=bc, lock=lock, force=True)
        return {"ok": False, "error": "nothing_to_do", "resolved": resolved}

    slug = resolved.get("slug")
    product = resolved.get("shopify_product")
    if not product and slug:
        product, _ = find_product_by_stockx_slug(slug)
    if not product:
        return {"ok": False, "error": "product_not_on_shopify", "resolved": resolved}
    if not size:
        return {"ok": False, "error": "size_required_when_no_barcode", "product_id": product.get("id")}

    if mark_as_sold:
        return mark_sold(product_id=product["id"], size=size, unlock=not lock)
    if price is not None:
        return set_variant_price(price, product_id=product["id"], size=size, lock=lock, force=True)
    return {"ok": False, "error": "nothing_to_do", "product_id": product.get("id")}


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def _print_json(obj: Any) -> None:
    import json
    print(json.dumps(obj, indent=2, ensure_ascii=False, default=str))


def main(argv: Optional[List[str]] = None) -> int:
    parser = argparse.ArgumentParser(description="External product upsert / price-lock API")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_up = sub.add_parser("upsert", help="Create or update from slug/url/sku/gtin")
    p_up.add_argument("identifier")
    p_up.add_argument("--lock", action="store_true", help="Lock all variant prices after upsert")
    p_up.add_argument("--lock-size", action="append", default=[], help="Lock only these size titles")
    p_up.add_argument("--price-only", action="store_true")
    p_up.add_argument(
        "--physical-gtin",
        default=None,
        help="Scanned GTIN — create priced variant when StockX has no asks",
    )

    p_res = sub.add_parser("resolve", help="Resolve identifier only")
    p_res.add_argument("identifier")

    p_lock = sub.add_parser("lock", help="Lock price (variant gid or barcode)")
    p_lock.add_argument("ref")
    p_lock.add_argument("--size", default=None)

    p_unlock = sub.add_parser("unlock", help="Unlock price")
    p_unlock.add_argument("ref")
    p_unlock.add_argument("--size", default=None)

    p_sold = sub.add_parser("mark-sold", help="Set qty=0, keep price, unlock by default")
    p_sold.add_argument("ref")
    p_sold.add_argument("--size", default=None)
    p_sold.add_argument("--keep-lock", action="store_true", help="Do not unlock after sold")

    p_price = sub.add_parser("set-price", help="Set price and lock by default")
    p_price.add_argument("ref")
    p_price.add_argument("price", type=float)
    p_price.add_argument("--size", default=None)
    p_price.add_argument("--no-lock", action="store_true")

    args = parser.parse_args(argv)

    if args.cmd == "resolve":
        _print_json(resolve_input(args.identifier))
        return 0

    if args.cmd == "upsert":
        res = upsert_product(
            args.identifier,
            lock_after=args.lock or bool(args.lock_size),
            lock_sizes=args.lock_size or None,
            price_only=args.price_only,
            physical_gtin=getattr(args, "physical_gtin", None),
        )
        _print_json(res)
        return 0 if res.get("ok") else 1

    def _ref_kwargs(ref: str, size: Optional[str]):
        if ref.startswith("gid://shopify/ProductVariant/"):
            return {"variant_id": ref}
        if ref.startswith("gid://shopify/Product/") and size:
            return {"product_id": ref, "size": size}
        if _looks_like_gtin(ref) or re.sub(r"\D", "", ref).isdigit() and len(re.sub(r"\D", "", ref)) >= 8:
            return {"barcode": re.sub(r"\D", "", ref)}
        # treat as slug → need size
        resolved = resolve_input(ref)
        product = resolved.get("shopify_product")
        if not product and resolved.get("slug"):
            product, _ = find_product_by_stockx_slug(resolved["slug"])
        if product and size:
            return {"product_id": product["id"], "size": size}
        if product and not size:
            raise SystemExit("Need --size when ref is product slug/handle")
        raise SystemExit(f"Could not resolve ref={ref!r}")

    if args.cmd == "lock":
        _print_json(lock_price(**_ref_kwargs(args.ref, args.size)))
        return 0
    if args.cmd == "unlock":
        _print_json(unlock_price(**_ref_kwargs(args.ref, args.size)))
        return 0
    if args.cmd == "mark-sold":
        _print_json(mark_sold(**_ref_kwargs(args.ref, args.size), unlock=not args.keep_lock))
        return 0
    if args.cmd == "set-price":
        _print_json(set_variant_price(
            args.price,
            **_ref_kwargs(args.ref, args.size),
            lock=not args.no_lock,
            force=True,
        ))
        return 0

    return 2


if __name__ == "__main__":
    sys.exit(main())
