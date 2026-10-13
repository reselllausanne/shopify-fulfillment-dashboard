"""
Sweeper: refresh stale catalog products in the DB buffer.

SSE only reports price MOVEMENT. A product whose last ask expired or was
delisted emits no event and would rot at its last known price/quantity on
Shopify (overselling risk on the long tail). The sweeper closes that gap:

  Every catalog product (= has a ShopifySyncState row) whose rawFetchedAt is
  older than --max-age-days gets one KicksDB refresh by UUID (slug renames
  can't break this). The refreshed rawJson bumps rawFetchedAt, which puts the
  product back in the /api/kickdb/fresh queue for the consumer's next run.

Dead products (404, or KicksDB 500 "cannot fetch product") are reported as
notFound — which zeroes their DB stock and Shopify Website stock — only once
they failed the same way on two consecutive runs, and never on a run whose
failure rate suggests a KicksDB incident.

Sized for cron: --limit caps KicksDB calls per run.

Usage (daily cron):
    python3 sweeper_refresh_stale.py --db-api http://127.0.0.1:3000 --max-age-days 3 --limit 14000
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

DB_API_DEFAULT = os.environ.get("KICKDB_BUFFER_BASE", os.environ.get("RESELL_API_BASE", "http://127.0.0.1:3002"))
DEAD_STATE_PATH = Path(
    os.environ.get("SWEEPER_DEAD_STATE", str(Path(__file__).resolve().parent / "logs" / "sweeper_dead.json"))
)
DEAD_REASONS = {"http_404", "cannot_fetch"}
# Above this share of failed fetches the run is treated as a KicksDB incident:
# nothing is delisted and the pending dead set is kept as is.
MAX_FAIL_RATE_FOR_DELIST = float(os.environ.get("SWEEPER_MAX_FAIL_RATE_FOR_DELIST", "0.10"))


def load_dead_state():
    try:
        return set(json.loads(DEAD_STATE_PATH.read_text()).get("pending", []))
    except (OSError, ValueError):
        return set()


def save_dead_state(pending):
    DEAD_STATE_PATH.parent.mkdir(parents=True, exist_ok=True)
    DEAD_STATE_PATH.write_text(json.dumps({"pending": sorted(pending), "savedAt": time.time()}))


def report_not_found(db_api, uuid):
    r = requests.post(
        f"{db_api}/api/kickdb/upsert",
        json={"data": {"id": uuid}, "notFound": True},
        headers=_auth_headers(),
        timeout=120,
    )
    return r.status_code == 200 and r.json().get("ok")


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
    parser.add_argument("--max-age-days", type=int, default=3)
    parser.add_argument("--limit", type=int, default=14000)
    parser.add_argument("--delay", type=float, default=0.35)
    args = parser.parse_args()

    stale = fetch_stale(args.db_api, args.max_age_days, args.limit)
    print(f"[INFO] {len(stale)} stale catalog products (older than {args.max_age_days}d)")

    ok = fail = 0
    dead_now = set()
    for row in stale:
        uuid = row.get("kickdbProductId")
        out = stockXAPI.getOne(uuid)
        if not out or not out.get("data"):
            reason = stockXAPI.last_fetch_error or "no_data"
            if reason in DEAD_REASONS and uuid:
                dead_now.add(uuid)
                print(f"[DEAD?] {row.get('urlKey') or uuid}: {reason}")
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

    attempted = len(stale)
    fail_rate = (fail + len(dead_now)) / attempted if attempted else 0.0
    delisted = 0
    if attempted >= 100 and fail_rate > MAX_FAIL_RATE_FOR_DELIST:
        print(
            f"[WARN] fail rate {fail_rate:.1%} > {MAX_FAIL_RATE_FOR_DELIST:.0%}: "
            f"suspected KicksDB incident, delisting skipped ({len(dead_now)} dead candidates)"
        )
    else:
        pending = load_dead_state()
        confirmed = dead_now & pending
        for uuid in sorted(confirmed):
            try:
                if report_not_found(args.db_api, uuid):
                    delisted += 1
                    print(f"[GONE] {uuid}: dead on two consecutive runs → notFound")
                else:
                    print(f"[FAIL] {uuid}: notFound report rejected")
            except Exception as e:
                print(f"[FAIL] {uuid}: notFound report {e}")
        save_dead_state(dead_now - confirmed)

    print(
        f"[DONE] refreshed={ok} failed={fail} dead_candidates={len(dead_now)} "
        f"delisted={delisted} fail_rate={fail_rate:.1%}"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
