"""
Shopify consumer for the SSE DB buffer.

Reads products whose raw KicksDB payload is newer than their last Shopify push
(GET /api/kickdb/fresh), feeds the RAW payload straight into main.py via the
`prefetched` parameter (zero KicksDB calls, zero re-parsing), then records the
push (POST /api/kickdb/mark-synced).

Create quota: NEVER counted locally. Probe Shopify GraphQL cost bucket at run
start; keep creating until Shopify returns "Daily variant creation limit
reached" (RateLimitException). That API signal alone writes a cooldown marker
so subsequent cron ticks no-op until the wait expires.

Usage:
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --test-mode
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --limit 50
    python3 main_from_db.py --db-api http://127.0.0.1:3000 --status untracked

Exit codes: 0 ok, 2 catalog fetch failed, 3 Shopify daily variant limit (retry later),
            4 create cooldown active (Shopify previously said wait).
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
from shopifyAPI_GQL import get_all_products, probe_shopify_capacity, RateLimitException

DB_API_DEFAULT = os.environ.get("KICKDB_BUFFER_BASE", os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3002"))
CATALOG_CACHE_FILE = Path(__file__).resolve().parent / ".shopify_catalog_cache.json"
CATALOG_CACHE_TTL_SEC = 3600  # refetching 20k products every cron run is pointless
# Written ONLY when Shopify returns daily variant-create limit — not a counter.
CREATE_BLOCKED_UNTIL_FILE = Path(__file__).resolve().parent / "logs" / "variant_create_blocked_until"
# Legacy local tally — deleted on startup so it can never poison creates again.
LEGACY_BUDGET_FILE = Path(__file__).resolve().parent / "logs" / "variant_create_budget.json"
MIN_THROTTLE_AVAILABLE = 50  # wait/restore if GraphQL bucket nearly empty


def _auth_headers():
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    return {"x-internal-token": token} if token else {}


def raw_has_any_image(raw):
    """Cheap pre-flight: does the KicksDB raw payload carry ANY usable image URL?

    Mirrors the sources used by `select_stockx_product_images` /
    `list_all_gallery_360_urls` in main.py: primary `image`, `gallery` list,
    `gallery_360` list. A ton of KicksDB rows come through with all three
    empty; without this check we still spin up Shopify probes, catalog match,
    create-shell, only for main.py to bail with reason=no_images. Blocking
    those rows here saves Shopify API + main.py cycles per cron tick.
    """
    if not isinstance(raw, dict):
        return False
    primary = raw.get("image")
    if isinstance(primary, str) and primary.strip():
        return True
    for key in ("gallery", "gallery_360"):
        val = raw.get(key)
        if isinstance(val, list):
            for item in val:
                if isinstance(item, str) and item.strip():
                    return True
                if isinstance(item, dict):
                    for k in ("url", "src", "image", "imageUrl"):
                        v = item.get(k)
                        if isinstance(v, str) and v.strip():
                            return True
    return False


def _purge_legacy_budget_file():
    try:
        if LEGACY_BUDGET_FILE.exists():
            LEGACY_BUDGET_FILE.unlink()
            print(f"[INFO] Removed legacy local budget file: {LEGACY_BUDGET_FILE}")
    except Exception as e:
        print(f"[WARNING] could not remove legacy budget file: {e}")


def load_create_blocked_until():
    try:
        if not CREATE_BLOCKED_UNTIL_FILE.exists():
            return 0.0
        return float(CREATE_BLOCKED_UNTIL_FILE.read_text(encoding="utf-8").strip() or 0)
    except Exception:
        return 0.0


def save_create_blocked_until(until_ts, reason=""):
    CREATE_BLOCKED_UNTIL_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(CREATE_BLOCKED_UNTIL_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(str(float(until_ts)))
    os.replace(tmp, CREATE_BLOCKED_UNTIL_FILE)
    wait_h = max(0.0, (until_ts - time.time()) / 3600.0)
    print(
        f"[COOLDOWN] Shopify daily variant-create limit — blocked for ~{wait_h:.1f}h "
        f"(until={int(until_ts)}){(' reason=' + reason) if reason else ''}"
    )


def clear_create_blocked_until():
    try:
        if CREATE_BLOCKED_UNTIL_FILE.exists():
            CREATE_BLOCKED_UNTIL_FILE.unlink()
    except Exception:
        pass


def created_variant_count(result):
    """Only real int counts. Never treat bool True as 1 (isinstance(True, int) is True)."""
    if isinstance(result, dict):
        n = result.get("variants_created")
        return n if type(n) is int and n > 0 else 0
    return result if type(result) is int and result > 0 else 0


def is_daily_variant_limit(exc):
    msg = str(exc).lower()
    return (
        "daily variant creation limit" in msg
        or "variant creation limit" in msg
        or "daily limit" in msg
    )


def probe_and_wait_for_capacity(action):
    """
    Probe Shopify live. Soft GraphQL bucket only — daily variant-create remaining
    is NOT exposed by Shopify. Returns probe dict or raises RateLimitException.
    """
    probe = probe_shopify_capacity()
    throttle = probe.get("throttle") or {}
    available = throttle.get("currentlyAvailable")
    restore = throttle.get("restoreRate") or 50
    print(
        f"[PROBE] productVariantsCount={probe.get('productVariantsCount')} "
        f"dailyCreateCapHint={probe.get('dailyVariantCreateCapHint')} "
        f"throttle available={available}/{throttle.get('maximumAvailable')} "
        f"restoreRate={restore}/s"
    )
    if action == "create" and available is not None and available < MIN_THROTTLE_AVAILABLE:
        need = MIN_THROTTLE_AVAILABLE - float(available)
        wait_s = min(60.0, max(1.0, need / float(restore)))
        print(f"[PROBE] GraphQL bucket low ({available}) — waiting {wait_s:.1f}s to restore")
        time.sleep(wait_s)
        probe = probe_shopify_capacity()
        throttle = probe.get("throttle") or {}
        print(
            f"[PROBE] after wait: available={throttle.get('currentlyAvailable')}/"
            f"{throttle.get('maximumAvailable')}"
        )
    return probe


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


def mark_synced(
    db_api,
    kickdb_product_id,
    shopify_handle=None,
    shopify_product_id=None,
    error=None,
    permanent=False,
    reason=None,
):
    payload = {"kickdbProductId": kickdb_product_id}
    if shopify_handle:
        payload["shopifyHandle"] = shopify_handle
    if shopify_product_id:
        payload["shopifyProductId"] = str(shopify_product_id)
    if error:
        payload["error"] = str(error)[:2000]
    if permanent:
        payload["permanent"] = True
    if reason:
        payload["reason"] = str(reason)[:200]
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


def normalize_process_result(result):
    """Normalize main.py create/update return into a dict, or False/None."""
    if result is None:
        return None  # deferred (daily variant limit mid-create)
    if result is False:
        return False
    if isinstance(result, dict) and result.get("ok"):
        return result
    # Legacy: int variant count from create
    if type(result) is int and result > 0:
        return {"ok": True, "shopify_product_id": None, "variants_created": result}
    # Legacy: bare True from update (no product id)
    if result is True:
        return {"ok": True, "shopify_product_id": None, "variants_created": 0}
    return False


def load_shopify_catalog(force_refresh=False):
    """Shopify catalog with a disk cache shared across cron runs (TTL 1h).
    On live fetch failure, fall back to stale cache so create/update can still run.
    """
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

    try:
        catalog = get_all_products()
    except Exception as e:
        if CATALOG_CACHE_FILE.exists():
            try:
                with open(CATALOG_CACHE_FILE, "r", encoding="utf-8") as f:
                    catalog = json.load(f)
                age = int(time.time() - CATALOG_CACHE_FILE.stat().st_mtime)
                print(
                    f"[WARNING] catalog live fetch failed ({e}); "
                    f"using STALE cache ({len(catalog)} products, age {age}s)"
                )
                return catalog
            except Exception as e2:
                print(f"[ERROR] stale catalog cache also unusable: {e2}")
        raise

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
    parser.add_argument(
        "--status",
        default="pending",
        choices=["pending", "create_candidate", "untracked"],
        help=(
            "pending           = known Shopify products needing update; "
            "create_candidate  = flagged untracked (legacy path); "
            "untracked         = every KickDBProduct with no ShopifySyncState row, no flag step required"
        ),
    )
    parser.add_argument("--test-mode", action="store_true", help="stop after 10 products")
    parser.add_argument(
        "--max-create-variants",
        type=int,
        default=0,
        help="DEPRECATED ignored — quota comes from Shopify API only",
    )
    parser.add_argument("--fresh-catalog", action="store_true", help="ignore catalog disk cache")
    parser.add_argument(
        "--force",
        action="store_true",
        help="ignore create cooldown marker (still stops when Shopify 429s)",
    )
    args = parser.parse_args()

    _purge_legacy_budget_file()

    action = "create" if args.status in ("create_candidate", "untracked") else "update"

    if action == "create" and not args.force:
        blocked_until = load_create_blocked_until()
        now = time.time()
        if blocked_until > now:
            wait_h = (blocked_until - now) / 3600.0
            print(
                f"[SKIP] create cooldown active (~{wait_h:.1f}h left) — "
                f"Shopify previously returned daily variant-create limit"
            )
            return 4
        if blocked_until > 0:
            clear_create_blocked_until()
            print("[INFO] create cooldown expired — resuming creates")

    try:
        probe_and_wait_for_capacity(action)
    except RateLimitException as e:
        print(f"[ERROR] Shopify capacity probe rate-limited: {e}")
        if action == "create" and is_daily_variant_limit(e):
            retry = getattr(e, "retry_after", None)
            try:
                retry_s = float(retry) if retry is not None else 24 * 3600
            except (TypeError, ValueError):
                retry_s = 24 * 3600
            save_create_blocked_until(time.time() + retry_s, reason=str(e))
            return 3
        return 2
    except Exception as e:
        print(f"[WARNING] capacity probe failed (continuing): {e}")

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

    if action == "create":
        print(
            "[INFO] Create mode: no local budget. Will create until Shopify "
            "returns daily variant-create limit (or product limit reached)."
        )

    processed = success = 0
    variants_created = 0

    for row in fresh:
        kickdb_product_id = row.get("kickdbProductId")
        raw = row.get("rawJson")
        if not raw or not isinstance(raw, dict):
            print(f"[SKIP] {kickdb_product_id}: empty rawJson")
            mark_synced(args.db_api, kickdb_product_id, error="empty_rawJson")
            processed += 1
            continue

        slug = (raw.get("slug") or row.get("urlKey") or kickdb_product_id or "").strip()

        # Pre-flight: park rows with no images BEFORE any Shopify work. KicksDB
        # frequently returns payloads with zero image/gallery/gallery_360 — no
        # point probing Shopify, matching catalog, or invoking main.py just to
        # skip at the create guard. Blocked rows stay out of /fresh until a new
        # SSE refresh replaces rawJson (rawFetchedAt bumps past shopifySyncedAt).
        if action == "create" and not raw_has_any_image(raw):
            print(f"[SKIP] {slug}: no images in raw payload — blocking")
            mark_synced(
                args.db_api,
                kickdb_product_id,
                permanent=True,
                reason="no_images",
            )
            processed += 1
            continue

        if action == "create":
            planned = main_mod.estimate_create_variant_count(slug, prefetched=raw)
            if planned <= 0:
                print(f"[SKIP] {slug}: 0 plannable variants")
                mark_synced(args.db_api, kickdb_product_id, error="zero_plannable_variants")
                processed += 1
                continue

        print(f"\n[INFO] [{processed + 1}/{len(fresh)}] {action}: {slug}")
        try:
            result = main_mod.process_single_url_enhanced(
                slug, action, shopify_products,
                skip_creates_on_limit=True,
                prefetched=raw,
            )
            parsed = normalize_process_result(result)
            created_n = created_variant_count(parsed if parsed is not None else result)
            if parsed is None:
                # mid-create daily limit — do NOT mark synced; retry next run after cooldown
                print(f"[DEFER] variant limit hit mid-create: {slug}")
                save_create_blocked_until(time.time() + 24 * 3600, reason="deferred_mid_create")
                print(
                    f"\n[DONE] processed={processed} success={success} "
                    f"variants_created={variants_created} (stopped: Shopify daily limit)"
                )
                return 3
            if parsed and parsed.get("ok"):
                shopify_product_id = parsed.get("shopify_product_id")
                if not shopify_product_id:
                    # Refuse ghost synced rows (handle-only). Keep as error so
                    # untracked create queue retries instead of parking forever.
                    mark_synced(
                        args.db_api,
                        kickdb_product_id,
                        shopify_handle=slug,
                        error="missing_shopify_product_id",
                    )
                    print(f"[SKIP] {slug}: success without shopifyProductId — not marking synced")
                else:
                    success += 1
                    if created_n > 0:
                        variants_created += created_n
                        print(f"[OK] +{created_n} variants created this product (run total={variants_created})")
                    mark_synced(
                        args.db_api,
                        kickdb_product_id,
                        shopify_handle=slug,
                        shopify_product_id=shopify_product_id,
                    )
                    print(f"[OK] synced + marked: {slug} ({shopify_product_id})")
            else:
                mark_synced(args.db_api, kickdb_product_id, error="main_py_returned_false")
                print(f"[SKIP] not synced: {slug}")
        except RateLimitException as e:
            retry = getattr(e, "retry_after", None)
            try:
                retry_s = float(retry) if retry is not None else 24 * 3600
            except (TypeError, ValueError):
                retry_s = 24 * 3600
            if is_daily_variant_limit(e) or action == "create":
                save_create_blocked_until(time.time() + retry_s, reason=str(e))
            print(
                "[CRITICAL] Shopify 429 — stopping run; main.py saved partials. "
                "Retry after cooldown."
            )
            print(
                f"\n[DONE] processed={processed} success={success} "
                f"variants_created={variants_created} (stopped: rate limit)"
            )
            return 3
        except Exception as e:
            print(f"[ERROR] {slug}: {e}")
            mark_synced(args.db_api, kickdb_product_id, error=e)

        processed += 1
        if args.test_mode and processed >= 10:
            break

    print(f"\n[DONE] processed={processed} success={success} variants_created={variants_created}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
