"""
SSE listener v2 — DB buffer mode.

On each KicksDB SSE price-change event:
  1. Dedup: skip if this product UUID was fetched within --min-refetch-interval
     (default 12h — a product is never pushed to Shopify more than ~2x/day, so
     refetching more often is wasted quota).
  2. Fetch the FULL product from KicksDB (variants + prices + identifiers +
     gallery + 360) — this is the ONLY KicksDB call in the whole pipeline.
  3. POST the raw payload to the resell API /api/kickdb/upsert, which stores it
     in KickDBProduct.rawJson (single source of truth for Shopify + marketplace).

Fetch+upsert run on worker threads so the SSE stream read never blocks (event
bursts would otherwise drop the connection).

Usage:
    python3 sse_db_listener.py --topics price:stockx:ch \
        --upsert-url http://127.0.0.1:3000/api/kickdb/upsert

Env:
    KICKSDB_API_KEY         KicksDB API key
    KICKSDB_SSE_URL         SSE endpoint (default https://sse.kicks.dev/v1/stream)
    KICKSDB_SSE_TOPICS      default topics
    KICKDB_INTERNAL_TOKEN   shared secret forwarded to the upsert route
"""

import argparse
import json
import os
import queue
import sys
import threading
import time
import datetime
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
DEFAULT_SSE_URL = "https://sse.kicks.dev/v1/stream"
DEFAULT_TOPICS = os.environ.get("KICKSDB_SSE_TOPICS", "price:stockx:ch")
DEFAULT_UPSERT_URL = "http://127.0.0.1:3000/api/kickdb/upsert"
DEFAULT_REFETCH_INTERVAL = 12 * 3600  # 12h: max ~2 refreshes per product per day
DEFAULT_WORKERS = 4

LOG_FILE = BASE_DIR / "sse_db_listener.log"
LAST_EVENT_ID_FILE = BASE_DIR / "sse_db_last_event_id.txt"
UUID_CACHE_FILE = BASE_DIR / "sse_uuid_cache.jsonl"

KICKS_PRODUCT_URL = "https://api.kicks.dev/v3/stockx/products/{id}"
KICKS_DISPLAY_PARAMS = {
    "currency": "CHF",
    "market": "CH",
    "display[variants]": "true",
    "display[traits]": "true",
    "display[identifiers]": "true",
    "display[prices]": "true",
    "display[gallery]": "true",
    "display[gallery_360]": "true",
}

_cache_lock = threading.Lock()
_uuid_cache = {}  # uuid -> lastFetchTs
_stats_lock = threading.Lock()
_stats = {"events": 0, "dedup_skips": 0, "fetched": 0, "upserted": 0, "errors": 0}


def log(msg):
    ts = datetime.datetime.now().isoformat(timespec="seconds")
    line = f"[{ts}] {msg}"
    print(line, flush=True)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception:
        pass


def bump(key, n=1):
    with _stats_lock:
        _stats[key] += n


def read_last_event_id():
    try:
        return LAST_EVENT_ID_FILE.read_text(encoding="utf-8").strip()
    except Exception:
        return ""


def write_last_event_id(event_id):
    tmp = str(LAST_EVENT_ID_FILE) + ".tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as f:
            f.write(str(event_id))
        os.replace(tmp, LAST_EVENT_ID_FILE)
    except Exception:
        pass


