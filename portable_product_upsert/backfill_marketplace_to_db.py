"""
Marketplace backfill: fill rawJson for products that live in the DB but were
never on Shopify (added by the Galaxus enrichment path, often express-only
sales).

Bootstrap covers the Shopify catalog. This covers everything else: rows with
`rawJson IS NULL` and no ShopifySyncState. After this run every KicksDB product
has a full payload, so:
  - the buffer is the single source of truth for both channels, and
  - the create-queue sorter can rank these products by recent sales and feed
    the daily Shopify create quota.

For each product:
  1. GET /api/kickdb/needs-raw            -> next batch of marketplace-only ids
  2. KicksDB GET /v3/stockx/products/{id} -> full raw payload (UUID first,
     urlKey fallback)
  3. POST /api/kickdb/upsert              -> rawJson stored (COALESCE merge,
     never nulls enrichment-written fields). NO mark-synced: these stay
     un-listed create candidates on purpose.

Run this AFTER the Shopify bootstrap finishes so the two jobs never fetch the
same product twice. Safe to interrupt/re-run: needs-raw only returns rows that
still lack rawJson, and permanent misses are remembered in the progress file.

Usage:
    python3 backfill_marketplace_to_db.py --db-api http://127.0.0.1:3000 --limit 20  # trial
    python3 backfill_marketplace_to_db.py --db-api http://127.0.0.1:3000             # full run
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stockXAPI

BASE_DIR = Path(__file__).resolve().parent
PROGRESS_FILE = BASE_DIR / "backfill_progress.json"
REVIEW_FILE = BASE_DIR / "backfill_review.txt"
DB_API_DEFAULT = os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3000")


def _auth_headers():
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    return {"x-internal-token": token} if token else {}


def load_progress():
    try:
        with open(PROGRESS_FILE, "r", encoding="utf-8") as f:
            p = json.load(f)
            p.setdefault("done", {})
            p.setdefault("review", {})
            return p
    except Exception:
        return {"done": {}, "review": {}}


def save_progress(progress):
    tmp = str(PROGRESS_FILE) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(progress, f)
    os.replace(tmp, PROGRESS_FILE)


def append_review(pid, reason):
    with open(REVIEW_FILE, "a", encoding="utf-8") as f:
        f.write(f"{pid}\t{reason}\n")


def _post_with_retry(url, body, timeout):
    last_err = None
    for attempt in range(4):
        try:
            return requests.post(url, json=body, headers=_auth_headers(), timeout=timeout)
        except requests.exceptions.RequestException as exc:
            last_err = exc
            time.sleep(2 ** attempt)
    raise last_err


def _get_with_retry(url, params, timeout):
    last_err = None
    for attempt in range(4):
        try:
            return requests.get(url, params=params, headers=_auth_headers(), timeout=timeout)
        except requests.exceptions.RequestException as exc:
            last_err = exc
            time.sleep(2 ** attempt)
    raise last_err


def fetch_batch(db_api, limit):
    r = _get_with_retry(f"{db_api}/api/kickdb/needs-raw", {"limit": limit}, 60)
    if r.status_code != 200:
        raise RuntimeError(f"needs-raw {r.status_code}: {r.text[:150]}")
    return (r.json() or {}).get("products") or []


def upsert_raw(db_api, payload):
    data = payload.get("data") or {}
    kickdb_product_id = data.get("id")
    if not kickdb_product_id:
        return False, "payload_missing_id"
    try:
        r = _post_with_retry(f"{db_api}/api/kickdb/upsert", payload, 60)
    except requests.exceptions.RequestException as exc:
        return False, f"upsert_conn:{exc.__class__.__name__}"
    if r.status_code != 200 or not r.json().get("ok"):
        return False, f"upsert_failed:{r.status_code}:{r.text[:150]}"
    return True, kickdb_product_id


def main():
    parser = argparse.ArgumentParser(description="Backfill marketplace-only products into DB buffer")
    parser.add_argument("--db-api", default=DB_API_DEFAULT)
    parser.add_argument("--limit", type=int, default=0, help="stop after N products (0 = all)")
    parser.add_argument("--batch", type=int, default=500, help="ids fetched per needs-raw poll")
    parser.add_argument("--delay", type=float, default=0.15,
                        help="seconds between KicksDB calls (quota-friendly)")
    args = parser.parse_args()

    progress = load_progress()
    done = progress["done"]
    review = progress["review"]

    processed = ok_count = miss_count = 0
    print(f"[INFO] Backfill start; {len(done)} done, {len(review)} in review from prior runs")

    while True:
        batch = fetch_batch(args.db_api, args.batch)
        # Drop anything we've already permanently skipped this run so needs-raw
        # (which still returns rows without rawJson) can't loop forever.
        batch = [p for p in batch if p.get("kickdbProductId") not in review]
        if not batch:
            print("[INFO] needs-raw returned no new work; done.")
            break

        made_progress = False
        for p in batch:
            pid = p.get("kickdbProductId")
            url_key = p.get("urlKey")
            if not pid or pid in done:
                continue
            if args.limit and processed >= args.limit:
                break
            processed += 1
            made_progress = True

            out = None
            try:
                out = stockXAPI.getOne(pid)
            except Exception as exc:
                print(f"[ERR] {pid}: getOne crashed: {exc}")
            if (not out or not out.get("data")) and url_key:
                time.sleep(args.delay)
                try:
                    out = stockXAPI.getOne(url_key)
                except Exception as exc:
                    print(f"[ERR] {pid}: getOne(urlKey) crashed: {exc}")

            if not out or not out.get("data"):
                reason = stockXAPI.last_fetch_error or "not_found"
                print(f"[MISS] {pid} ({url_key}): {reason}")
                review[pid] = reason
                append_review(pid, reason)
                progress["review"] = review
                save_progress(progress)
                miss_count += 1
                time.sleep(args.delay)
                continue

            success, info = upsert_raw(args.db_api, out)
            if success:
                ok_count += 1
                done[pid] = info
                if ok_count % 50 == 0:
                    print(f"[PROGRESS] ok={ok_count} miss={miss_count} processed={processed}")
            else:
                print(f"[FAIL] {pid}: {info}")
                review[pid] = info
                append_review(pid, info)
                progress["review"] = review

            progress["done"] = done
            save_progress(progress)
            time.sleep(args.delay)

        if args.limit and processed >= args.limit:
            print(f"[INFO] Hit --limit {args.limit}; stopping.")
            break
        if not made_progress:
            print("[INFO] No progress in last batch; stopping to avoid a loop.")
            break

    print(f"\n[DONE] processed={processed} ok={ok_count} miss={miss_count} "
          f"(total done={len(done)}, review={len(review)})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
