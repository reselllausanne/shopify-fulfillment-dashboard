"""
Shopify consumer for the SSE DB buffer.

Reads products whose raw KicksDB payload is newer than their last Shopify push
(GET /api/kickdb/fresh), feeds the RAW payload straight into main.py via the
`prefetched` parameter (zero KicksDB calls, zero re-parsing), then records the
push (POST /api/kickdb/mark-synced).

The raw payload in KickDBProduct.rawJson is byte-identical to what
stockXAPI.getOne() returns, so every battle-tested main.py code path
(EU size mapping, price validation, 429 partials, deferred creates) runs
unchanged.

Usage:
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --test-mode
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --limit 50
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --status create_candidate --max-create-variants 900

Exit codes: 0 ok, 2 catalog fetch failed, 3 Shopify rate limited (retry later).
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import main as main_mod
from shopifyAPI_GQL import get_all_products, RateLimitException

DB_API_DEFAULT = os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3000")
CATALOG_CACHE_FILE = Path(__file__).resolve().parent / ".shopify_catalog_cache.json"
CATALOG_CACHE_TTL_SEC = 3600  # refetching 20k products every 15-min cron run is pointless


def _auth_headers():
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    return {"x-internal-token": token} if token else {}


def fetch_fresh_products(db_api, limit=50, status="pending"):
    r = requests.get(
        f"{db_api}/api/kickdb/fresh",
        params={"limit": limit, "status": status},
        headers=_auth_headers(),
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise RuntimeError(f"fresh API error: {body}")
    return body.get("products", [])


def mark_synced(db_api, kickdb_product_id, shopify_handle=None, error=None):
    payload = {"kickdbProductId": kickdb_product_id}
    if shopify_handle:
        payload["shopifyHandle"] = shopify_handle
    if error:
        payload["error"] = str(error)[:2000]
    try:
        r = requests.post(
            f"{db_api}/api/kickdb/mark-synced",
            json=payload,
            headers=_auth_headers(),
            timeout=30,
        )
        return r.status_code == 200
    except Exception as e:
        print(f"[WARNING] mark-synced failed for {kickdb_product_id}: {e}")
        return False


def load_shopify_catalog(force_refresh=False):
    """Shopify catalog with a disk cache shared across cron runs (TTL 1h)."""
    if not force_refresh and CATALOG_CACHE_FILE.exists():
        try:
            age = time.time() - CATALOG_CACHE_FILE.stat().st_mtime
            if age < CATALOG_CACHE_TTL_SEC:
                with open(CATALOG_CACHE_FILE, "r", encoding="utf-8") as f:
                    catalog = json.load(f)
                print(f"[INFO] Shopify catalog from cache ({len(catalog)} products, age {int(age)}s)")
                return catalog
        except Exception as e:
            print(f"[WARNING] catalog cache read failed ({e}), refetching")

    catalog = get_all_products()
    try:
        tmp = str(CATALOG_CACHE_FILE) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(catalog, f)
        os.replace(tmp, CATALOG_CACHE_FILE)
    except Exception as e:
        print(f"[WARNING] catalog cache write failed: {e}")
    print(f"[INFO] Shopify catalog fetched ({len(catalog)} products)")
    return catalog


def main():
    parser = argparse.ArgumentParser(description="Consume fresh products from DB buffer -> Shopify")
    parser.add_argument("--db-api", default=DB_API_DEFAULT)
    parser.add_argument("--limit", type=int, default=50, help="max products per run")
    parser.add_argument("--status", default="pending", choices=["pending", "create_candidate"])
    parser.add_argument("--test-mode", action="store_true", help="stop after 10 products")
    parser.add_argument("--max-create-variants", type=int, default=900,
                        help="daily create cap passed to main.py quota logic")
    parser.add_argument("--fresh-catalog", action="store_true", help="ignore catalog disk cache")
    args = parser.parse_args()

    try:
        shopify_products = load_shopify_catalog(force_refresh=args.fresh_catalog)
    except RateLimitException as e:
        print(f"[ERROR] Shopify rate limit on catalog fetch: {e}")
        return 2
    except Exception as e:
        print(f"[ERROR] Shopify catalog fetch failed: {e}")
        return 2

    fresh = fetch_fresh_products(args.db_api, limit=args.limit, status=args.status)
    print(f"[INFO] {len(fresh)} fresh products (status={args.status}, limit={args.limit})")

    if args.test_mode:
        fresh = fresh[:10]
        print(f"[INFO] TEST MODE: limited to {len(fresh)} products")

    action = "create" if args.status == "create_candidate" else "update"
    processed = success = 0

    for row in fresh:
        kickdb_product_id = row.get("kickdbProductId")
        raw = row.get("rawJson")
        if not raw or not isinstance(raw, dict):
            print(f"[SKIP] {kickdb_product_id}: empty rawJson")
            mark_synced(args.db_api, kickdb_product_id, error="empty_rawJson")
            processed += 1
            continue

        slug = (raw.get("slug") or row.get("urlKey") or kickdb_product_id or "").strip()
        print(f"\n[INFO] [{processed + 1}/{len(fresh)}] {action}: {slug}")
        try:
            ok = main_mod.process_single_url_enhanced(
                slug, action, shopify_products,
                skip_creates_on_limit=True,
                prefetched=raw,
            )
            if ok:
                success += 1
                mark_synced(args.db_api, kickdb_product_id, shopify_handle=slug)
                print(f"[OK] synced + marked: {slug}")
            else:
                # Not pushed (skipped/filtered by main.py) — record so it doesn't loop forever.
                mark_synced(args.db_api, kickdb_product_id, error="main_py_returned_false")
                print(f"[SKIP] not synced: {slug}")
        except RateLimitException:
            print("[CRITICAL] Shopify 429 — stopping run; main.py saved partials. Retry after cooldown.")
            return 3
        except Exception as e:
            print(f"[ERROR] {slug}: {e}")
            mark_synced(args.db_api, kickdb_product_id, error=e)

        processed += 1
        if args.test_mode and processed >= 10:
            break

    print(f"\n[DONE] processed={processed} success={success}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
