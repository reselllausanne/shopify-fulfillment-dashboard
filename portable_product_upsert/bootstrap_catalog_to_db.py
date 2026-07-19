"""
One-time bootstrap: register the existing Shopify catalog in the DB buffer.

For every Shopify product:
  1. handle == StockX slug (enforced by main.py's sync_product_handle_to_stockx_slug)
  2. KicksDB GET /v3/stockx/products/{handle}  ->  UUID + full raw payload
  3. POST /api/kickdb/upsert                   ->  rawJson stored (same-UUID rows
     already created by marketplace enrichment get enriched, never duplicated)
  4. POST /api/kickdb/mark-synced              ->  ShopifySyncState row with
     shopifyProductId + handle (product now tracked; SSE events flow from here)

Misses (404 / renamed slug): fallback KicksDB search by style-ID from the
Shopify SKU; still unresolved -> bootstrap_review.txt for manual review.

Resumable: progress in bootstrap_progress.json, safe to re-run (idempotent
upserts, already-done handles skipped).

Usage:
    python3 bootstrap_catalog_to_db.py --db-api http://127.0.0.1:3000 --limit 20   # trial
    python3 bootstrap_catalog_to_db.py --db-api http://127.0.0.1:3000              # full run
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
from shopifyAPI_GQL import get_all_products
import stockXAPI

BASE_DIR = Path(__file__).resolve().parent
PROGRESS_FILE = BASE_DIR / "bootstrap_progress.json"
REVIEW_FILE = BASE_DIR / "bootstrap_review.txt"
DB_API_DEFAULT = os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3000")

KICKS_SEARCH_URL = "https://api.kicks.dev/v3/stockx/products"


def _auth_headers():
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    return {"x-internal-token": token} if token else {}


def load_progress():
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {"done": {}, "review": {}}


def save_progress(progress):
    tmp = str(PROGRESS_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(progress, f)
    os.replace(tmp, PROGRESS_FILE)


def append_review(handle, reason):
    with open(REVIEW_FILE, "a", encoding="utf-8") as f:
        f.write(f"{handle}\t{reason}\n")


def search_by_style_id(style_id, api_key):
    """Fallback: KicksDB search by style-ID (Shopify SKU prefix)."""
    try:
        r = requests.get(
            KICKS_SEARCH_URL,
            headers={"Authorization": api_key},
            params={"query": style_id, "limit": 5},
            timeout=25,
        )
        if r.status_code != 200:
            return None
        hits = (r.json() or {}).get("data") or []
        norm = style_id.replace("-", "").replace(" ", "").upper()
        for h in hits:
            hit_sku = str(h.get("sku") or "").replace("-", "").replace(" ", "").upper()
            if hit_sku and hit_sku == norm:
                return h.get("id") or h.get("slug")
        return None
    except Exception:
        return None


def upsert_and_mark(db_api, payload, shopify_product_id, handle):
    data = payload.get("data") or {}
    kickdb_product_id = data.get("id")
    if not kickdb_product_id:
        return False, "payload_missing_id"

    def _post(path, body, timeout):
        last_err = None
        for attempt in range(4):
            try:
                return requests.post(f"{db_api}{path}", json=body,
                                     headers=_auth_headers(), timeout=timeout)
            except requests.exceptions.RequestException as exc:
                last_err = exc
                time.sleep(2 ** attempt)
        raise last_err

    try:
        r = _post("/api/kickdb/upsert", payload, 60)
    except requests.exceptions.RequestException as exc:
        return False, f"upsert_conn:{exc.__class__.__name__}"
    if r.status_code != 200 or not r.json().get("ok"):
        return False, f"upsert_failed:{r.status_code}:{r.text[:150]}"

    try:
        r = _post("/api/kickdb/mark-synced", {
            "kickdbProductId": kickdb_product_id,
            "shopifyProductId": shopify_product_id,
            "shopifyHandle": handle,
        }, 30)
    except requests.exceptions.RequestException as exc:
        return False, f"mark_conn:{exc.__class__.__name__}"
    if r.status_code != 200:
        return False, f"mark_failed:{r.status_code}"
    return True, kickdb_product_id


def extract_style_id(product):
    """First variant SKU prefix (style-id part before the size suffix)."""
    for v in product.get("variants", []) or []:
        sku = str(v.get("sku") or "").strip()
        if sku:
            # SKUs look like "DD1391-100-42" (style-id + size) — drop last segment.
            parts = sku.rsplit("-", 1)
            return parts[0] if len(parts) == 2 else sku
    return None


def main():
    parser = argparse.ArgumentParser(description="Bootstrap Shopify catalog into DB buffer")
    parser.add_argument("--db-api", default=DB_API_DEFAULT)
    parser.add_argument("--limit", type=int, default=0, help="stop after N products (0 = all)")
    parser.add_argument("--delay", type=float, default=0.35,
                        help="seconds between KicksDB calls (quota-friendly)")
    args = parser.parse_args()

    api_key = os.environ.get("KICKSDB_API_KEY", "").strip() or "sd_kRbsuYh7brcMNR5BermZnUhufKUNBnuA"

    progress = load_progress()
    done = progress["done"]
    review = progress["review"]

    print("[INFO] Fetching Shopify catalog...")
    catalog = get_all_products()
    print(f"[INFO] {len(catalog)} Shopify products; {len(done)} already bootstrapped")

    processed = ok_count = miss_count = 0
    for product in catalog:
        handle = str(product.get("handle") or "").strip().lower()
        pid = str(product.get("id") or "")
        if not handle or handle in done or handle in review:
            continue

        if args.limit and processed >= args.limit:
            break
        processed += 1

        try:
            out = stockXAPI.getOne(handle)
        except Exception as exc:
            print(f"[ERR] {handle}: getOne crashed: {exc}")
            review[handle] = f"getone_exc:{exc.__class__.__name__}"
            append_review(handle, review[handle])
            progress["review"] = review
            save_progress(progress)
            miss_count += 1
            time.sleep(args.delay)
            continue
        resolved_via = "handle"
        if not out or not out.get("data"):
            style_id = extract_style_id(product)
            id_or_slug = search_by_style_id(style_id, api_key) if style_id else None
            if id_or_slug:
                time.sleep(args.delay)
                out = stockXAPI.getOne(id_or_slug)
                resolved_via = f"style_id:{style_id}"
            if not out or not out.get("data"):
                reason = stockXAPI.last_fetch_error or "not_found"
                print(f"[MISS] {handle}: {reason} (style_id fallback failed)")
                review[handle] = reason
                append_review(handle, reason)
                progress["review"] = review
                save_progress(progress)
                miss_count += 1
                time.sleep(args.delay)
                continue

        success, info = upsert_and_mark(args.db_api, out, pid, handle)
        if success:
            ok_count += 1
            done[handle] = info
            if ok_count % 50 == 0:
                print(f"[PROGRESS] ok={ok_count} miss={miss_count} processed={processed}")
        else:
            print(f"[FAIL] {handle}: {info}")
            review[handle] = info
            append_review(handle, info)
            progress["review"] = review

        progress["done"] = done
        save_progress(progress)
        time.sleep(args.delay)

    print(f"\n[DONE] processed={processed} ok={ok_count} miss={miss_count} "
          f"(total done={len(done)}, review={len(review)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