def load_uuid_cache(min_interval):
    """Load cache and compact the file: keep only entries still inside the dedup window."""
    if not UUID_CACHE_FILE.exists():
        return
    cutoff = time.time() - min_interval
    try:
        with open(UUID_CACHE_FILE, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    obj = json.loads(line)
                except json.JSONDecodeError:
                    continue
                ts = obj.get("lastFetchTs", 0)
                if ts >= cutoff:
                    _uuid_cache[obj["uuid"]] = ts
        tmp = str(UUID_CACHE_FILE) + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            for uuid, ts in _uuid_cache.items():
                f.write(json.dumps({"uuid": uuid, "lastFetchTs": ts}) + "\n")
        os.replace(tmp, UUID_CACHE_FILE)
        log(f"uuid cache loaded: {len(_uuid_cache)} entries within {min_interval}s window")
    except Exception as e:
        log(f"cache load error: {e}")


def should_fetch(uuid, min_interval):
    with _cache_lock:
        ts = _uuid_cache.get(uuid)
        return ts is None or (time.time() - ts) >= min_interval


def mark_fetched(uuid):
    now = time.time()
    with _cache_lock:
        _uuid_cache[uuid] = now
    try:
        with open(UUID_CACHE_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({"uuid": uuid, "lastFetchTs": now}) + "\n")
    except Exception:
        pass


def fetch_full_product(uuid, api_key):
    url = KICKS_PRODUCT_URL.format(id=uuid)
    try:
        r = requests.get(url, headers={"Authorization": api_key},
                         params=KICKS_DISPLAY_PARAMS, timeout=25)
        if r.status_code == 404:
            return None, "http_404"
        if r.status_code != 200:
            return None, f"http_{r.status_code}"
        body = r.json()
        if not body or not body.get("data"):
            return None, "empty_body"
        return body, None
    except requests.Timeout:
        return None, "timeout"
    except Exception as e:
        return None, f"error:{e}"


def upsert_to_db(payload, upsert_url):
    headers = {"Content-Type": "application/json"}
    token = os.environ.get("KICKDB_INTERNAL_TOKEN", "").strip()
    if token:
        headers["x-internal-token"] = token
    try:
        r = requests.post(upsert_url, json=payload, timeout=30, headers=headers)
        if r.status_code == 200:
            return r.json().get("ok", False), None
        return False, f"http_{r.status_code}:{r.text[:200]}"
    except Exception as e:
        return False, f"error:{e}"


def worker_loop(q, api_key, upsert_url):
    while True:
        item = q.get()
        if item is None:
            q.task_done()
            return
        uuid, event_id = item
        try:
            payload, err = fetch_full_product(uuid, api_key)
            if err:
                if err == "http_404":
                    mark_fetched(uuid)  # delisted: don't retry-storm
                else:
                    bump("errors")
                    log(f"uuid={uuid} fetch error: {err}")
                continue
            bump("fetched")
            mark_fetched(uuid)
            data = payload.get("data", {})
            ok, err = upsert_to_db(payload, upsert_url)
            if ok:
                bump("upserted")
            else:
                bump("errors")
                log(f"uuid={uuid} slug={data.get('slug')} upsert FAILED: {err}")
        except Exception as e:
            bump("errors")
            log(f"uuid={uuid} worker error: {e}")
        finally:
            q.task_done()


def parse_sse_stream(response):
    event_id = ""
    event_name = ""
    data_lines = []
    for raw in response.iter_lines(decode_unicode=True):
        if raw is None:
            continue
        line = raw.rstrip("\r")
        if line == "":
            if data_lines:
                data_str = "\n".join(data_lines)
                try:
                    yield event_id, event_name, json.loads(data_str)
                except json.JSONDecodeError:
                    yield event_id, event_name, {"_raw": data_str}
            event_id = ""
            event_name = ""
            data_lines = []
            continue
        if line.startswith("id:"):
            event_id = line[3:].strip()
        elif line.startswith("event:"):
            event_name = line[6:].strip()
        elif line.startswith("data:"):
            data_lines.append(line[5:].lstrip())


def stream_once(api_key, topics, q, min_interval, last_event_id):
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Topics": topics,
        "Accept": "text/event-stream",
    }
    if last_event_id:
        headers["Last-Event-ID"] = last_event_id

    log(f"Connecting SSE: topics={topics!r} last_event_id={last_event_id!r}")
    try:
        # Read timeout generous (600s): the stream can be quiet between events;
        # a dead connection is still detected within 10 min and reconnected.
        response = requests.get(
            os.environ.get("KICKSDB_SSE_URL", DEFAULT_SSE_URL),
            headers=headers,
            stream=True,
            timeout=(30, 600),
        )
    except Exception as e:
        log(f"SSE connect error: {e}")
        return False
    if response.status_code != 200:
        log(f"SSE HTTP {response.status_code}: {response.text[:200]}")
        response.close()
        return False

    log("SSE connected. Streaming...")
    connected = True
    last_stats = time.time()
    try:
        for event_id, _event_name, data in parse_sse_stream(response):
            if event_id:
                write_last_event_id(event_id)
            uuid = (data.get("product_id") or "").strip().lower()
            if not uuid:
                continue
            bump("events")
            if should_fetch(uuid, min_interval):
                # Mark immediately so a burst of events for the same product
                # enqueues only one fetch.
                mark_fetched(uuid)
                q.put((uuid, event_id))
            else:
                bump("dedup_skips")

            if time.time() - last_stats >= 300:
                with _stats_lock:
                    snapshot = dict(_stats)
                log(f"stats: {snapshot} queue={q.qsize()}")
                last_stats = time.time()
    except Exception as e:
        # Mid-stream breaks on a quiet stream are normal (Cloudflare idle
        # timeout ~100s). A successful connect counts as OK so the reconnect
        # loop doesn't back off exponentially and miss event bursts.
        log(f"SSE stream error: {e}")
        return connected
    finally:
        response.close()
    return True


def main():
    parser = argparse.ArgumentParser(description="KicksDB SSE listener -> DB buffer")
    parser.add_argument("--topics", default=DEFAULT_TOPICS)
    parser.add_argument("--upsert-url", default=DEFAULT_UPSERT_URL)
    parser.add_argument("--min-refetch-interval", type=int, default=DEFAULT_REFETCH_INTERVAL)
    parser.add_argument("--workers", type=int, default=DEFAULT_WORKERS)
    parser.add_argument("--once", action="store_true", help="single stream attempt (no reconnect loop)")
    args = parser.parse_args()

    api_key = os.environ.get("KICKSDB_API_KEY", "").strip()
    if not api_key:
        print("KICKSDB_API_KEY env required", file=sys.stderr)
        return 2

    load_uuid_cache(args.min_refetch_interval)

    q = queue.Queue(maxsize=10000)
    for _ in range(max(1, args.workers)):
        t = threading.Thread(target=worker_loop, args=(q, api_key, args.upsert_url), daemon=True)
        t.start()

    backoff = 1
    while True:
        ok = stream_once(api_key, args.topics, q, args.min_refetch_interval, read_last_event_id())
        if args.once:
            q.join()
            with _stats_lock:
                log(f"final stats: {_stats}")
            return 0
        backoff = 1 if ok else min(backoff * 2, 300)
        log(f"reconnecting in {backoff}s")
        time.sleep(backoff)


if __name__ == "__main__":
    sys.exit(main())
