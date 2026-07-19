"""
Sweeper: refresh stale catalog products in the DB buffer.

SSE only reports price MOVEMENT. A product whose last ask expired or was
delisted emits no event and would rot at its last known price/quantity on
Shopify (overselling risk on the long tail). The sweeper closes that gap:

  Every catalog product (= has a ShopifySyncState row) whose rawFetchedAt is
  older than --max-age-days gets one KicksDB refresh by UUID (slug renames
  can't break this). The refreshed rawJson bumps rawFetchedAt, which puts the
  product back in the /api/kickdb/fresh queue for the consumer's next run.

Sized for cron: --limit caps KicksDB calls per run. 20k catalog / 7-day cycle
needs ~3k/day.

Usage (daily cron):
    python3 sweeper_refresh_stale.py --db-api http://127.0.0.1:3000 --max-age-days 7 --limit 3000
"""

import argparse
import os
import sys
import time
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent))
import stockXAPI

DB_API_DEFAULT = os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3000")


def _auth_headers():
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    return {"x-internal-token": token} if token else {}


def fetch_stale(db_api, max_age_days, limit):
    r = requests.get(
        f"{db_api}/api/kickdb/stale",
        params={"maxAgeDays": max_age_days, "limit": limit},
        headers=_auth_headers(),
        timeout=60,
    )
    r.raise_for_status()
    body = r.json()
    if not body.get("ok"):
        raise RuntimeError(f"stale API error: {body}")
    return body.get("products", [])


def main():
    parser = argparse.ArgumentParser(description="Refresh stale catalog products from KicksDB")
    parser.add_argument("--db-api", default=DB_API_DEFAULT)
    parser.add_argument("--max-age-days", type=int, default=7)
    parser.add_argument("--limit", type=int, default=3000)
    parser.add_argument("--delay", type=float, default=0.35)
    args = parser.parse_args()

    stale = fetch_stale(args.db_api, args.max_age_days, args.limit)
    print(f"[INFO] {len(stale)} stale catalog products (older than {args.max_age_days}d)")

    ok = fail = gone = 0
    for row in stale:
        uuid = row.get("kickdbProductId")
        out = stockXAPI.getOne(uuid)
        if not out or not out.get("data"):
            reason = stockXAPI.last_fetch_error or "no_data"
            if reason == "http_404":
                gone += 1
                print(f"[GONE] {row.get('urlKey') or uuid}: delisted on StockX")
            else:
                fail += 1
                print(f"[FAIL] {row.get('urlKey') or uuid}: {reason}")
            time.sleep(args.delay)
            continue

        try:
            r = requests.post(f"{args.db_api}/api/kickdb/upsert", json=out,
                              headers=_auth_headers(), timeout=60)
            if r.status_code == 200 and r.json().get("ok"):
                ok += 1
            else:
                fail += 1
                print(f"[FAIL] {uuid}: upsert {r.status_code}")
        except Exception as e:
            fail += 1
            print(f"[FAIL] {uuid}: {e}")
        time.sleep(args.delay)

    print(f"[DONE] refreshed={ok} failed={fail} delisted={gone}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
