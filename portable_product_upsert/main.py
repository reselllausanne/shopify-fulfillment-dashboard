import math
import re
import threading
import concurrent.futures
import json
import os
import datetime
import argparse
import sys
import time
import random
from decimal import Decimal, ROUND_HALF_UP
from shopifyAPI_GQL import (
    get_all_products,
    get_product_by_handle,
    find_product_by_stockx_slug,
    sync_product_handle_to_stockx_slug,
    create_product,
    create_variants_bulk,
    add_images_to_product,
    get_product_media_images,
    get_product_variants,
    calc_touch_price,
    calc_sell_price,
    update_variants_bulk,
    get_first_option_id_of_product,
    set_product_metafield,
    extract_product_attributes,
    set_product_metafields,
    set_standard_metafields,
    set_standard_metafields_v2,
    set_required_product_metafields,
    set_variant_structured_metafields,
    derive_taxonomy_category,
    is_basketball_shoe_product,
    sync_basketball_shoe_taxonomy,
    set_variant_express_price_metafields,
    get_taxonomy_category_id,
    get_category_attributes,
    map_stockx_to_shopify_category,
    update_product_description,
    update_product_title,
    publish_product_to_channels,
    sync_product_listing_enrichment,
    get_all_publications,
    inventory_set_quantities_bulk,
    get_first_location_id,
    delete_variants_bulk,
    delete_product_media,
    RateLimitException,
    _run_query
)
location_id = get_first_location_id()

import stockXAPI
from stockx_images import (
    list_all_gallery_360_urls,
    select_stockx_product_images,
    urls_to_add_for_gallery_sync,
    should_auto_rebuild_product_images,
)

# Set True via --full-360 CLI flag (all gallery_360 frames instead of 5 orbit picks).
# Also honors env SHOPIFY_CREATE_FULL_360=1 (used by scan create via
# createProductFullFlow) so scan-created products get the full StockX 360 strip.
FULL_360_MODE = os.environ.get("SHOPIFY_CREATE_FULL_360", "0").strip() in (
    "1",
    "true",
    "yes",
    "on",
)
# On create: how many images to upload from the curated selection.
# select_stockx_product_images already returns <=5. Default 5 (was 1: hero-only).
# Override via env SHOPIFY_CREATE_IMAGES_MAX. --full-360 still uploads everything.
try:
    CREATE_IMAGES_MAX = max(1, int(os.environ.get("SHOPIFY_CREATE_IMAGES_MAX", "5")))
except Exception:
    CREATE_IMAGES_MAX = 5
# Set True via --full-pass: force SEO/alt refresh + 360 images (categories never change on update).
FULL_PASS_MODE = False
# Set True via --no-new-variants: skip creating missing sizes (quota saver). Default: create new
# available sizes; sold-out / gone sizes stay on Shopify with qty=0 (never deleted).
NO_NEW_VARIANTS_MODE = False
# Optional ingestion modules - comment out if not available
# from ingestion.normalize import normalize_vendor_product
# from ingestion.graphql import build_product_create_mutation

# Force immediate flushing of print statements (for debugging)
sys.stdout.reconfigure(line_buffering=True)

# ----------------------------------------------------------------------------
# ENHANCED SHOPIFY PROCESSING WITH 429 HANDLING AND PARTIALS
# 
# PROCESSING ORDER:
# 1. On start, process partials_create.jsonl first (finish incomplete creates)
# 2. Then process partials_update.jsonl (finish incomplete updates)
# 3. Then alternate 1:1 between create_list.txt and update_list.txt
#    (one create URL, then one update URL, repeat until first 429)
#
# LISTS LOCATION:
# - create_list.txt: ~10k product source URLs for creation
# - update_list.txt: manually curated product URLs for update
# - created_urls.txt: append-only log of fully created URLs
#
# PARTIALS RESUME:
# When restarting (after 429 or crash), always process partials first:
# partials_create.jsonl → partials_update.jsonl → alternating create/update
# Once a partial is completed, it's removed from the partial file
#
# 429 HANDLING:
# When Shopify returns 429, save current state to partials, sleep 24h, 
# then auto-restart picking up where left off (no daily timers/counters)
#
# FUTURE FEATURE: 429 FALLBACK TO UPDATE-ONLY MODE
# TODO: Implement automatic fallback when variant creation limit is hit:
# 1. When "Daily variant creation limit reached" 429 is detected:
#    - Save current create state to partials_create.jsonl
#    - Switch to UPDATE-ONLY mode automatically
#    - Create/use special folder: update_fallback_list.txt (or similar)
#    - Process known existing products from this list
# 2. Continue updating products until update limit is also hit
# 3. When update limit 429 is detected ("Daily product update limit" or similar):
#    - Save update state to partials_update.jsonl
#    - Enter 24h sleep mode
# 4. 429 ERROR RECOGNITION:
#    - Parse error message text to distinguish:
#      * "Daily variant creation limit" → switch to update-only mode
#      * "Daily product update limit" / "Daily update limit" → enter sleep mode
#      * Generic 429 → check context (was it create or update?) to decide
# 5. On restart after 24h, resume normal create/update alternating mode
#
# VARIANT FILTERS:
# - Skip variants with price = 0 (saves variant budget)
# - Skip variants with quantity = 0 on create (defer to future update)
# - Remove variants containing "express/fast delivery" keywords
# - If no valid variants remain after filtering, skip entire product
#
# FILES USED:
# created_urls.txt, partials_create.jsonl, partials_update.jsonl, logs.jsonl
# update_list.cursor — next 0-based line in update_list.txt to treat as "resume point" (see Phase 3)
# All files are human-readable text/JSON for easy inspection
# ----------------------------------------------------------------------------

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
LOGS_JSONL = os.path.join(BASE_DIR, "logs.jsonl")
UPDATE_LIST_FILE = os.path.join(BASE_DIR, "update_list.txt")
UPDATE_LIST_CURSOR_FILE = os.path.join(BASE_DIR, "update_list.cursor")

# SSE-driven update queue (populated by sse_listener.py). One slug per line, deduped.
# When --sse-queue is passed, Phase 3 reads from this file instead of update_list.txt.
SSE_QUEUE_FILE = os.path.join(BASE_DIR, "sse_changed_queue.txt")
SSE_LAST_EVENT_ID_FILE = os.path.join(BASE_DIR, "sse_last_event_id.txt")


def read_url_file_cursor(cursor_path, list_len):
    """Next 0-based line index (or list_len when file fully processed)."""
    if list_len <= 0:
        return 0
    try:
        with open(cursor_path, "r", encoding="utf-8") as f:
            v = int(f.read().strip())
    except (FileNotFoundError, ValueError):
        v = 0
    if v >= list_len:
        return list_len
    return max(0, min(v, list_len - 1))


def write_url_file_cursor(cursor_path, next_index):
    """Atomically persist next line index (0-based; list_len = done)."""
    tmp = cursor_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(str(int(next_index)))
    os.replace(tmp, cursor_path)


def read_update_list_cursor(list_len):
    """Next 0-based line index to process in update_list.txt (persisted across restarts)."""
    return read_url_file_cursor(UPDATE_LIST_CURSOR_FILE, list_len)


def write_update_list_cursor(next_index):
    """Atomically persist next update_list line index (0-based)."""
    write_url_file_cursor(UPDATE_LIST_CURSOR_FILE, next_index)


def bulk_url_cursor_path(filepath):
    return filepath + ".cursor"


def read_bulk_url_cursor(filepath, list_len):
    return read_url_file_cursor(bulk_url_cursor_path(filepath), list_len)


def write_bulk_url_cursor(filepath, next_index):
    write_url_file_cursor(bulk_url_cursor_path(filepath), next_index)

# Helper constants for filtering fast delivery variants
FAST_DELIVERY_KEYWORDS = ["express", "fast delivery", "fast shipping", "fast", "expedited", "next day", "24h", "same day", "priority"]

def is_fast_delivery(text):
    """Check if variant title contains fast delivery keywords (case-insensitive)"""
    if not text:
        return False
    text_lower = str(text).lower()
    return any(keyword in text_lower for keyword in FAST_DELIVERY_KEYWORDS)

def filter_variants(variants, for_create=False):
    """Filter invalid variants. On create: drop zero qty/price. On update: keep sold-out (qty=0) for inventory sync."""
    filtered = []
    for variant in variants:
        # Check for fast delivery keywords in title/name
        title = variant.get("title") or variant.get("name") or variant.get("size") or ""
        if is_fast_delivery(title):
            continue

        qty = int(variant.get("quantity") or variant.get("inventory_quantity") or 0)
        price_raw = variant.get("price")
        price = float(price_raw) if price_raw is not None else 0.0

        # Sold-out rows from StockX (no asks / asks<2): keep on update so inventory can go to 0.
        if not for_create and (qty <= 0 or variant.get("sold_out")):
            filtered.append(variant)
            continue

        if price <= 0:
            continue
        if qty <= 0:
            continue

        filtered.append(variant)
    return filtered

def backoff_sleep(attempt, retry_after=None):
    """Sleep with exponential backoff or use Shopify's Retry-After header"""
    import time, random
    if retry_after:
        try:
            wait = float(retry_after)
            print(f"[INFO] Using Shopify Retry-After: {wait} seconds")
        except:
            wait = 24 * 60 * 60  # Default to 24 hours for 429
    else:
        # For 429, default to 24 hours + some jitter
        wait = 24 * 60 * 60 + random.uniform(0, 300)  # 24h + up to 5min jitter
    
    print(f"[INFO] Sleeping for {wait/3600:.1f} hours due to rate limit...")
    time.sleep(max(0, wait))

def append_jsonl(path, obj):
    """Append a JSON line to file efficiently"""
    import json
    # FIX 6: Simple append is O(1) and sufficient for single-process usage
    with open(path, "a", encoding="utf-8") as f:
        f.write(json.dumps(obj, ensure_ascii=False) + "\n")
        f.flush()

def remove_jsonl_by_url(path, url):
    """Remove a JSON line by URL from file atomically"""
    import json, os
    if not os.path.exists(path):
        return
    
    remaining_lines = []
    with open(path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                obj = json.loads(line)
                if obj.get("url") != url:
                    remaining_lines.append(line)
            except json.JSONDecodeError:
                # Keep malformed lines
                remaining_lines.append(line)
    
    tmp_path = path + ".tmp"
    with open(tmp_path, "w", encoding="utf-8") as f:
        for line in remaining_lines:
            f.write(line + "\n")
    
    os.replace(tmp_path, path)

def log_event(url, action, status, reason=None, attempt=1, retry_after=None, pending_skus=None, completed_skus=None, shopify_response=None, api_status_code=None, title=None, details=None):
    """Log an event to logs.jsonl with full Shopify API response details for 429 verification"""
    import datetime
    
    event = {
        "ts": datetime.datetime.now().isoformat(),
        "url": url,
        "action": action,
        "status": status,
        "attempt": attempt
    }
    
    if title:
        event["title"] = title
    if reason:
        event["reason"] = reason
    if retry_after:
        event["retry_after"] = retry_after
    if pending_skus:
        event["pending_skus"] = pending_skus
    if completed_skus:
        event["completed_skus"] = completed_skus
    if details:
        event["details"] = details
    
    # CRITICAL: Log exact Shopify API response for 429 verification
    if status == "429":
        event["verification"] = "REAL_429_FROM_SHOPIFY_API"
        if shopify_response:
            event["shopify_api_response"] = shopify_response
        if api_status_code:
            event["shopify_status_code"] = api_status_code
        print(f"[CRITICAL] 429 RATE LIMIT DETECTED AND LOGGED")
        print(f"[CRITICAL] This is a REAL 429 from Shopify API, not a manual print")
        print(f"[CRITICAL] Status Code: {api_status_code}")
        print(f"[CRITICAL] Full Response: {shopify_response}")
    
    append_jsonl(LOGS_JSONL, event)


def write_pass_report():
    """Snapshot ok/skipped/error counts for dashboard after a bulk pass."""
    import datetime
    from collections import Counter

    logdir = os.path.join(BASE_DIR, "logs")
    os.makedirs(logdir, exist_ok=True)
    stamp_path = os.path.join(logdir, ".last_price_update_start_unix")
    report_path = os.path.join(logdir, "pass_report.json")

    start_iso = None
    if os.path.isfile(stamp_path):
        try:
            ts = int(open(stamp_path, encoding="utf-8").read().strip())
            start_iso = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S")
        except (ValueError, OSError):
            pass
    if not start_iso:
        start_iso = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT") + "00:00:00"

    counts = Counter()
    skip_reasons = Counter()
    sample_issues = []
    if os.path.isfile(LOGS_JSONL):
        with open(LOGS_JSONL, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    e = json.loads(line)
                except json.JSONDecodeError:
                    continue
                if e.get("ts", "") < start_iso:
                    continue
                if e.get("action") not in ("update", "priority", "resume_partial"):
                    continue
                status = e.get("status", "")
                if status == "started":
                    continue
                counts[status] += 1
                if status in ("error", "skipped", "429", "deferred") and len(sample_issues) < 25:
                    sample_issues.append({
                        "url": e.get("url", ""),
                        "status": status,
                        "reason": e.get("reason", ""),
                    })
                    if status == "skipped" and e.get("reason"):
                        skip_reasons[e["reason"]] += 1

    errors_lines = 0
    if os.path.isfile("errors_url.txt"):
        with open("errors_url.txt", encoding="utf-8") as f:
            errors_lines = sum(1 for ln in f if ln.strip())

    report = {
        "pass_started": start_iso,
        "pass_finished": datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%S"),
        "counts": {
            "ok": counts.get("ok", 0),
            "skipped": counts.get("skipped", 0),
            "error": counts.get("error", 0),
            "429": counts.get("429", 0),
            "deferred": counts.get("deferred", 0),
        },
        "skip_reasons": dict(skip_reasons.most_common(10)),
        "sample_issues": sample_issues,
        "errors_file_lines": errors_lines,
    }
    tmp = report_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2)
    os.replace(tmp, report_path)
    print(f"[INFO] Pass report: ok={report['counts']['ok']} skipped={report['counts']['skipped']} error={report['counts']['error']}")
    return report

    """Append URL to created_urls.txt atomically"""
    tmp_path = "created_urls.txt.tmp"
    
    # Read existing URLs
    existing_urls = []
    if os.path.exists("created_urls.txt"):
        with open("created_urls.txt", "r", encoding="utf-8") as f:
            existing_urls = f.readlines()
    
    # Write all URLs + new one to temp file
    with open(tmp_path, "w", encoding="utf-8") as f:
        for url_line in existing_urls:
            f.write(url_line)
        f.write(url.strip() + "\n")
    
    # Atomic replace
    os.replace(tmp_path, "created_urls.txt")

SKIPPED_URLS_FILE = "skipped_urls.txt"


def _append_url_line(target, url, reason):
    """Append one URL line to target file atomically (dedupe by URL slug)."""
    url = (url or "").strip()
    if not url:
        return
    line = f"{url} # {reason}\n"
    existing_urls = []
    if os.path.exists(target):
        with open(target, "r", encoding="utf-8") as f:
            existing_urls = f.readlines()
    slug_key = url.split("#")[0].strip().lower()
    if any(l.split("#")[0].strip().lower() == slug_key for l in existing_urls):
        return
    tmp_path = target + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            for url_line in existing_urls:
                f.write(url_line)
            f.write(line)
        os.replace(tmp_path, target)
    except Exception as e:
        print(f"[WARNING] append to {target} failed ({e}); direct append")
        try:
            with open(target, "a", encoding="utf-8") as f:
                f.write(line)
        except Exception:
            pass


def append_skipped_url(url, reason="retry_later"):
    """Append retryable URL to skipped_urls.txt (StockX timeout, transient no_data)."""
    _append_url_line(SKIPPED_URLS_FILE, url, reason)
    print(f"[INFO] Appended to {SKIPPED_URLS_FILE}: {url} ({reason})")


def append_error_url(url, reason="unknown_error"):
    """Append URL to errors_url.txt atomically with reason"""
    _append_url_line("errors_url.txt", url, reason)


def append_created_url(url):
    """Append completed URL slug to created_urls.txt (deduped, no reason suffix)."""
    url = (url or "").strip()
    if not url:
        return
    target = "created_urls.txt"
    existing = []
    if os.path.exists(target):
        with open(target, "r", encoding="utf-8") as f:
            existing = [ln.strip() for ln in f if ln.strip()]
    slug_key = url.split("#")[0].strip().lower()
    if any(ln.split("#")[0].strip().lower() == slug_key for ln in existing):
        return
    tmp_path = target + ".tmp"
    try:
        with open(tmp_path, "w", encoding="utf-8") as f:
            for ln in existing:
                f.write(ln + "\n")
            f.write(url + "\n")
        os.replace(tmp_path, target)
    except Exception as e:
        print(f"[WARNING] append to {target} failed ({e}); direct append")
        try:
            with open(target, "a", encoding="utf-8") as f:
                f.write(url + "\n")
        except Exception:
            pass

def remove_url_from_create_list(url):
    """Remove URL from create_list.txt atomically"""
    tmp_path = "create_list.txt.tmp"
    
    # Read existing URLs
    existing_urls = []
    if os.path.exists("create_list.txt"):
        with open("create_list.txt", "r", encoding="utf-8") as f:
            existing_urls = [line.strip() for line in f if line.strip()]
    
    # Filter out the URL
    filtered_urls = [u for u in existing_urls if u != url.strip()]
    
    # Write filtered URLs to temp file
    with open(tmp_path, "w", encoding="utf-8") as f:
        for url_line in filtered_urls:
            f.write(url_line + "\n")
    
    # Atomic replace
    os.replace(tmp_path, "create_list.txt")

def remove_url_from_all_lists(url):
    """Remove URL from all processing lists atomically (create, update, priority, created)"""
    lists_to_clean = [
        "create_list.txt",
        "update_list.txt", 
        "priority_list.txt",
        "created_urls.txt"  # Also remove from created to allow re-processing if manually fixed
    ]
    
    cleaned_count = 0
    for list_file in lists_to_clean:
        if not os.path.exists(list_file):
            continue
            
        # Read existing URLs
        try:
            with open(list_file, "r", encoding="utf-8") as f:
                existing_urls = [line.strip() for line in f if line.strip()]
            
            # Filter out the URL
            filtered_urls = [u for u in existing_urls if u != url.strip()]
            
            # Only write if something changed
            if len(filtered_urls) < len(existing_urls):
                tmp_path = f"{list_file}.tmp"
                with open(tmp_path, "w", encoding="utf-8") as f:
                    for url_line in filtered_urls:
                        f.write(url_line + "\n")
                os.replace(tmp_path, list_file)
                cleaned_count += 1
                print(f"[CLEANUP] Removed {url} from {list_file}")
        except Exception as e:
            print(f"[WARNING] Failed to clean {list_file}: {e}")
    
    if cleaned_count > 0:
        print(f"[CLEANUP] Removed {url} from {cleaned_count} list(s)")
    return cleaned_count

def read_url_list(filename):
    """Read URLs from a file, return empty list if file doesn't exist"""
    if not os.path.exists(filename):
        return []
    with open(filename, "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]

def write_url_list(filename, urls):
    """Write URLs to a file atomically"""
    import tempfile
    tmp_file = filename + ".tmp"
    with open(tmp_file, "w", encoding="utf-8") as f:
        for url in urls:
            if url.strip():
                f.write(url.strip() + "\n")
    os.replace(tmp_file, filename)

def bulk_url_file_generator(filepath, start_url=None):
    """Single pass: yield (url, 'update', line_index) for each non-empty line. No recycle."""
    urls = read_url_list(filepath)
    n = len(urls)
    print(f"[INFO] Bulk URL file: {filepath} ({n} lines)")
    if n == 0:
        return
    start = read_bulk_url_cursor(filepath, n)
    if start >= n:
        print(f"[INFO] Bulk URL file already complete (cursor {start} >= {n})")
        return
    if start == 0 and start_url:
        if start_url not in urls:
            print(f"[WARNING] --start-url {start_url!r} not in file; processing from line 0")
        else:
            start = urls.index(start_url)
            write_bulk_url_cursor(filepath, start)
            print(f"[INFO] --start-url: resuming from index {start} ({start_url!r})")
    elif start > 0:
        print(f"[INFO] Bulk URL file: resuming at index {start} of {n} ({filepath}.cursor)")
    for i in range(start, n):
        yield urls[i], "update", i


def update_list_single_pass_generator():
    """One linear pass over update_list.txt from resume cursor through last line, then stop."""
    urls = read_url_list(UPDATE_LIST_FILE)
    if not urls:
        print("[INFO] --update-list-once: update list is empty, nothing to do")
        return
    n = len(urls)
    start = read_update_list_cursor(n)
    if start >= n:
        print(f"[INFO] --update-list-once: already complete (cursor {start} >= {n})")
        return
    if start > 0:
        print(f"[INFO] --update-list-once: {n} URLs; resuming at index {start} (0-based) through end, then exit")
    else:
        print(f"[INFO] --update-list-once: {n} URLs; one pass top→bottom then exit (no infinite recycle)")
    for i in range(start, n):
        yield urls[i], "update", i


def read_sse_queue():
    """Read deduped slugs from sse_changed_queue.txt (one slug per line)."""
    if not os.path.exists(SSE_QUEUE_FILE):
        return []
    seen = set()
    out = []
    with open(SSE_QUEUE_FILE, "r", encoding="utf-8") as f:
        for line in f:
            slug = line.strip().lower()
            if slug and slug not in seen:
                seen.add(slug)
                out.append(slug)
    return out


def remove_slug_from_sse_queue(slug):
    """Remove all occurrences of slug from sse_changed_queue.txt (atomic)."""
    slug = (slug or "").strip().lower()
    if not slug or not os.path.exists(SSE_QUEUE_FILE):
        return 0
    kept = []
    removed = 0
    with open(SSE_QUEUE_FILE, "r", encoding="utf-8") as f:
        for line in f:
            s = line.strip().lower()
            if s == slug:
                removed += 1
            elif s:
                kept.append(s)
    tmp = SSE_QUEUE_FILE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        for s in kept:
            f.write(s + "\n")
    os.replace(tmp, SSE_QUEUE_FILE)
    return removed


def sse_queue_generator():
    """Single pass over sse_changed_queue.txt. Yields (slug, 'update', i).

    Each slug is removed from the queue after a successful update (see success hook
    in run_processing_enhanced). On failure, slug stays in queue for next run.
    """
    slugs = read_sse_queue()
    n = len(slugs)
    if n == 0:
        print("[INFO] --sse-queue: queue is empty (sse_changed_queue.txt missing or empty). Nothing to do.")
        return
    print(f"[INFO] --sse-queue: {n} changed slugs queued from SSE listener. Single pass.")
    for i, slug in enumerate(slugs):
        yield slug, "update", i


def start_sse_listener_thread(topics=None, api_key=None):
    """Spawn sse_listener.py as a background daemon thread (in-process).

    Returns (thread, stop_event). The thread runs run_loop() from sse_listener.
    On auth failure (HTTP 401/403) it exits and logs a warning.
    """
    try:
        import sse_listener as sse_mod
    except Exception as e:
        print(f"[ERROR] Could not import sse_listener module: {e}")
        return None, None

    stop_event = threading.Event()

    def _run():
        try:
            sse_mod.run_loop(api_key or sse_mod.DEFAULT_API_KEY,
                             topics or sse_mod.DEFAULT_TOPICS,
                             once=False,
                             max_retries=None)
        except Exception as e:
            print(f"[ERROR] SSE listener thread crashed: {e}")

    t = threading.Thread(target=_run, name="kicksdb-sse-listener", daemon=True)
    t.start()
    print(f"[INFO] SSE listener thread started (topics={topics or sse_mod.DEFAULT_TOPICS!r})")
    return t, stop_event


def alternating_url_generator():
    """Generator that alternates between create and update URLs, then loops indefinitely on updates.

    Yields (url, action_type, update_index) where update_index is None for creates, else 0-based
    index into update_list.txt for this update (used to resume update_list.cursor across restarts).
    """
    create_urls = read_url_list("create_list.txt")  # Main create URLs list
    update_urls = read_url_list(UPDATE_LIST_FILE)  # Manually curated update URLs
    
    # Filter out already created URLs from create list
    created_urls = set()
    if os.path.exists("created_urls.txt"):
        with open("created_urls.txt", "r", encoding="utf-8") as f:
            created_urls = {line.strip() for line in f if line.strip()}
    
    # Remove already created URLs from create list
    create_urls = [url for url in create_urls if url not in created_urls]
    
    # If no update URLs, just process create URLs sequentially
    if not update_urls:
        print(f"[INFO] No update URLs available. Processing {len(create_urls)} create URLs sequentially...")
        for url in create_urls:
            yield url, "create", None
        print("[INFO] All create URLs processed. Waiting 5 minutes before checking for new URLs...")
        while True:
            time.sleep(300)  # Wait 5 minutes
            # Re-read both lists in case new URLs were added
            create_urls = read_url_list("create_list.txt")
            update_urls = read_url_list(UPDATE_LIST_FILE)
            # Filter out already created URLs
            created_urls = set()
            if os.path.exists("created_urls.txt"):
                with open("created_urls.txt", "r", encoding="utf-8") as f:
                    created_urls = {line.strip() for line in f if line.strip()}
            create_urls = [url for url in create_urls if url not in created_urls]
            if create_urls:
                print(f"[INFO] Found {len(create_urls)} new create URLs. Processing...")
                for url in create_urls:
                    yield url, "create", None
                print("[INFO] All create URLs processed. Waiting 5 minutes...")
            elif update_urls:
                print(f"[INFO] Found {len(update_urls)} update URLs. Switching to alternating mode...")
                break
            else:
                print("[INFO] No new URLs found. Waiting 5 minutes...")
    
    start_idx = read_update_list_cursor(len(update_urls))
    update_pos = [start_idx]

    def take_update():
        if not update_urls:
            return None
        n = len(update_urls)
        pos = update_pos[0]
        if pos >= n:
            pos = 0
        url = update_urls[pos]
        idx = pos
        update_pos[0] = pos + 1
        return url, idx

    create_iter = iter(create_urls)
    use_create = True
    create_exhausted = False

    while True:
        got_url = False

        # Phase 1: Alternate between create and update until create list is exhausted
        if not create_exhausted:
            if use_create:
                try:
                    yield next(create_iter), "create", None
                    got_url = True
                except StopIteration:
                    create_exhausted = True
                    print("[INFO] Create list exhausted - switching to update-only mode")
            else:
                u = take_update()
                if u is None:
                    if create_exhausted:
                        print("[WARNING] No update URLs available and create list exhausted. Waiting...")
                        time.sleep(60)
                        continue
                else:
                    url, idx = u
                    yield url, "update", idx
                    got_url = True

        # Phase 2: Create list exhausted - loop indefinitely on updates only
        if create_exhausted:
            u = take_update()
            if u is not None:
                url, idx = u
                yield url, "update", idx
                got_url = True
            else:
                print("[INFO] No update URLs available. Waiting 5 minutes before checking again...")
                time.sleep(300)
                update_urls = read_url_list(UPDATE_LIST_FILE)
                if update_urls:
                    update_pos[0] = min(update_pos[0], len(update_urls) - 1)
                continue

        # If we didn't get a URL and create is not exhausted, try the other side
        if not got_url and not create_exhausted:
            if use_create:
                u = take_update()
                if u is not None:
                    url, idx = u
                    yield url, "update", idx
                    got_url = True
            else:
                try:
                    yield next(create_iter), "create", None
                    got_url = True
                except StopIteration:
                    create_exhausted = True
                    print("[INFO] Create list exhausted - switching to update-only mode")

        # Toggle between create and update (only when create is not exhausted)
        if not create_exhausted:
            use_create = not use_create

def load_partials(filename):
    """Load partial entries from a JSONL file"""
    import json
    if not os.path.exists(filename):
        return []
    
    partials = []
    with open(filename, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    partials.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return partials

def normalize_title_for_matching(title):
    """Normalize title for better matching between StockX and Shopify"""
    import re
    if not title:
        return ""
    
    # Convert to lowercase
    normalized = title.lower().strip()
    
    # Replace common variations
    normalized = re.sub(r'[^\w\s]', ' ', normalized)  # Remove special chars
    normalized = re.sub(r'\s+', ' ', normalized)       # Multiple spaces -> single space
    normalized = normalized.strip()
    
    # CRITICAL: Do NOT remove gender/age differentiators - these are essential for product identity
    # Only remove truly generic words that don't affect product identity
    common_words = ['retro', 'og', 'sp']  # Removed gender/age words - they're critical!
    words = normalized.split()
    filtered_words = [w for w in words if w not in common_words]
    
    return ' '.join(filtered_words)

def title_similarity_score(title1, title2):
    """Calculate similarity score between two titles"""
    norm1 = normalize_title_for_matching(title1)
    norm2 = normalize_title_for_matching(title2)
    
    if not norm1 or not norm2:
        return 0
    
    # Exact match
    if norm1 == norm2:
        return 100
    
    # Check if one contains the other (useful for variants like "Jordan 1" vs "Air Jordan 1")
    if norm1 in norm2 or norm2 in norm1:
        return 80
    
    # Word-based similarity
    words1 = set(norm1.split())
    words2 = set(norm2.split())
    
    if not words1 or not words2:
        return 0
    
    intersection = words1.intersection(words2)
    union = words1.union(words2)
    
    similarity = (len(intersection) / len(union)) * 100
    
    # Bonus if key identifying words match
    key_words = ['jordan', 'nike', 'adidas', 'yeezy', 'balance', 'converse', 'vans', 'asics']
    for word in key_words:
        if word in words1 and word in words2:
            similarity += 10
            break
    
    return min(similarity, 100)

def find_existing_product(title, product_info, shopify_products, source_slug=None):
    """Match existing Shopify product by title, StockX slug, or legacy handle aliases."""
    print(f"[DEBUG] Looking for existing product: '{title}'")
    
    if product_info is None:
        print(f"[DEBUG] product_info is None, skipping matching")
        return None
    
    normalized_title = title.strip().lower()
    for p in shopify_products:
        if p.get("title") and p["title"].strip().lower() == normalized_title:
            print(f"[DEBUG] Found EXACT title match: '{p['title']}'")
            return p
    
    stockx_slug = (product_info.get("slug") or source_slug or product_info.get("handle") or "").strip().lower()
    if not stockx_slug and product_info.get("source_url"):
        try:
            stockx_slug = product_info["source_url"].strip().split("/")[-1].split("?")[0].lower()
        except Exception:
            pass

    if stockx_slug:
        by_slug, via = find_product_by_stockx_slug(stockx_slug, title=title)
        if by_slug:
            old_handle = by_slug.get("handle")
            print(f"[DEBUG] Found product via {via}: '{by_slug.get('title')}' (handle={old_handle})")
            return sync_product_handle_to_stockx_slug(by_slug, stockx_slug)

    handle = (product_info.get("handle") or "").strip()
    if handle and handle != stockx_slug:
        try:
            by_handle = get_product_by_handle(handle)
            if by_handle:
                print(f"[DEBUG] Found product by EXACT handle '{handle}': {by_handle.get('title')}")
                return by_handle
        except Exception as e:
            print(f"[DEBUG] productByHandle lookup failed for '{handle}': {e}")
    
    print(f"[DEBUG] No match found for: '{title}' (slug={stockx_slug!r})")
    return None

def process_partial_product(url, product_id, pending_skus, completed_skus, action_type, shopify_products):
    """Process a partially completed product (create or update)"""
    print(f"[INFO] Processing partial {action_type} for {url}, pending SKUs: {pending_skus}")
    
    try:
        # Fetch fresh product data from StockX
        product_data = process_url(url, 0)
        if not product_data:
            print(f"[ERROR] Could not fetch fresh data for {url}")
            return False
        
        # Find the product in our data
        title = None
        product_info = None
        for t, info in product_data.items():
            title = t
            product_info = info
            break
            
        if not product_info:
            print(f"[ERROR] No product data found for {url}")
            return False
            
        # Filter variants to only process pending ones
        pending_variants = [v for v in product_info["variants"] if v["sku"] in pending_skus]
        
        if action_type == "create":
            # Continue creating variants for existing product
            if pending_variants:
                option_id = get_first_option_id_of_product(product_id)
                if option_id:
                    create_response = create_variants_bulk(product_id, option_id, pending_variants)
                    print(f"[INFO] Created {len(pending_variants)} pending variants")

                    # FIX 2: Publish after resuming partial create (was missing)
                    try:
                        publish_product_to_channels(product_id)
                        print(f"[INFO] Published product after completing partial create (ID: {product_id})")
                    except Exception as e:
                        print(f"[WARNING] Failed to publish after partial create: {e}")

                    return True
        else:
            # Continue updating variants for existing product
            if pending_variants:
                # Similar to update logic but only for pending variants
                product_variants = get_product_variants(product_id)
                variants_to_update = []
                variants_to_create = []
                
                for variant in pending_variants:
                    size_title = variant["size"]
                    new_price = variant["price"]
                    matched_variant = next((v for v in product_variants if v["title"] == size_title), None)
                    if matched_variant:
                        variants_to_update.append({
                            "id": matched_variant["id"],
                            "price": str(new_price),
                            "quantity": variant["quantity"],
                            "inventoryItem": {"cost": str(float(new_price) * 0.80)}
                        })
                    else:
                        if NO_NEW_VARIANTS_MODE:
                            print(f"[SKIP NEW VARIANT] partial update {size_title} (--no-new-variants)")
                            continue
                        variants_to_create.append(variant)
                
                if variants_to_update:
                    update_variants_bulk(product_id, variants_to_update)
                if variants_to_create and not NO_NEW_VARIANTS_MODE:
                    option_id = get_first_option_id_of_product(product_id)
                    if option_id:
                        create_variants_bulk(product_id, option_id, variants_to_create)
                
                print(f"[INFO] Updated {len(variants_to_update)} and created {len(variants_to_create)} pending variants")
                return True
                
    except RateLimitException:
        raise  # Re-raise rate limit errors to be handled by caller
    except Exception as e:
        print(f"[ERROR] Failed to process partial {action_type} for {url}: {e}")
        return False
    
    return True

def append_deferred_create(url):
    """Append URL to deferred_creates.txt (creates that hit variant creation limit)"""
    with open("deferred_creates.txt", "a", encoding="utf-8") as f:
        f.write(url + "\n")

def read_deferred_creates():
    """Read deferred creates that hit variant creation limit"""
    if not os.path.exists("deferred_creates.txt"):
        return []
    with open("deferred_creates.txt", "r", encoding="utf-8") as f:
        return [line.strip() for line in f if line.strip()]

def remove_deferred_create(url):
    """Remove URL from deferred_creates.txt"""
    if not os.path.exists("deferred_creates.txt"):
        return
    remaining = [u for u in read_deferred_creates() if u != url]
    with open("deferred_creates.txt", "w", encoding="utf-8") as f:
        for u in remaining:
            f.write(u + "\n")

def is_variant_creation_limit(error):
    """Check if error is specifically variant creation limit (not general 429)"""
    error_str = str(error).lower()
    return "variant creation limit" in error_str or "daily limit" in error_str or "daily variant" in error_str

def updates_only_generator():
    """Generator that only yields update URLs (for when creation limit is hit).

    Yields (url, 'update', update_index). First pass starts at update_list.cursor; later passes start at 0.
    """
    print("[INFO] 📝 Updates-only mode: Skipping all creates, processing updates only")
    lap = 0
    while True:
        update_urls = read_url_list(UPDATE_LIST_FILE)
        if not update_urls:
            print("[INFO] No update URLs available. Waiting...")
            time.sleep(60)
            continue
        n = len(update_urls)
        pos = read_update_list_cursor(n) if lap == 0 else 0
        while pos < n:
            yield update_urls[pos], "update", pos
            pos += 1
        lap += 1

def process_single_url_enhanced(url, action_type, shopify_products, skip_creates_on_limit=False, prefetched=None):
    """Process a single URL for create or update with enhanced error handling
    
    Args:
        skip_creates_on_limit: If True and creation limit is hit, defer the URL instead of raising
        prefetched: optional raw KicksDB product record (DB buffer rawJson); skips the KicksDB fetch
    """
    try:
        # Fetch and process the product data
        product_data = process_url(url, 0, prefetched=prefetched)
        if not product_data:
            fetch_err = stockXAPI.last_fetch_error or "no_data"
            print(f"[WARNING] No valid product data for {url} (stockx={fetch_err})")
            if fetch_err == "http_404":
                append_error_url(url, "stockx_404")
            else:
                append_skipped_url(url, f"stockx_{fetch_err}")
            log_event(url, action_type, "skipped", reason=fetch_err)
            return False
        
        for title, product_info in product_data.items():
            # CRITICAL: Check if product_info is None before processing
            if product_info is None:
                print(f"[WARNING] Product info is None for title '{title}', skipping")
                log_event(url, action_type, "skipped", reason="product_info_none")
                continue
            
            # CRITICAL: Check if product_info is a dict
            if not isinstance(product_info, dict):
                print(f"[WARNING] Product info is not a dict for '{title}', type={type(product_info)}, skipping")
                log_event(url, action_type, "skipped", reason="product_info_wrong_type")
                continue
                
            # Check if product has valid variants after filtering
            existing_product = find_existing_product(title, product_info, shopify_products, source_slug=url)
            raw_variants = product_info.get("variants") or []
            if existing_product:
                product_info["variants"] = filter_variants(raw_variants, for_create=False)
            else:
                product_info["variants"] = filter_variants(raw_variants, for_create=True)

            if not product_info.get("variants"):
                print(f"[WARNING] No valid variants for {title}, skipping")
                log_event(url, action_type, "skipped", reason="no_valid_variants")
                continue
            
            if existing_product:
                # CRITICAL FIX: If product exists, ALWAYS update it (even if action was "create")
                print(f"[INFO] ✅ Product already exists in Shopify: '{existing_product['title']}'")
                print(f"[INFO]    Product ID: {existing_product.get('id', 'N/A')}")
                print(f"[INFO]    Will UPDATE instead of create (prevents duplicates)")
                
                # For updates, warn about missing images but still proceed (product already exists)
                images = product_info.get("images", [])
                if not images or not any(img and str(img).strip() for img in images):
                    print(f"[WARNING] Product {title} update has no valid images - update will proceed but images won't be refreshed")
                
                # Log the automatic create->update conversion
                if action_type == "create":
                    log_event(url, "create", "skipped", reason="product_exists_converting_to_update")
                    log_event(url, "update", "started", reason="auto_converted_from_create")
                
                return update_product_enhanced(url, title, product_info, existing_product)
            else:
                # Product doesn't exist
                if action_type == "create":
                    try:
                        return create_product_enhanced(url, title, product_info)
                    except RateLimitException as e:
                        # Check if this is variant creation limit
                        if "variant creation limit" in str(e).lower() or "daily limit" in str(e).lower():
                            if skip_creates_on_limit:
                                print(f"[INFO] ⏸️  Variant creation limit hit for {url}")
                                print(f"[INFO] Deferring create to deferred_creates.txt - will continue with updates only")
                                append_deferred_create(url)
                                log_event(url, action_type, "deferred", reason="variant_creation_limit")
                                return None  # Return None to signal deferral
                        raise  # Re-raise if not handled
                else:
                    # Update requested but product not found — do NOT create duplicates
                    print(f"[INFO] Update requested for {title} but no match in Shopify (slug={url!r}) — skipping")
                    append_error_url(url, "update_product_not_found_in_shopify")
                    log_event(url, "update", "skipped", reason="product_not_found_no_create")
                    return False
                
    except RateLimitException as e:
        raise  # Re-raise rate limit errors
    except Exception as e:
        print(f"[ERROR] Failed to process {action_type} {url}: {e}")
        log_event(url, action_type, "error", reason=str(e))
        return False
    
    return True

def _sync_listing_enrichment(product_id, title, product_info, force_seo=False):
    """SEO meta + image alt text. Idempotent unless force_seo=True."""
    brand = product_info.get("brand") if isinstance(product_info, dict) else None
    product_type = product_info.get("productCategory") if isinstance(product_info, dict) else None
    try:
        summary = sync_product_listing_enrichment(
            product_id,
            title,
            brand=brand,
            product_type=product_type,
            force=force_seo,
        )
        if summary.get("seo_updated"):
            print(f"[INFO] SEO synced for {title}")
        if summary.get("alt_updated"):
            print(f"[INFO] Alt text synced for {title}: {summary['alt_updated']} image(s)")
        return summary
    except Exception as e:
        print(f"[WARNING] Listing enrichment failed for {title}: {e}")
        return {"seo_updated": False, "alt_updated": 0, "error": str(e)}

def create_product_enhanced(url, title, product_info):
    """Enhanced product creation with partial state tracking"""
    try:
        print(f"[INFO] Creating new product: {title}")
        
        # CRITICAL: Validate product has images before creating
        images = product_info.get("images", [])
        if not images or len(images) == 0:
            print(f"[ERROR] Product {title} has no images. Skipping creation to avoid incomplete product.")
            log_event(url, "create", "skipped", reason="no_images")
            return False
        
        # Validate images are not empty/None
        valid_images = [img for img in images if img and str(img).strip()]
        if not valid_images:
            print(f"[ERROR] Product {title} has empty/invalid images. Skipping creation.")
            log_event(url, "create", "skipped", reason="invalid_images")
            return False
        
        print(f"[INFO] Product {title} has {len(valid_images)} valid images - proceeding with creation")

        # HARD GUARD: never create/publish a product with zero variants
        variants_input = product_info.get("variants") or []
        if not variants_input:
            print(f"[ERROR] Product {title} has zero valid variants after filtering. Skipping creation.")
            log_event(url, "create", "skipped", reason="no_valid_variants_create_guard")
            return False
        
        # Ingestion adapter (if available)
        try:
            # Uncomment if ingestion modules are available
            # vendor_payload = product_info.get("__raw_vendor__") or {}
            # normalized = normalize_vendor_product(vendor_payload)
            # print(f"[DEBUG] Ingestion taxonomy: {normalized.taxonomy.full_name} ({normalized.taxonomy.id})")
            pass
        except Exception as _e:
            print(f"[DEBUG] Ingestion adapter skipped: {_e}")
        
        # Create product shell
        product_id, option_id = create_product(product_info)
        if not product_id or not option_id:
            print(f"[ERROR] Could not create product shell for {title}")
            return False
        
        # Upload curated set on create (default 5, --full-360 uploads all frames).
        # Bulk update appends any additional orbit extras beyond this.
        if valid_images:
            images_to_add = (
                valid_images if FULL_360_MODE else valid_images[:CREATE_IMAGES_MAX]
            )
            add_images_to_product(product_id, images_to_add)
        
        # Set STANDARD product attributes (best for Google Merchant Center)
        stockx_raw_data = product_info.get("__raw_vendor__", {})
        taxonomy_cat = product_info.get("taxonomyCategory")
        mf_summary = {}
        if stockx_raw_data:
            attributes = extract_product_attributes(stockx_raw_data)
            try:
                # CREATE: allow_category_fix=True so category is set correctly on first create
                std_result = set_standard_metafields_v2(product_id, attributes, raw_product_data=stockx_raw_data, taxonomy_category_id=taxonomy_cat, allow_category_fix=True)
                mf_summary["standard"] = std_result
            except Exception as _e:
                print(f"[WARNING] set_standard_metafields_v2 failed: {_e}")
                mf_summary["standard_error"] = str(_e)
            try:
                required_result = set_required_product_metafields(product_id, stockx_raw_data)
                mf_summary["custom"] = required_result
                print(f"[INFO] Required custom metafields: {required_result}")
            except Exception as _e:
                print(f"[WARNING] set_required_product_metafields failed: {_e}")
                mf_summary["custom_error"] = str(_e)
        
        # Keep old category metafield for backwards compatibility
        stockx_category = product_info.get("productCategory", "sneakers")
        set_product_metafield(product_id, stockx_category)
        update_product_description(product_id, product_info["description"])
        
        # Create variants with partial state tracking
        try:
            all_variant_skus = [v["sku"] for v in product_info["variants"]]
            create_response = create_variants_bulk(product_id, option_id, product_info["variants"])

            # Variant-level metafields on initial product creation.
            created_nodes = ((create_response.get("productVariantsBulkCreate") or {}).get("productVariants") or [])
            created_by_title = {str((node or {}).get("title", "")): (node or {}).get("id") for node in created_nodes}
            express_metafields = []
            for source_variant in product_info["variants"]:
                express_price = source_variant.get("express_price")
                if express_price is None:
                    continue
                variant_id = created_by_title.get(str(source_variant.get("size", "")))
                if variant_id:
                    express_metafields.append({
                        "variantId": variant_id,
                        "price": express_price,
                    })
            if express_metafields:
                set_variant_express_price_metafields(express_metafields)
            # Structured metafields (US size, Google Shopping, express_available).
            try:
                structured_payloads = _build_variant_structured_payloads(product_info, created_by_title)
                if structured_payloads:
                    set_variant_structured_metafields(structured_payloads)
            except Exception as _e:
                print(f"[WARNING] set_variant_structured_metafields (create) failed: {_e}")

            # Double-check that at least one variant exists before publishing
            created_variants = get_product_variants(product_id) or []
            if len(created_variants) == 0:
                print(f"[ERROR] Product {title} has 0 variants after creation. Not publishing.")
                log_event(url, "create", "error", reason="zero_variants_post_create")
                return False

            # Publish product only when we have variants
            publish_product_to_channels(product_id)

            enrichment = _sync_listing_enrichment(product_id, title, product_info, force_seo=True)

            print(f"[SUCCESS] Created product {title} with {len(created_variants)} variants")
            log_event(
                url,
                "create",
                "ok",
                title=title,
                details={
                    "product_id": product_id,
                    "variant_count": len(created_variants),
                    "metafields": mf_summary,
                    "express_variants": len(express_metafields),
                    "enrichment": enrichment,
                },
            )
            return True
            
        except RateLimitException as e:
            # Save partial state - product created but variants incomplete
            import datetime
            partial_entry = {
                "url": url,
                "shopify_product_id": product_id,
                "completed_skus": [],  # None completed yet since we hit limit
                "pending_skus": all_variant_skus,
                "timestamp": datetime.datetime.now().isoformat()
            }
            append_jsonl("partials_create.jsonl", partial_entry)
            print(f"[INFO] Saved partial create state for {title}")
            raise  # Re-raise to trigger backoff
        except Exception as e:
            print(f"[ERROR] Failed to create variants for {title}: {e}")
            return False
                
    except RateLimitException:
        raise  # Re-raise 429 errors
    except Exception as e:
        print(f"[ERROR] Failed to create product {title}: {e}")
        return False

def update_product_enhanced(url, title, product_info, existing_product):
    """Enhanced product update with partial state tracking"""
    try:
        print(f"[INFO] Updating existing product: {title}")
        
        # Safety check: product_info must be a dict
        if not isinstance(product_info, dict):
            print(f"[ERROR] product_info is not a dict for {title}, type={type(product_info)}")
            return False
        
        product_id = existing_product["id"]
        product_variants = get_product_variants(product_id, include_lock=True)
        variants_to_update = []
        variants_to_create = []
        express_metafields_for_existing = []
        price_lock_skips = 0

        current_title = (existing_product.get("title") or "").strip()
        if title and current_title != title.strip():
            try:
                if update_product_title(product_id, title):
                    existing_product["title"] = title
            except Exception as e:
                print(f"[WARNING] Failed to update title for {title}: {e}")
        
        # Update description - ALWAYS update to ensure old products get descriptions
        new_description = product_info.get("description", "")
        if new_description:
            try:
                update_product_description(product_id, new_description)
                print(f"[INFO] Updated description for {title}")
            except Exception as e:
                print(f"[WARNING] Failed to update description for {title}: {e}")
        else:
            print(f"[WARNING] No description available for {title} during update")
        
        # Update STANDARD product attributes (for Google Merchant Center)
        stockx_raw_data = product_info.get("__raw_vendor__", {})
        taxonomy_cat = product_info.get("taxonomyCategory")
        mf_summary = {}
        basketball_shoe = bool(stockx_raw_data and is_basketball_shoe_product(stockx_raw_data))
        # Never change Shopify taxonomy category on UPDATE — preserve manual/store categories.
        if stockx_raw_data:
            try:
                attributes = extract_product_attributes(stockx_raw_data)
                std_result = set_standard_metafields_v2(
                    product_id,
                    attributes,
                    raw_product_data=stockx_raw_data,
                    taxonomy_category_id=taxonomy_cat,
                    allow_category_fix=False,
                )
                mf_summary["standard"] = std_result
            except Exception as e:
                print(f"[WARNING] Failed to update product attributes: {e}")
                mf_summary["standard_error"] = str(e)
            try:
                required_result = set_required_product_metafields(product_id, stockx_raw_data)
                mf_summary["custom"] = required_result
                print(f"[INFO] Required custom metafields (update): {required_result}")
            except Exception as e:
                print(f"[WARNING] set_required_product_metafields failed: {e}")
                mf_summary["custom_error"] = str(e)
        
        # Legacy categories.product_category metafield: create only (not on update).
        # Sync additional StockX gallery images on update.
        # Creation path keeps first image only; updates can append missing gallery media.
        stockx_images = product_info.get("images", []) or []
        valid_images = []
        seen_images = set()
        for img in stockx_images:
            if not isinstance(img, str):
                continue
            cleaned = img.strip()
            if not cleaned.lower().startswith(("http://", "https://")):
                continue
            key = cleaned.lower()
            if key in seen_images:
                continue
            seen_images.add(key)
            valid_images.append(cleaned)

        if valid_images:
            try:
                existing_media = get_product_media_images(product_id)
                existing_image_urls = [item.get("url", "") for item in existing_media if item.get("url")]
                auto_rebuild_needed = should_auto_rebuild_product_images(
                    len(existing_media),
                    len(valid_images),
                    full_360=FULL_360_MODE,
                    explicit_rebuild=False,
                )

                if auto_rebuild_needed:
                    existing_media_ids = [item["id"] for item in existing_media if item.get("id")]
                    print(
                        f"[INFO] Auto image cleanup for {title}: "
                        f"shopify_images={len(existing_media)} > stockx_slots={len(valid_images)}"
                    )
                    delete_result = delete_product_media(product_id, existing_media_ids)
                    if delete_result.get("errors"):
                        raise Exception(f"Image cleanup failed: {delete_result['errors']}")
                    upload_result = add_images_to_product(product_id, valid_images)
                    print(
                        f"[INFO] Image rebuild for {title}: deleted={delete_result.get('deleted', 0)}, "
                        f"added={upload_result.get('added', 0)}, target={len(valid_images)}"
                    )
                else:
                    missing_images = urls_to_add_for_gallery_sync(
                        valid_images,
                        existing_image_urls,
                        skip_first_slot_if_has_media=not FULL_360_MODE,
                    )
                    if missing_images:
                        upload_result = add_images_to_product(product_id, missing_images)
                        print(
                            f"[INFO] Image sync for {title}: existing={len(existing_image_urls)}, "
                            f"extras_to_add={len(missing_images)}, added={upload_result.get('added', 0)}"
                        )
                    else:
                        print(
                            f"[INFO] Image sync skipped for {title}: no new gallery URLs "
                            f"(shopify_images={len(existing_image_urls)}, stockx_slots={len(valid_images)})"
                        )
            except RateLimitException:
                # Save partial state before re-raising rate limit.
                print(f"[WARNING] Hit 429 during image sync - saving partial update state")
                all_variant_skus = [
                    v.get("sku")
                    for v in (product_info.get("variants") or [])
                    if isinstance(v, dict) and v.get("sku")
                ]
                partial_entry = {
                    "url": url,
                    "shopify_product_id": product_id,
                    "completed_skus": [],
                    "pending_skus": all_variant_skus,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                append_jsonl("partials_update.jsonl", partial_entry)
                print(f"[INFO] Saved partial update state for {title} (during image sync)")
                raise
            except Exception as e:
                print(f"[WARNING] Image sync failed for {title}: {e}")
        else:
            print(f"[WARNING] No valid StockX images to sync during update for {title}")
        
        # Apply filtering to new variants (already filtered in process_url)
        new_variants = product_info.get("variants", [])
        if not new_variants:
            print(f"[WARNING] No variants in product_info for {title}")
            return False
        
        # Process each new variant
        for variant in new_variants:
            size_title = variant["size"]
            new_price = variant.get("price")
            new_barcode = variant.get("barcode", "")
            express_price = variant.get("express_price")
            variant_qty = int(variant.get("quantity") or 0)
            matched_variant = next((v for v in product_variants if v["title"] == size_title), None)
            
            if matched_variant:
                # Price lock: keep Shopify price until unlock / mark_sold.
                is_locked = bool(matched_variant.get("price_locked"))
                if is_locked:
                    effective_price = matched_variant.get("price") or new_price or "999.99"
                    price_lock_skips += 1
                    print(
                        f"[PRICE LOCK] {title} - Size {size_title}: "
                        f"keeping {effective_price} CHF (custom.price_locked=true)"
                    )
                else:
                    effective_price = new_price if new_price is not None else matched_variant.get("price", "0")
                if variant_qty <= 0 or variant.get("sold_out"):
                    print(f"[UPDATE STOCK] {title} - Size {size_title}: sold out (qty -> 0)")
                    # Sold-out while locked still zeros qty; unlock happens via mark_sold / external sale hook.
                elif not is_locked:
                    old_price = matched_variant.get("price", "N/A")
                    print(f"[UPDATE PRICE] {title} - Size {size_title}: {old_price} -> {effective_price} CHF")
                
                cost_value = variant.get("cost", {}).get("amount", float(effective_price or 0) * 0.80)
                if is_locked:
                    # Keep existing cost too when locked (avoid StockX cost drift).
                    existing_cost = matched_variant.get("unitCost")
                    if existing_cost is not None:
                        cost_value = existing_cost
                
                update_data = {
                    "id": matched_variant["id"],
                    "price": str(effective_price),
                    "quantity": variant_qty,
                    "inventoryItemId": matched_variant.get("inventoryItemId"),
                    "inventoryItem": {"cost": str(cost_value)}
                }
                # Add barcode if provided from StockX and not already set or different
                if new_barcode and (not matched_variant.get("barcode") or matched_variant.get("barcode") != new_barcode):
                    update_data["barcode"] = new_barcode
                    print(f"[INFO] Updating barcode for {size_title}: {new_barcode}")
                variants_to_update.append(update_data)
                if express_price is not None:
                    express_metafields_for_existing.append({
                        "variantId": matched_variant["id"],
                        "price": express_price,
                    })
            else:
                if NO_NEW_VARIANTS_MODE:
                    if variant_qty <= 0 or variant.get("sold_out"):
                        print(f"[SKIP VARIANT] {title} - Size {size_title}: sold out on StockX, not on Shopify")
                    else:
                        print(f"[SKIP NEW VARIANT] {title} - Size {size_title}: missing on Shopify (--no-new-variants)")
                    continue
                # Skip creating new variants that are sold out on StockX.
                if variant_qty <= 0 or variant.get("sold_out"):
                    print(f"[SKIP VARIANT] {title} - Size {size_title}: sold out on StockX, not creating")
                    continue
                # CREATE new variants that don't exist yet (full sync mode for main.py automation)
                print(f"[NEW VARIANT] {title} - Size {size_title}: Creating new variant with price {new_price} CHF")
                
                # Use the pre-calculated cost from variant data
                cost_value = variant.get("cost", {}).get("amount", float(new_price) * 0.80)
                
                variants_to_create.append({
                    "size": size_title,
                    "price": str(new_price),
                    "sku": variant["sku"],
                    "quantity": variant["quantity"],
                    "cost": {"amount": str(cost_value), "currencyCode": "CHF"},
                    "barcode": new_barcode,
                    "express_price": express_price,
                })
        
        # Zero out or remove variants no longer available on StockX.
        new_variant_titles = {v["size"] for v in new_variants}
        variants_off_stockx = [v for v in product_variants if v["title"] not in new_variant_titles]
        
        # CRITICAL: Also remove any existing EXPRESS/FAST DELIVERY variants
        express_variants_to_remove = [v for v in product_variants if is_fast_delivery(v["title"])]
        for v in express_variants_to_remove:
            if v not in variants_off_stockx:
                variants_off_stockx.append(v)
                print(f"[INFO] Found existing EXPRESS variant to remove: {v['title']} (ID: {v['id']})")

        variants_to_zero = [v for v in variants_off_stockx if not is_fast_delivery(v["title"])]
        delete_variant_ids = [v["id"] for v in variants_off_stockx if is_fast_delivery(v["title"])]

        if NO_NEW_VARIANTS_MODE:
            # Hide unavailable sizes with qty=0 (not shown on storefront) — no bulk deletes.
            variants_to_zero = list(variants_off_stockx)
            delete_variant_ids = []

        for v in variants_to_zero:
            current_price = v.get("price", "999.99")
            if float(current_price or 0) <= 0:
                current_price = "999.99"
            variants_to_update.append({
                "id": v["id"],
                "price": current_price,
                "quantity": 0,
                "inventoryItemId": v.get("inventoryItemId"),
                "inventoryItem": {"cost": str(float(current_price) * 0.80)}
            })
            print(f"[INFO] Marking unavailable size sold out (qty=0): {v['title']}")

        if delete_variant_ids:
            try:
                print(f"[INFO] Deleting {len(delete_variant_ids)} removed/express variants via bulk delete...")
                delete_variants_bulk(product_id, delete_variant_ids)
                # After delete, refresh local product_variants snapshot
                product_variants = get_product_variants(product_id)
            except RateLimitException as e:
                # Save partial state before re-raising
                print(f"[WARNING] Hit 429 during variant deletion - saving partial state")
                all_variant_skus = [v["sku"] for v in new_variants]
                partial_entry = {
                    "url": url,
                    "shopify_product_id": product_id,
                    "completed_skus": [],
                    "pending_skus": all_variant_skus,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                append_jsonl("partials_update.jsonl", partial_entry)
                print(f"[INFO] Saved partial update state for {title} (during variant deletion)")
                raise  # Re-raise rate limit errors
            except Exception as e:
                print(f"[WARNING] Bulk delete failed ({e}); falling back to safe quantity=0 updates for express variants")
                for v in variants_off_stockx:
                    if not is_fast_delivery(v["title"]):
                        continue
                    current_price = v.get("price", "999.99")
                    if float(current_price or 0) <= 0:
                        current_price = "999.99"
                    variants_to_update.append({
                        "id": v["id"],
                        "price": current_price,
                        "quantity": 0,
                        "inventoryItemId": v.get("inventoryItemId"),
                        "inventoryItem": {"cost": str(float(current_price) * 0.80)}
                    })
                    print(f"[INFO] EXPRESS variant fallback set qty=0: {v['title']}")
        
        # Execute updates and creations (FULL SYNC MODE for main.py automation)
        if variants_to_update:
            try:
                update_variants_bulk(product_id, variants_to_update)

                # One bulk inventory set replaces per-variant read+adjust loops.
                inventory_updates = [
                    {"inventoryItemId": upd.get("inventoryItemId"), "quantity": upd.get("quantity", 0)}
                    for upd in variants_to_update
                    if upd.get("inventoryItemId")
                ]
                if inventory_updates:
                    inventory_set_quantities_bulk(
                        inventory_updates,
                        location_id,
                        reason="correction",
                        reference_document_uri=f"gid://resell-lausanne/ProductSync/{product_id}",
                    )

                if express_metafields_for_existing:
                    set_variant_express_price_metafields(express_metafields_for_existing)

                # Structured metafields (US size, Google Shopping, express_available).
                try:
                    updated_id_map = {str(upd.get("id", "")).split("/")[-1]: upd.get("id") for upd in variants_to_update}
                    # Build size→id map from product_variants snapshot.
                    size_to_id = {str(v.get("title", "")): v.get("id") for v in product_variants}
                    structured_payloads = _build_variant_structured_payloads(product_info, size_to_id)
                    if structured_payloads:
                        set_variant_structured_metafields(structured_payloads)
                except Exception as _e:
                    print(f"[WARNING] set_variant_structured_metafields (update) failed: {_e}")

                print(f"[SUCCESS] Updated {title}: {len(variants_to_update)} variants updated")
            except RateLimitException as e:
                # Save partial state before re-raising
                print(f"[WARNING] Hit 429 during update - saving partial state to partials_update.jsonl")
                all_variant_skus = [v["sku"] for v in new_variants]
                partial_entry = {
                    "url": url,
                    "shopify_product_id": product_id,
                    "completed_skus": [],  # Track which variants were updated (if needed for granular resume)
                    "pending_skus": all_variant_skus,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                append_jsonl("partials_update.jsonl", partial_entry)
                print(f"[INFO] Saved partial update state for {title}")
                raise  # Re-raise rate limit errors
            except Exception as e:
                print(f"[ERROR] Failed to update variants for {title}: {e}")
                return False
        
        # Create new variants if any (FULL SYNC for main.py automation)
        if variants_to_create and not NO_NEW_VARIANTS_MODE:
            try:
                print(f"[INFO] Creating {len(variants_to_create)} new variants for {title}")
                option_id = get_first_option_id_of_product(product_id)
                if not option_id:
                    print(f"[ERROR] Could not find option ID for product {product_id}")
                    return False
                
                create_resp = create_variants_bulk(product_id, option_id, variants_to_create)

                # Variant-level express metafield for newly created variants.
                created_nodes = ((create_resp.get("productVariantsBulkCreate") or {}).get("productVariants") or [])
                created_by_title = {str((node or {}).get("title", "")): (node or {}).get("id") for node in created_nodes}
                express_for_new_variants = []
                for new_var in variants_to_create:
                    express_price = new_var.get("express_price")
                    if express_price is None:
                        continue
                    variant_id = created_by_title.get(str(new_var.get("size", "")))
                    if variant_id:
                        express_for_new_variants.append({
                            "variantId": variant_id,
                            "price": express_price,
                        })
                if express_for_new_variants:
                    set_variant_express_price_metafields(express_for_new_variants)

                try:
                    refreshed_variants = get_product_variants(product_id) or []
                    size_to_id = {str(v.get("title", "")): v.get("id") for v in refreshed_variants}
                    structured_payloads = _build_variant_structured_payloads(product_info, size_to_id)
                    if structured_payloads:
                        set_variant_structured_metafields(structured_payloads)
                except Exception as _e:
                    print(f"[WARNING] set_variant_structured_metafields (new variants) failed: {_e}")

                print(f"[SUCCESS] Created {len(variants_to_create)} new variants for {title}")
            except RateLimitException as e:
                # Save partial state before re-raising
                print(f"[WARNING] Hit 429 during new variant creation in update - saving partial state")
                all_variant_skus = [v["sku"] for v in new_variants]
                partial_entry = {
                    "url": url,
                    "shopify_product_id": product_id,
                    "completed_skus": [],
                    "pending_skus": all_variant_skus,
                    "timestamp": datetime.datetime.now().isoformat()
                }
                append_jsonl("partials_update.jsonl", partial_entry)
                print(f"[INFO] Saved partial update state for {title} (during variant creation)")
                raise  # Re-raise rate limit errors
            except Exception as e:
                print(f"[ERROR] Failed to create new variants for {title}: {e}")
                return False
        elif variants_to_create and NO_NEW_VARIANTS_MODE:
            print(f"[INFO] Skipped creating {len(variants_to_create)} new variants (--no-new-variants)")
            variants_to_create = []

        if not variants_to_update and not variants_to_create:
            print(f"[INFO] No variants to update for {title}")

        enrichment = _sync_listing_enrichment(
            product_id, title, product_info, force_seo=FULL_PASS_MODE
        )
        
        log_event(
            url,
            "update",
            "ok",
            title=title,
            details={
                "product_id": product_id,
                "variants_updated": len(variants_to_update),
                "variants_created": len(variants_to_create),
                "metafields": mf_summary,
                "express_metafields": len(express_metafields_for_existing),
                "enrichment": enrichment,
            },
        )
        return True
            
    except RateLimitException:
        raise  # Re-raise 429 errors
    except Exception as e:
        print(f"[ERROR] Failed to update product {title}: {e}")
        return False

# ----------------------------------------------------------------------------
# Helper: Build product description
def _get_trait_val(traits, *names):
    """Get trait value from Kicks (trait key) or StockX (name key) format."""
    targets = {str(n).strip().lower() for n in names}
    for t in traits or []:
        if not isinstance(t, dict):
            continue
        k = (t.get("trait") or t.get("name") or "").strip().lower()
        if k in targets:
            v = t.get("value")
            if v is not None:
                return str(v).strip()
    return ""


def build_description(original_description, traits, title="", sku="", product_data=None):
    """Build SEO-optimised product description.

    If StockX provides a description, append a structured details block.
    If no description, generate a rich block from every available data point
    so Google/AI have maximum signal.
    """
    # Collect all structured fields.
    raw = product_data or {}
    brand     = str(raw.get("brand") or "").strip()
    gender    = str(raw.get("gender") or "").strip().title()
    colorway  = _get_trait_val(traits, "colorway", "color")
    style_id  = _get_trait_val(traits, "style", "style id", "style code") or str(raw.get("sku") or "").strip()
    rel_date  = _get_trait_val(traits, "release date", "release_date")
    retail    = _get_trait_val(traits, "retail price", "retail_price")
    silhouette = _get_trait_val(traits, "silhouette")
    material  = _get_trait_val(traits, "material", "upper material", "fabric")
    country   = _get_trait_val(traits, "country of manufacture", "country of origin") or str(raw.get("country_of_origin") or "").strip()

    # Breadcrumb-based category label.
    bc = raw.get("breadcrumbs") or []
    cat_label = ""
    if bc:
        bc_sorted = sorted(bc, key=lambda x: x.get("level", 0) if isinstance(x, dict) else 0)
        cat_label = " > ".join(
            str(b.get("value") or "").strip()
            for b in bc_sorted if isinstance(b, dict) and b.get("value")
        )

    # Structured details block (always appended or used as base).
    lines = []
    if colorway:
        lines.append(f"<strong>Colorway:</strong> {colorway}")
    if style_id:
        lines.append(f"<strong>Style Code:</strong> {style_id}")
    if rel_date:
        lines.append(f"<strong>Release Date:</strong> {rel_date}")
    if retail:
        lines.append(f"<strong>Retail Price:</strong> {retail} CHF")
    if silhouette:
        lines.append(f"<strong>Silhouette:</strong> {silhouette}")
    if material:
        lines.append(f"<strong>Material:</strong> {material}")
    if gender:
        lines.append(f"<strong>Gender:</strong> {gender}")
    if country:
        lines.append(f"<strong>Country of Manufacture:</strong> {country}")
    if cat_label:
        lines.append(f"<strong>Category:</strong> {cat_label}")
    if sku:
        lines.append(f"<strong>SKU:</strong> {sku}")

    details_html = "<br>".join(lines) if lines else ""

    if original_description and original_description.strip():
        base = original_description.strip()
        if details_html:
            return f"{base}\n\n<p>{details_html}</p>"
        return base

    # No StockX description — generate a full SEO block.
    brand_str = f" by {brand}" if brand else ""
    gender_str = f" — {gender}" if gender else ""
    colorway_str = f" in {colorway}" if colorway else ""
    intro = (
        f"<p>Découvrez {title}{brand_str}{colorway_str}{gender_str}. "
        f"Disponible chez Resell Lausanne, chaque article est authentifié et vérifié manuellement avant expédition. "
        f"Livraison en Suisse et en Europe.</p>"
    )
    detail_block = f"<p>{details_html}</p>" if details_html else ""
    footer = (
        "<p>Produit 100% authentique. "
        "Resell Lausanne sélectionne uniquement des articles en parfait état, "
        "sourcés directement depuis des marchés secondaires certifiés.</p>"
    )
    return "\n".join(filter(None, [intro, detail_block, footer]))

# ----------------------------------------------------------------------------
# Extended fallback size chart (all brands, genders, and sizes as provided)
FALLBACK_SIZE_CHARTS = [
    {
        "Brand": "Nike",
        "Gender": "women",
        "Sizes": {
            "US": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "16", "16.5", "17", "17.5", "18"],
            "EU": ["35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "45.5", "46", "47", "47.5", "49", "50", "50.5", "51", "51.5"]
        }
    },
    {
        "Brand": "Nike",
        "Gender": "men",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "14", "15"],
            "EU": ["35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "45.5", "46", "47", "47.5", "48.5", "49.5"]
        }
    },
    {
        "Brand": "Nike",
        "Gender": "youth",
        "Sizes": {
            "US": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["16", "17", "18.5", "19.5", "21", "22", "23.5", "25", "26", "27", "27.5", "28", "28.5", "29.5", "30", "31", "31.5", "32", "33", "33.5", "34", "35", "35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40"]
        }
    },
    {
        "Brand": "adidas",
        "Gender": "men",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "15"],
            "EU": ["35 1/3", "36", "36 2/3", "37 1/3", "38", "38 2/3", "39 1/3", "40", "40 2/3", "41 1/3", "42", "42 2/3", "43 1/3", "44", "44 2/3", "45 1/3", "46", "46 2/3", "47 1/3", "48", "48 2/3", "49 1/3", "50 2/3"]
        }
    },
    {
        "Brand": "adidas",
        "Gender": "women",
        "Sizes": {
            "US": ["4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12"],
            "EU": ["35 1/3", "36", "36 2/3", "37 1/3", "38", "38 2/3", "39 1/3", "40", "40 2/3", "41 1/3", "42", "42 2/3", "43 1/3", "44", "44 2/3", "45 1/3"]
        }
    },
    {
        "Brand": "adidas",
        "Gender": "youth",
        "Sizes": {
            "US": ["10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": [ "27", "27 1/2", "28", "28 2/3", "29", "30", "30 2/3", "31", "31 2/3", "32", "33", "33 1/2", "34", "35", "35 1/2", "36", "36 1/2", "37 1/2", "38", "38 1/2", "39", "40"]
        }
    },
    {
        "Brand": "Air Jordan",
        "Gender": "men",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "14", "15", "16", "17", "18"],
            "EU": ["35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "45.5", "46", "47", "47.5", "48.5", "49.5", "50.5", "51.5", "52.5"]
        }
    },
    {
        "Brand": "Air Jordan",
        "Gender": "women",
        "Sizes": {
            "US": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5"],
            "EU": ["35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "45.5", "46", "47", "47.5"]
        }
    },
    {
        "Brand": "Air Jordan",
        "Gender": "youth",
        "Sizes": {
            "US": ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["16", "17", "18.5", "19.5", "21", "22", "23.5", "25", "26", "27", "27.5", "28", "28.5", "29.5", "30", "31", "31.5", "32", "33", "33.5", "34", "35", "35.5", "36", "36.5", "37.5", "38", "38.5", "39", "40"]
        }
    },
    {
        "Brand": "ASICS",
        "Gender": "men",
        "Sizes": {
            "US": ["3.5","4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5"],
            "EU": ["35.5","36", "37", "37.5", "38", "39", "39.5", "40", "40.5", "41.5", "42", "42.5", "43.5", "44", "44.5", "45", "46", "46.5", "47", "48", "48.5", "49", "49.5"]
        }
    },
    {
        "Brand": "ASICS",
        "Gender": "women",
        "Sizes": {
            "US": ["4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5"],
            "EU": ["35", "35.5", "36", "37", "37.5", "38", "39", "39.5", "40", "40.5", "41.5", "42", "42.5", "43.5", "44", "44.5", "45"]
        }
    },
    {
        "Brand": "ASICS",
        "Gender": "youth",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["35.5", "36", "37", "37.5", "38", "39", "39.5", "40"]
        }
    },
    {
        "Brand": "UGG",
        "Gender": "men",
        "Sizes": {
            "US": ["5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16", "17", "18"],
            "EU": ["38", "39", "40", "41", "42", "43", "44", "45", "46", "48.5", "49.5", "50.5", "51", "52"]
        }
    },
    {
        "Brand": "UGG",
        "Gender": "women",
        "Sizes": {
            "US": ["5", "6", "7", "8", "9", "10", "11", "12"],
            "EU": ["36", "37", "38", "39", "40", "41", "42", "43"]
        }
    },
    {
        "Brand": "UGG",
        "Gender": "youth",
        "Sizes": {
            "US": ["13", "1", "2", "3", "4", "5", "6"],
            "EU": ["31", "32.5", "33.5", "35", "36", "37", "38"]
        }
    },
    {
        "Brand": "New Balance",
        "Gender": "men",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "15", "16"],
            "EU": ["35", "36", "37", "37.5", "38", "38.5", "39.5", "40", "40.5", "41.5", "42", "42.5", "43", "44", "44.5", "45", "45.5", "46.5", "47", "47.5", "48.5", "49", "50", "51"]
        }
    },
    {
        "Brand": "New Balance",
        "Gender": "women",
        "Sizes": {
            "US": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12"],
            "EU": ["35", "36", "36.5", "37", "37.5", "38", "39", "40", "40.5", "41", "41.5", "42.5", "43", "43.5", "44"]
        }
    },
    {
        "Brand": "New Balance",
        "Gender": "youth",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["35.5", "36", "37", "37.5", "38", "38.5", "39", "40"]
        }
    },
    {
        "Brand": "Onitsuka Tiger",
        "Gender": "men",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5"],
            "EU": ["36", "37", "37.5", "38", "39", "39.5", "40", "40.5", "41.5", "42", "42.5", "43.5", "44", "44.5", "45", "46", "46.5", "47", "48", "48.5", "49", "49.5"]
        }
    },
    {
        "Brand": "Golden Goose",
        "Gender": "men",
        "Sizes": {
            "US": ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47"],
            "EU": ["35", "36", "37", "38", "39", "40", "41", "42", "43", "44", "45", "46", "47"]
        }
    },
    {
        "Brand": "Golden Goose",
        "Gender": "women",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5"],
            "EU": ["36", "37", "37.5", "38", "39", "39.5", "40", "40.5", "41.5", "42", "42.5", "43.5", "44", "44.5", "45", "46", "46.5", "47", "48", "48.5", "49", "49.5"]
        }
    },
    {
        "Brand": "Timberland",
        "Gender": "men",
        "Sizes": {
            "US": ["5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "13.5", "14", "14.5", "15"],
            "EU": ["37.5", "38", "39", "39.5", "40", "41", "41.5", "42", "43", "43.5", "44", "44.5", "45", "45.5", "46", "47", "47.5", "48", "49", "49.5", "50"]
        }
    },
    {
        "Brand": "Timberland",
        "Gender": "women",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "11", "11.5", "12"],
            "EU": ["34.5", "35", "35.5", "36", "37", "37.5", "38", "38.5", "39", "39.5", "40", "41", "41.5", "42", "44", "44.5"]
        }
    },
    {
        "Brand": "Timberland",
        "Gender": "youth",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["35.5", "36", "37", "37.5", "38", "39", "39.5", "40"]
        }
    },
    {
        "Brand": "Puma",
        "Gender": "men",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13", "14"],
            "EU": ["35.5", "36", "37", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "46", "47", "48.5"]
        }
    },
    {
        "Brand": "Puma",
        "Gender": "women",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "11", "11.5", "12", "13", "13.5", "14"],
            "EU": ["34.5", "35", "35.5", "36", "37", "37.5", "38", "38.5", "39", "39.5", "40", "41", "41.5", "42", "44", "44.5"]
        }
    },
    {
        "Brand": "Puma",
        "Gender": "youth",
        "Sizes": {
            "US": ["3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["35.5", "36", "37", "37.5", "38", "39", "39.5", "40"]
        }
    },
    {
        "Brand": "yeezyslide",
        "Gender": "men",
        "Sizes": {
            "US": ["4", "5", "6", "7", "8", "9", "10", "11", "12", "13", "14", "15", "16"],
            "EU": ["37", "38", "39", "40.5", "42", "43", "44.5", "46", "47", "48.5", "50", "51", "52"]
        }
    },
    {
        "Brand": "Saucony",
        "Gender": "men",
        "Sizes": {
            "US": ["3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "12.5", "13", "14", "15", "16"],
            "EU": ["35", "35.5", "36", "37", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "45", "46", "46.5", "47", "48", "49", "50", "51.5"]
        }
    },
    {
        "Brand": "Saucony",
        "Gender": "women",
        "Sizes": {
            "US": ["4", "4.5", "5", "5.5", "6", "6.5", "7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13"],
            "EU": ["34.5", "35", "35.5", "36", "37", "37.5", "38", "38.5", "39", "40", "40.5", "41", "42", "42.5", "43", "44", "44.5", "46"]
        }
    },
    {
        "Brand": "Saucony",
        "Gender": "kids",
        "Sizes": {
            "US": ["12.5", "13", "13.5", "1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5", "5.5", "6", "6.5", "7"],
            "EU": ["30.5", "31", "32", "32.5", "33", "33.5", "34.5", "35", "35.5", "36", "37", "37.5", "38", "38.5", "39.5", "40"]
        }
    },
    {
        "Brand": "Fear of God",
        "Gender": "men",
        "Sizes": {
            "US": ["XS", "S", "M", "L", "XL", "XXL"],
            "EU": ["XS", "S", "M", "L", "XL", "XXL"]
        }
    },
    {
        "Brand": "Fear of God",
        "Gender": "women",
        "Sizes": {
            "US": ["XS", "S", "M", "L", "XL", "XXL"],
            "EU": ["XS", "S", "M", "L", "XL", "XXL"]
        }
    }
]

# ----------------------------------------------------------------------------
# Helper function: Extended size lookup (US -> EU) based on brand and gender.
def extended_size_lookup(brand, gender, us_size):
    """
    Given a brand (e.g., "Nike"), gender (e.g., "Men"), and a US size,
    look up the corresponding EU size from FALLBACK_SIZE_CHARTS.
    Returns the EU size if found; otherwise, returns None.
    """
    if not brand or not gender or not us_size:
        return None
    
    brand = str(brand).strip().lower() if brand else ""
    gender = str(gender).strip().lower() if gender else ""
    us_size = str(us_size).strip() if us_size else ""
    
    # Handle specific brand name variations
    if "yeezy slide" in brand or "yeezyslide" in brand or "yeezy" in brand and "slide" in brand:
        brand = "yeezyslide"  # Use specific yeezyslide chart
    elif "yeezy" in brand or "yeez" in brand:
        brand = "adidas"  # Map other Yeezy to adidas for size lookup
    elif "jordan" in brand:
        brand = "air jordan"
    
    for entry in FALLBACK_SIZE_CHARTS:
        entry_brand = entry["Brand"].strip().lower()
        if entry_brand == brand and entry["Gender"].strip().lower() == gender:
            us_list = entry["Sizes"]["US"]
            eu_list = entry["Sizes"]["EU"]
            if us_size in us_list:
                index = us_list.index(us_size)
                if index < len(eu_list):
                    return eu_list[index]
    
    # Try a second pass with just "adidas" for any remaining Yeezy variations
    if (brand == "adidas" and "yeezy" in brand) or "yeez" in brand:
        for entry in FALLBACK_SIZE_CHARTS:
            if entry["Brand"].strip().lower() == "adidas" and entry["Gender"].strip().lower() == gender:
                us_list = entry["Sizes"]["US"]
                eu_list = entry["Sizes"]["EU"]
                if us_size in us_list:
                    index = us_list.index(us_size)
                    if index < len(eu_list):
                        return eu_list[index]
    
    return None

def check_limit_reset(last_limit_hit_time):
    """Check if 24 hours have passed since the last time we hit the limit"""
    if not last_limit_hit_time:
        return True
    
    now = datetime.datetime.now()
    last_time = datetime.datetime.fromisoformat(last_limit_hit_time)
    time_diff = now - last_time
    
    # Return True if more than 24 hours have passed
    return time_diff.total_seconds() > 24 * 60 * 60

def load_tracking_data():
    """Load tracking data from file"""
    tracking_file = "shopify_processing_state.json"
    if os.path.exists(tracking_file) and os.path.getsize(tracking_file) > 0:
        try:
            with open(tracking_file, "r") as f:
                data = json.load(f)
                print(f"[INFO] Loaded existing tracking data with {len(data.get('processed_urls', []))} processed URLs")
                return data
        except Exception as e:
            print(f"[ERROR] Error loading tracking data: {e}")
    
    # Default state if file doesn't exist or there's an error
    default_data = {
        "processed_urls": [],
        "last_limit_hit_time": None,
        "current_index": 0
    }
    
    # Create new tracking file with default data
    try:
        with open(tracking_file, "w") as f:
            json.dump(default_data, f, indent=2)
        print(f"[INFO] Created new tracking file with default values")
    except Exception as e:
        print(f"[ERROR] Failed to create tracking file: {e}")
    
    return default_data

def save_tracking_data(tracking_data):
    """Save tracking data to file"""
    tracking_file = "shopify_processing_state.json"
    try:
        with open(tracking_file, "w") as f:
            json.dump(tracking_data, f, indent=2)
        print(f"[INFO] Saved tracking data with {len(tracking_data.get('processed_urls', []))} processed URLs")
    except Exception as e:
        print(f"[ERROR] Error saving tracking data: {e}")
        # Backup attempt with more detailed error reporting
        try:
            print(f"[DEBUG] Tracking data keys: {list(tracking_data.keys())}")
            print(f"[DEBUG] Current index: {tracking_data.get('current_index')}")
            with open(tracking_file + ".backup", "w") as f:
                json.dump(tracking_data, f, indent=2)
            print(f"[INFO] Saved backup tracking data")
        except Exception as e2:
            print(f"[ERROR] Failed backup save attempt: {e2}")

def find_url_index(url_list, target_url):
    """Find the index of a specific URL in the list"""
    for i, url in enumerate(url_list):
        if url.strip() == target_url.strip():
            return i
    return -1  # URL not found

# ----------------------------------------------------------------------------
# Function to process a single URL
# ----------------------------------------------------------------------------
# Build variant structured metafield payload from product_info + id map.
def _build_variant_structured_payloads(product_info, size_to_id_map):
    """Return list of payloads for set_variant_structured_metafields.

    size_to_id_map: {size_title_str: shopify_variant_gid}
    """
    raw = product_info.get("__raw_vendor__") or {}
    gender = str(raw.get("gender") or "").strip().lower()
    age_group = "kids" if "kid" in gender or "youth" in gender or "child" in gender else "adult"
    product_type = str(raw.get("product_type") or "").lower()
    # size_system: EU for sneakers/shoes, leave default EU for all (store sells EU sizes).
    size_system = "EU"
    payloads = []
    for v in product_info.get("variants") or []:
        vid = size_to_id_map.get(str(v.get("size", "")))
        if not vid:
            continue
        payloads.append({
            "variantId": vid,
            "us_size": v.get("us_size"),
            "express_available": v.get("express_available", False),
            "gender": gender,
            "age_group": age_group,
            "mpn": v.get("sku"),
            "size_system": size_system,
            "condition": "new",
        })
    return payloads


# ----------------------------------------------------------------------------
# Kicks/StockX parsing helpers (idempotent, deterministic mapping).
# Kicks API uses {"trait": ..., "value": ...} while older StockX uses {"name", "value"}.
# Centralize lookups so process_url stays linear.
def get_trait(product, trait_name):
    if not isinstance(product, dict):
        return None
    target = str(trait_name or "").strip().lower()
    if not target:
        return None
    for trait in product.get("traits", []) or []:
        if not isinstance(trait, dict):
            continue
        name = trait.get("trait") or trait.get("name") or ""
        if str(name).strip().lower() == target:
            val = trait.get("value")
            if val is None:
                return None
            val_str = str(val).strip()
            return val_str or None
    return None


def get_size_by_type(variant, size_type):
    if not isinstance(variant, dict):
        return None
    target = str(size_type or "").strip().lower()
    for s in variant.get("sizes", []) or []:
        if not isinstance(s, dict):
            continue
        if str(s.get("type", "") or "").strip().lower() == target:
            val = s.get("size")
            if val is None:
                continue
            v = str(val).strip()
            if v:
                return v
    return None


def get_eu_size(variant):
    raw = get_size_by_type(variant, "eu")
    if not raw:
        return None
    cleaned = raw.replace("EU", "").strip()
    return cleaned or None


def get_upc(variant):
    if not isinstance(variant, dict):
        return ""
    ids = variant.get("identifiers", [])
    if isinstance(ids, list):
        for obj in ids:
            if not isinstance(obj, dict):
                continue
            ident = (obj.get("identifier") or "").strip()
            if ident and ident != "--":
                return ident
    elif isinstance(ids, dict):
        for k in ("gtin", "GTIN", "upc", "UPC", "ean", "EAN"):
            v = (ids.get(k) or "").strip() if isinstance(ids.get(k), str) else ids.get(k)
            if v:
                return v
    return ""


def get_lowest_price_by_shipping_type(variant, allowed_types, min_asks=0):
    if not isinstance(variant, dict):
        return None
    allowed = {str(t).strip().lower() for t in (allowed_types or [])}
    best = None
    for p in variant.get("prices", []) or []:
        if not isinstance(p, dict):
            continue
        ptype = str(p.get("type", "") or "").strip().lower()
        if allowed and not any(ptype == a or ptype.startswith(a) for a in allowed):
            continue
        try:
            price_val = float(p.get("Price", p.get("price", 0)) or 0)
            asks_val = int(p.get("Asks", p.get("asks", 0)) or 0)
        except (TypeError, ValueError):
            continue
        if price_val <= 0 or asks_val < min_asks:
            continue
        entry = {"type": ptype, "price": price_val, "asks": asks_val}
        if best is None or price_val < best["price"]:
            best = entry
    return best


def derive_color_pattern(colorway):
    if not colorway:
        return None
    raw = str(colorway).strip()
    if not raw:
        return None
    parts = re.split(r"[\/,&]", raw)
    primary = (parts[0] or "").strip() if parts else raw
    return primary or raw


def process_url(url, thread_id=0, prefetched=None):
    """Fetch + parse one product.

    prefetched: optional raw KicksDB product record (the `data` object of the
    API response, e.g. KickDBProduct.rawJson from the DB buffer). When given,
    the KicksDB HTTP call is skipped and parsing runs on the provided payload
    exactly as if it had just been fetched. When None (default), behavior is
    byte-identical to before: fetch via stockXAPI.getOne.
    """
    thread_api_products = {}
    try:
        print(f"[Thread {thread_id}] Processing URL: {url}")
        if prefetched is not None:
            print(f"[Thread {thread_id}] Using prefetched payload (no KicksDB call)")
            out = {"data": prefetched}
        else:
            api_slug = url.strip().split("/")[-1].split("?")[0]
            if api_slug != url.strip():
                print(f"[Thread {thread_id}] Using Kicks API slug (query/path normalized): {api_slug}")
            out = stockXAPI.getOne(api_slug)
        if not out:
            print(f"[Thread {thread_id}] No data received for {url}")
            return {}
    except Exception as e:
        print(f"[Thread {thread_id}] Error fetching {url}: {e}")
        return {}

    # Handle new API response structure
    stockx_response = out.get("data")
    if not stockx_response:
        print(f"[Thread {thread_id}] No data found for {url}")
        return {}

    product_data = stockx_response
    
    # DEBUG: Log top-level StockX response structure
    print(f"[Thread {thread_id}] [DEBUG STOCKX] Product data keys: {list(product_data.keys())}")
    print(f"[Thread {thread_id}] [DEBUG STOCKX] Has 'variants' key: {'variants' in product_data}")
    print(f"[Thread {thread_id}] [DEBUG STOCKX] Has 'market' key: {'market' in product_data}, value: {product_data.get('market', 'N/A')}")
    print(f"[Thread {thread_id}] [DEBUG STOCKX] Has 'currency' key: {'currency' in product_data}, value: {product_data.get('currency', 'N/A')}")
    
    title = product_data.get("title", "")
    brand = product_data.get("brand", "")
    # FIX: StockX API V3 returns Style ID in "sku" field, not "styleId"
    style_id = product_data.get("sku", "")
    
    # CRITICAL: Check if we have valid product data
    if not title or not title.strip():
        print(f"[Thread {thread_id}] [WARNING] Invalid URL or no product data: {url} (empty title)")
        return {}
    
    # Generate a fallback ID if styleId is missing
    if not style_id:
        print(f"[Thread {thread_id}] [INFO] Missing style ID for {title}, generating fallback ID.")
        # Try to use other identifiers, or create one based on title
        clean_title = re.sub('[^a-zA-Z0-9]', '-', title)
        style_id = product_data.get("id", "") or product_data.get("productId", "") or f"SKU-{clean_title}"
        
    traits = product_data.get("traits", [])
    original_description = product_data.get("description", "")
    if original_description:
        original_description = original_description.replace("StockX", "Resell-lausanne")
    
    # Extract product-level identifiers (GTIN, UPC, EAN) if available
    identifiers = product_data.get("identifiers", {}) or {}
    product_gtin = identifiers.get("gtin") or identifiers.get("GTIN") or ""
    product_upc = identifiers.get("upc") or identifiers.get("UPC") or ""
    product_ean = identifiers.get("ean") or identifiers.get("EAN") or ""
    # Use first available identifier
    product_barcode = product_gtin or product_upc or product_ean or ""
    if product_barcode:
        print(f"[Thread {thread_id}] [INFO] Found product identifier: {product_barcode}")
    
    # Images: full 360 strip when --full-360, else ~5 orbit angles
    if FULL_360_MODE:
        images = list_all_gallery_360_urls(product_data) or select_stockx_product_images(product_data)
    else:
        images = select_stockx_product_images(product_data)
    
    variants = product_data.get("variants", [])
    
    # DEBUG: Log raw StockX variant data to diagnose pricing issues
    print(f"[Thread {thread_id}] [DEBUG STOCKX] Total variants returned: {len(variants)}")
    if variants:
        sample_variant = variants[0]
        print(f"[Thread {thread_id}] [DEBUG STOCKX] Sample variant keys: {list(sample_variant.keys())}")
        print(f"[Thread {thread_id}] [DEBUG STOCKX] Sample variant 'sizes' field: {sample_variant.get('sizes', 'MISSING')}")
        print(f"[Thread {thread_id}] [DEBUG STOCKX] Sample variant 'prices' field: {sample_variant.get('prices', 'MISSING')}")
        print(f"[Thread {thread_id}] [DEBUG STOCKX] Sample variant 'total_asks' field: {sample_variant.get('total_asks', 'MISSING')}")
        # Show first 3 variants' price data for comparison
        for idx, v in enumerate(variants[:3]):
            prices = v.get('prices', [])
            print(f"[Thread {thread_id}] [DEBUG STOCKX] Variant {idx+1} prices: {prices}")

    # FIX 1: Derive a stable handle from the incoming URL (best) or title
    incoming_slug = ""
    try:
        incoming_slug = url.strip().split("/")[-1].split("?")[0]
    except Exception:
        pass

    def mk_handle(s: str) -> str:
        h = re.sub(r"[^\w\-]+", "-", s.lower()).strip("-")
        h = re.sub(r"-{2,}", "-", h)
        return h

    stable_handle = mk_handle(incoming_slug or title)
    
    # FIX 7: Use handle-based SKU fallback for consistency
    base_sku = style_id or f"SKU-{stable_handle}"
    
    # NOW build description with title and SKU available
    description = build_description(original_description, traits, title, base_sku, product_data=product_data)

    if title:
        thread_api_products[title] = {
            "title": title,
            "description": description,
            "images": images,
            "sku": base_sku,  # Use base_sku instead of style_id
            "brand": brand,
            "handle": stable_handle,        # NEW: Deterministic handle
            "source_url": url,              # NEW: For logs and matching
            "variants": [],
            "productCategory": product_data.get("product_type") or product_data.get("productCategory") or "sneakers",
            "taxonomyCategory": derive_taxonomy_category(product_data),
            "product_barcode": product_barcode,
            "__raw_vendor__": product_data,
        }

    # Process each variant (new API structure)
    for variant in variants:
        # Extract EU size via helper.
        sizes_list = variant.get("sizes", []) or []
        eu_size = get_eu_size(variant)

        # Fallback: try US size mapping if EU not found
        if not eu_size:
            us_label = None
            for s in sizes_list:
                size_type = str(s.get("type", "") or "").lower()
                if size_type in ["us m", "us w", "us"]:
                    size_val = s.get("size")
                    if size_val is not None:
                        size_val = str(size_val).strip()
                        us_label = size_val.replace("US M", "").replace("US W", "").replace("US", "").strip()
                        break
            
            if us_label:
                mapped = extended_size_lookup(brand, product_data.get("gender", ""), us_label)
                if mapped:
                    eu_size = mapped
                    print(f"[Thread {thread_id}] [DEBUG] Fallback conversion: US '{us_label}' -> EU '{eu_size}' for {brand}")
                else:
                    # No brand mapping found - use US size as-is for clothing/accessories
                    eu_size = us_label
                    print(f"[Thread {thread_id}] [INFO] No size mapping for brand '{brand}', using US size as-is: '{us_label}'")
            else:
                # Try apparel alpha sizes (XS–XXL) before defaulting to One Size
                alpha_size = None
                alpha_candidates = {"xxs":"XXS","xs":"XS","s":"S","small":"S","m":"M","medium":"M","l":"L","large":"L","xl":"XL","xxl":"XXL","2xl":"XXL","xxxl":"XXXL","3xl":"XXXL"}
                for s in sizes_list:
                    raw = str(s.get("size", "") or "").strip()
                    lowered = raw.lower()
                    if lowered in alpha_candidates:
                        alpha_size = alpha_candidates[lowered]
                        break
                    # handle formats like "Size M" or "Women M"
                    for key, norm in alpha_candidates.items():
                        if f" {key}" in lowered or lowered.startswith(key):
                            alpha_size = norm
                            break
                    if alpha_size:
                        break

                if alpha_size:
                    eu_size = alpha_size
                    print(f"[Thread {thread_id}] [DEBUG] Apparel alpha size detected: '{alpha_size}'")
                else:
                    # Accessory/single-SKU path: allow one-size items (size may be blank or just prefixes without value)
                    meaningful_size_found = False
                    for s in sizes_list:
                        val = str(s.get("size", "") or "").strip()
                        cleaned_val = val.replace("US", "").replace("EU", "").replace("M", "").replace("W", "").strip()
                        if cleaned_val:  # If there's actual size content after removing prefixes
                            meaningful_size_found = True
                            break

                    if not meaningful_size_found or not sizes_list:
                        eu_size = "One Size"
                        print(f"[Thread {thread_id}] [INFO] Treating variant as single-SKU accessory: size='One Size'")

        # Check currency and market from variant (API may ignore CHF/CH request)
        variant_currency = variant.get("currency", "UNKNOWN")
        variant_market = variant.get("market", "UNKNOWN")
        if variant_currency != "CHF":
            print(f"[Thread {thread_id}] [WARNING] API returned {variant_currency} instead of CHF for {eu_size}! Prices may need conversion.")
        
        # Get prices from new API structure
        total_asks = variant.get("total_asks", 0)
        
        # FIX 3: Set qty=1 for single-variant "One Size" to survive filtering
        if eu_size == "One Size":
            valid_quantity = 1
        else:
            valid_quantity = 1 if total_asks >= 2 else 0
        
        # Split prices into standard and express pools.
        prices_list = variant.get("prices", []) or []
        
        # DEBUG: Show raw prices data before validation
        print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: raw prices_list type={type(prices_list)}, length={len(prices_list) if isinstance(prices_list, list) else 'N/A'}")
        if prices_list:
            print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: raw prices_list content={prices_list}")
        
        # Collect valid prices.
        available_prices = []
        standard_prices = []
        express_prices = []
        for price_entry in prices_list:
            price_type = price_entry.get("type", "")
            # FIX: StockX API returns "Price" (capital P) not "price" (lowercase)
            price_value = float(price_entry.get("Price", price_entry.get("price", 0)) or 0)
            asks_value = int(price_entry.get("Asks", price_entry.get("asks", 0)) or 0)
            print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: Checking price_entry type='{price_type}', value={price_value}, asks={asks_value}")
            if price_value > 0:
                entry = {
                    "type": price_type,
                    "price": price_value,
                    "asks": asks_value
                }
                available_prices.append(entry)

                price_type_l = str(price_type or "").lower()
                if price_type_l == "standard":
                    standard_prices.append(entry)
                if price_type_l.startswith("express") and asks_value > 2:
                    express_prices.append(entry)
        
        if not available_prices:
            print(f"[Thread {thread_id}] [INFO] No StockX asks for size {eu_size}; marking sold out")
            barcode = get_upc(variant) or product_barcode
            us_size_raw = get_size_by_type(variant, "us m") or get_size_by_type(variant, "us w") or get_size_by_type(variant, "us")
            us_size_clean = str(us_size_raw or "").replace("US M", "").replace("US W", "").replace("US", "").strip() or None
            thread_api_products[title]["variants"].append({
                "size": eu_size,
                "price": None,
                "cost": {"amount": "0.00", "currencyCode": "CHF"},
                "sku": f"{base_sku}-OS" if eu_size == "One Size" else f"{base_sku}-{eu_size}",
                "quantity": 0,
                "sold_out": True,
                "barcode": barcode,
                "express_price": None,
                "express_available": False,
                "us_size": us_size_clean,
            })
            continue
        
        # Normal sell price should use standard lane first.
        if standard_prices:
            lowest_price_entry = min(standard_prices, key=lambda x: x["price"])
        else:
            lowest_price_entry = min(available_prices, key=lambda x: x["price"])
            print(f"[Thread {thread_id}] [WARNING] No standard price for {eu_size}; fallback to type='{lowest_price_entry['type']}'")
        raw_price = lowest_price_entry["price"]
        price_type = lowest_price_entry["type"]
        asks_count = lowest_price_entry["asks"]
        
        print(f"[STOCKX PRICE] {title} - Size {eu_size}: LOWEST PRICE = {raw_price} CHF (type: {price_type}, asks: {asks_count})")
        
        if raw_price > 0:
            # Get product category and handle for LEGO-specific pricing
            pc = thread_api_products[title]["productCategory"]
            product_handle = thread_api_products[title].get("handle", "")
            
            # Ensure LEGO category is set for LEGO products
            try:
                if isinstance(title, str) and "lego" in title.lower():
                    pc = "lego"
            except Exception:
                pass
            
            # Calculate standard cost/sell.
            cost_value = calc_touch_price(raw_price, pc, product_handle)
            sell_price = calc_sell_price(raw_price, pc, is_express=False, product_handle=product_handle, brand=brand)
            print(f"[CALCULATED] {title} - Size {eu_size}: STOCKX={raw_price} CHF, COST={cost_value:.2f} CHF, SELL={sell_price} CHF")

            # Express sell price for metafield (only when asks > 2 on express lanes).
            express_sell_price = None
            if express_prices:
                lowest_express_entry = min(express_prices, key=lambda x: x["price"])
                express_raw_price = lowest_express_entry["price"]
                express_sell_price = calc_sell_price(
                    express_raw_price,
                    pc,
                    is_express=True,
                    product_handle=product_handle,
                    brand=brand,
                )
                print(
                    f"[CALCULATED EXPRESS] {title} - Size {eu_size}: RAW={express_raw_price} CHF "
                    f"(type={lowest_express_entry['type']}, asks={lowest_express_entry['asks']}) "
                    f"SELL={express_sell_price} CHF"
                )
        else:
            print(f"[Thread {thread_id}] [WARNING] Invalid price for {title} size {eu_size}, skipping variant.")
            continue

        if sell_price <= 0:
            print(f"[Thread {thread_id}] [WARNING] Zero or negative price for {title} size {eu_size}, skipping variant.")
            continue

        # Extract GTIN/UPC via helper; fallback to product-level identifier.
        barcode = get_upc(variant) or product_barcode

        # US size for Google Shopping feed.
        us_size_raw = get_size_by_type(variant, "us m") or get_size_by_type(variant, "us w") or get_size_by_type(variant, "us")
        us_size_clean = str(us_size_raw or "").replace("US M", "").replace("US W", "").replace("US", "").strip() or None

        print(f"[Thread {thread_id}] [DEBUG] Creating variant: size={eu_size}, price={sell_price}, barcode={barcode or 'none'}")
        thread_api_products[title]["variants"].append({
            "size": eu_size,
            "price": sell_price,
            "cost": {"amount": f"{cost_value:.2f}", "currencyCode": "CHF"},
            "sku": f"{base_sku}-OS" if eu_size == "One Size" else f"{base_sku}-{eu_size}",
            "quantity": valid_quantity,
            "sold_out": valid_quantity <= 0,
            "barcode": barcode,
            "express_price": express_sell_price if express_sell_price is not None else None,
            "express_available": express_sell_price is not None,
            "us_size": us_size_clean,
        })

        # SKIP express variants entirely as per requirement
        # No longer creating express/fast delivery variants
    
    # Create path filters sold-out rows later; update path keeps them for inventory sync.
    return thread_api_products

# ----------------------------------------------------------------------------
# Main program
if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Process StockX URLs to Shopify products')
    parser.add_argument('--start-url', type=str, help='URL to start processing from')
    parser.add_argument('--start-index', type=int, help='Index to start processing from')
    parser.add_argument('--reset', action='store_true', help='Reset processing state')
    parser.add_argument(
        '--reset-update-cursor',
        action='store_true',
        help='Reset update_list.cursor to 0 so the next run starts from the first line of update_list.txt',
    )
    parser.add_argument('--force-continue', action='store_true', help='Continue even if 24h limit has not passed')
    parser.add_argument('--auto-restart', action='store_true', help='Automatically restart after 24h when hitting the limit')
    parser.add_argument('--no-wait', action='store_true', help='Don\'t wait for 24h limit, restart immediately')
    parser.add_argument('--update-only', action='store_true', help='Skip partial creates; process updates only')
    parser.add_argument(
        '--no-new-variants',
        action='store_true',
        help='Skip creating missing sizes on update (saves daily variant quota). Default: create new available sizes; sold-out sizes → qty=0, never deleted.',
    )
    parser.add_argument(
        '--stop-after-url',
        type=str,
        default=None,
        metavar='SUBSTRING',
        help='Exit after this substring matches a completed URL (slug). Stops scheduling new work; waits for in-flight threads.',
    )
    parser.add_argument(
        '--only-url-file',
        type=str,
        default=None,
        metavar='PATH',
        help='Process only URLs in this file (one slug or URL per line), single pass. Skips priority queue and partials.',
    )
    parser.add_argument(
        '--update-list-once',
        action='store_true',
        help='Phase 3: walk update_list.txt once (from update_list.cursor to end), then stop. Re-run resumes where you left off. 429 still exits with normal backoff.',
    )
    parser.add_argument(
        '--sse-queue',
        action='store_true',
        help='Phase 3: process slugs queued by sse_listener.py (sse_changed_queue.txt) instead of update_list.txt. Successful update removes the slug from the queue. Combine with --sse-listen to also run the listener in-process.',
    )
    parser.add_argument(
        '--sse-listen',
        action='store_true',
        help='Spawn the KicksDB SSE listener as a background daemon thread inside this process (populates sse_changed_queue.txt). Implies --sse-queue for Phase 3 unless --update-list-once / --only-url-file also set.',
    )
    parser.add_argument(
        '--sse-topics',
        type=str,
        default=None,
        help='Comma-sep SSE topics for --sse-listen (default: price:stockx:ch). Example: price:stockx:ch,price:stockx:us',
    )
    parser.add_argument(
        '--workers',
        type=int,
        default=int(os.getenv("MAIN_WORKERS", "4")),
        help='Parallel worker threads (default 4; lower = fewer StockX timeouts)',
    )
    parser.add_argument(
        '--skip-partials',
        action='store_true',
        help='Skip partials_create/update resume (use for bulk FULLURLLIST price passes)',
    )
    parser.add_argument(
        '--skip-shopify-catalog-fetch',
        action='store_true',
        help='Do not call get_all_products(); match existing Shopify products via handle GraphQL only (smaller duplicate risk if handles align with slugs).',
    )
    parser.add_argument(
        '--full-pass',
        action='store_true',
        help='Full FULLURLLIST update: --full-360 images + force SEO/alt + metafields refresh (never changes product category on update)',
    )
    parser.add_argument(
        '--full-360',
        action='store_true',
        help='Upload all gallery_360 frames (~36 images/product) instead of 5 orbit picks. Heavy on Shopify API.',
    )
    args = parser.parse_args()

    # Enhanced processing function with 429 handling and partials support
    def run_processing_enhanced():
        global FULL_360_MODE, FULL_PASS_MODE, NO_NEW_VARIANTS_MODE
        FULL_360_MODE = args.full_360 or args.full_pass
        FULL_PASS_MODE = bool(args.full_pass)
        NO_NEW_VARIANTS_MODE = bool(args.no_new_variants)
        if FULL_360_MODE:
            print("[INFO] --full-360: using full gallery_360 strip per product (~36 frames when available).")
        if FULL_PASS_MODE:
            print("[INFO] --full-pass: 360 images + prices + express metafields + SEO/alt refresh (categories unchanged on update).")
        if NO_NEW_VARIANTS_MODE:
            print("[INFO] --no-new-variants: existing sizes only — qty=0 when off StockX, no new variant creates.")
        print("[INFO] Starting enhanced processing with partials-first architecture")
        stop_after_matched = False  # set True in Phase 3 when --stop-after-url URL completes

        if args.reset_update_cursor:
            write_update_list_cursor(0)
            print(f"[INFO] Reset {UPDATE_LIST_CURSOR_FILE} to 0 (--reset-update-cursor)")

        publications = get_all_publications()
        for pub in publications:
            print(f"Publication ID: {pub['id']}  |  Name: {pub['name']}")

        # Prefetch Shopify catalog (optional) for exact title matching + handle fallback
        if args.skip_shopify_catalog_fetch:
            shopify_products = []
            print("[INFO] --skip-shopify-catalog-fetch: skipping get_all_products() (no full catalog in memory).")
            print("[INFO] Existing products are resolved per item via get_product_by_handle (see find_existing_product).")
        else:
            print("[INFO] Fetching existing Shopify products from Shopify...")
            print("[INFO] This ensures we don't create duplicates - existing products will be updated instead")
            try:
                shopify_products = get_all_products()
                print(f"[SUCCESS] Fetched {len(shopify_products)} existing products from Shopify")
                print("[INFO] Products created before the 429 limit will be recognized and updated (not duplicated)")
            except RateLimitException as e:
                print(f"[WARNING] Hit rate limit while fetching existing products. Will retry after backoff...")
                log_event("system", "get_products", "429", reason="rate_limited", retry_after=getattr(e, 'retry_after', None),
                         shopify_response=getattr(e, 'shopify_response', None), api_status_code=getattr(e, 'api_status_code', None))
                backoff_sleep(1, getattr(e, 'retry_after', None))
                return False, None

        # Processing order: priority queue first (optional), then partials, then alternating create/update
        # 0. Process PRIORITY QUEUE first (quick-add URLs) - OPTIONAL
        if args.only_url_file:
            print("\n[INFO] Phase 0: SKIPPED (--only-url-file)")
        else:
            print("\n[INFO] Phase 0: Processing priority queue...")
            priority_urls = read_url_list("priority_list.txt")
            if priority_urls:
                print(f"[INFO] Found {len(priority_urls)} priority URLs to process first")
                created_urls = set()
                if os.path.exists("created_urls.txt"):
                    with open("created_urls.txt", "r") as f:
                        created_urls = set(line.strip() for line in f)
                
                remaining_priority_urls = []
                for url in priority_urls:
                    if url in created_urls:
                        print(f"[INFO] Priority URL already processed: {url}")
                        continue
                    try:
                        print(f"[INFO] Processing priority URL: {url}")
                        success = process_single_url_enhanced(url, "create", shopify_products)
                        if not success:
                            print(f"[INFO] Priority URL processing failed: {url}, will retry next run")
                            remaining_priority_urls.append(url)  # Keep for retry
                            continue  # Move to next priority URL
                        else:
                            print(f"[SUCCESS] Priority URL completed: {url}")
                    except RateLimitException as e:
                        print(f"[WARNING] Hit rate limit on priority URL {url}: {e}")
                        remaining_priority_urls.append(url)  # Keep for next time
                        return False, None  # Restart for 429
                    except Exception as e:
                        print(f"[ERROR] Unexpected error processing priority URL {url}: {e}")
                        log_event(url, "priority", "error", reason=str(e))
                        remaining_priority_urls.append(url)  # Keep for retry
                        continue
                
                # Update priority list with remaining URLs
                write_url_list("priority_list.txt", remaining_priority_urls)
                if not remaining_priority_urls:
                    print("[SUCCESS] All priority URLs processed!")
            else:
                print("[INFO] No priority URLs found - continuing with normal processing")
        
        # 1. Process partials_create.jsonl (SKIP if --update-only flag is set)
        if args.only_url_file:
            print("\n[INFO] Phase 1: SKIPPED (--only-url-file)")
        elif args.update_only:
            print("\n[INFO] Phase 1: SKIPPED - Update-only mode enabled (--update-only flag)")
            partials_create = load_partials("partials_create.jsonl")
            if partials_create:
                print(f"[INFO] ⚠️  Skipping {len(partials_create)} partial create entries to avoid variant creation limit")
                print(f"[INFO] These will be processed when you run without --update-only flag")
        else:
            print("\n[INFO] Phase 1: Processing partial create entries...")
            partials_create = load_partials("partials_create.jsonl")
            if partials_create:
                print(f"[INFO] Found {len(partials_create)} partial create entries")
                for partial in partials_create:
                    url = partial.get("url", "")
                    product_id = partial.get("shopify_product_id", "")
                    pending_skus = partial.get("pending_skus", [])
                    completed_skus = partial.get("completed_skus", [])
                    
                    print(f"[INFO] Resuming partial create for {url}")
                    log_event(url, "resume_partial", "started", reason="partial_create")
                    
                    try:
                        success = process_partial_product(url, product_id, pending_skus, completed_skus, "create", shopify_products)
                        if success:
                            # Remove from partials file and add to created_urls.txt
                            remove_jsonl_by_url("partials_create.jsonl", url)
                            append_created_url(url)
                            log_event(url, "resume_partial", "ok", reason="partial_create_completed")
                        else:
                            log_event(url, "resume_partial", "error", reason="partial_create_failed")
                    except RateLimitException as e:
                        log_event(url, "resume_partial", "429", reason="rate_limited", retry_after=getattr(e, 'retry_after', None))
                        print(f"[WARNING] Hit 429 during partial processing. Backing off...")
                        backoff_sleep(1, getattr(e, 'retry_after', None))
                        return False, None
                    except Exception as e:
                        log_event(url, "resume_partial", "error", reason=str(e))
                        print(f"[ERROR] Failed to process partial create {url}: {e}")
        
        # 2. Process partials_update.jsonl
        bulk_path_for_partials = None
        bulk_url_set = None
        if args.only_url_file:
            bulk_path_for_partials = args.only_url_file
            if not os.path.isfile(bulk_path_for_partials):
                _script_dir = os.path.dirname(os.path.abspath(__file__))
                alt = os.path.join(_script_dir, bulk_path_for_partials)
                if os.path.isfile(alt):
                    bulk_path_for_partials = alt
            if os.path.isfile(bulk_path_for_partials):
                bulk_url_set = set(read_url_list(bulk_path_for_partials))
                print(f"\n[INFO] Phase 2: Resuming partial updates for --only-url-file ({len(bulk_url_set)} slugs)")
            else:
                print("\n[INFO] Phase 2: SKIPPED (--only-url-file path missing)")
        else:
            print("\n[INFO] Phase 2: Processing partial update entries...")

        if args.skip_partials:
            print("\n[INFO] Phase 2: SKIPPED (--skip-partials)")
        elif bulk_url_set is not None or not args.only_url_file:
            partials_update = load_partials("partials_update.jsonl")
            if partials_update:
                if bulk_url_set is not None:
                    partials_update = [p for p in partials_update if p.get("url") in bulk_url_set]
                print(f"[INFO] Found {len(partials_update)} partial update entries")
                for partial in partials_update:
                    url = partial.get("url", "")
                    product_id = partial.get("shopify_product_id", "")
                    pending_skus = partial.get("pending_skus", [])
                    completed_skus = partial.get("completed_skus", [])
                    
                    print(f"[INFO] Resuming partial update for {url}")
                    log_event(url, "resume_partial", "started", reason="partial_update")
                    
                    try:
                        success = process_partial_product(url, product_id, pending_skus, completed_skus, "update", shopify_products)
                        if success:
                            # Remove from partials file
                            remove_jsonl_by_url("partials_update.jsonl", url)
                            log_event(url, "resume_partial", "ok", reason="partial_update_completed")
                        else:
                            log_event(url, "resume_partial", "error", reason="partial_update_failed")
                    except RateLimitException as e:
                        log_event(url, "resume_partial", "429", reason="rate_limited", retry_after=getattr(e, 'retry_after', None))
                        print(f"[WARNING] Hit 429 during partial processing. Backing off...")
                        backoff_sleep(1, getattr(e, 'retry_after', None))
                        return False, None
                    except Exception as e:
                        log_event(url, "resume_partial", "error", reason=str(e))
                        print(f"[ERROR] Failed to process partial update {url}: {e}")

        # 3. Process alternating create/update URLs (or UPDATE-ONLY mode)
        if args.only_url_file:
            print("\n[INFO] Phase 3: Processing URLs from --only-url-file (single pass, update-or-create)")
        elif args.update_list_once:
            print("\n[INFO] Phase 3: Single pass over update_list.txt (--update-list-once), then exit")
        elif args.sse_queue or (args.sse_listen and not args.update_only):
            print("\n[INFO] Phase 3: Processing SSE-queued slugs (sse_changed_queue.txt, single pass)")
        elif args.update_only:
            print("\n[INFO] Phase 3: Processing UPDATE-ONLY URLs (--update-only flag enabled)...")
            print("[INFO] 🔄 Skipping all create operations to avoid variant creation limit")
        else:
            print("\n[INFO] Phase 3: Processing alternating create/update URLs...")
        
        # Start SSE listener thread if requested (populates sse_changed_queue.txt while we work)
        if args.sse_listen:
            start_sse_listener_thread(topics=args.sse_topics)
        
        if args.stop_after_url:
            print(f"[INFO] --stop-after-url active: will exit after URL containing {args.stop_after_url!r} finishes processing.")
        
        # Read already created URLs to skip them
        created_urls = set()
        if os.path.exists("created_urls.txt"):
            with open("created_urls.txt", "r", encoding="utf-8") as f:
                created_urls = {line.strip() for line in f if line.strip()}
        
        processed_count = 0
        success_count = 0  # SAFETY: Track actual successes to prevent endless loops
        consecutive_failures = 0  # SAFETY: Track consecutive failures
        
        # Parallel processing (default 4 — 6 threads often overload Kicks API)
        max_workers = max(1, int(args.workers or 4))
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        futures = {}
        
        single_pass_bulk_file = False
        bulk_file_exhausted = False
        bulk_path = None
        update_list_once_mode = bool(args.update_list_once)
        if args.only_url_file:
            if update_list_once_mode:
                print("[ERROR] Cannot combine --only-url-file with --update-list-once.")
                executor.shutdown(wait=False)
                return False, None
            bulk_path = args.only_url_file
            if not os.path.isfile(bulk_path):
                _script_dir = os.path.dirname(os.path.abspath(__file__))
                alt = os.path.join(_script_dir, bulk_path)
                if os.path.isfile(alt):
                    bulk_path = alt
            if not os.path.isfile(bulk_path):
                print(f"[ERROR] --only-url-file not found: {args.only_url_file!r} (cwd={os.getcwd()})")
                executor.shutdown(wait=False)
                return False, None
            url_gen = bulk_url_file_generator(bulk_path, start_url=args.start_url)
            single_pass_bulk_file = True
        elif update_list_once_mode:
            url_gen = update_list_single_pass_generator()
        elif args.sse_queue or (args.sse_listen and not args.update_only):
            url_gen = sse_queue_generator()
        elif args.update_only:
            url_gen = updates_only_generator()
        else:
            url_gen = alternating_url_generator()
        
        phase3_single_pass = single_pass_bulk_file or update_list_once_mode or args.sse_queue or (args.sse_listen and not args.update_only)
        
        resolved_bulk_path = bulk_path if single_pass_bulk_file else None
        if phase3_single_pass and single_pass_bulk_file:
            url_list_len = len(read_url_list(resolved_bulk_path))
            cursor_enabled = True
            _c = read_bulk_url_cursor(resolved_bulk_path, url_list_len)
            print(
                f"[INFO] bulk file resume: next line index {_c} of {url_list_len} "
                f"(0-based; persisted in {bulk_url_cursor_path(resolved_bulk_path)})"
            )
        elif phase3_single_pass and update_list_once_mode:
            url_list_len = len(read_url_list(UPDATE_LIST_FILE))
            cursor_enabled = True
            _c = read_update_list_cursor(url_list_len)
            print(
                f"[INFO] update_list resume: next line index {_c} of {url_list_len} "
                f"(0-based; persisted in {UPDATE_LIST_CURSOR_FILE})"
            )
        elif args.sse_queue or (args.sse_listen and not args.update_only):
            # SSE queue mode: no cursor — slugs are removed from sse_changed_queue.txt on success.
            url_list_len = len(read_sse_queue())
            cursor_enabled = False
            _c = 0
            print(f"[INFO] SSE queue mode: {url_list_len} slugs queued. No cursor (slug removed on success).")
        else:
            url_list_len = len(read_url_list(UPDATE_LIST_FILE))
            cursor_enabled = not args.only_url_file
            _c = read_update_list_cursor(url_list_len) if cursor_enabled else 0
            if cursor_enabled:
                print(
                    f"[INFO] update_list resume: next line index {_c} of {url_list_len} "
                    f"(0-based; persisted in {UPDATE_LIST_CURSOR_FILE})"
                )

        if cursor_enabled and phase3_single_pass and _c >= url_list_len:
            print(f"[INFO] Single-pass URL file already complete ({_c} >= {url_list_len}). Nothing to do.")
            executor.shutdown(wait=False)
            return True, "file_complete"

        def _persist_cursor(next_index):
            if single_pass_bulk_file and resolved_bulk_path:
                write_bulk_url_cursor(resolved_bulk_path, next_index)
            else:
                write_update_list_cursor(next_index)

        tracker = {
            "next_commit": _c if cursor_enabled else 0,
            "done": set(),
            "enabled": cursor_enabled,
            "n": url_list_len,
            "single_pass": phase3_single_pass,
            "write_cursor": _persist_cursor,
        }

        def on_update_success(idx):
            if not tracker["enabled"] or idx is None:
                return
            tracker["done"].add(idx)
            n = tracker["n"]
            if n <= 0:
                return
            while tracker["next_commit"] in tracker["done"]:
                tracker["done"].discard(tracker["next_commit"])
                tracker["next_commit"] += 1
                if tracker["next_commit"] >= n:
                    if tracker.get("single_pass"):
                        tracker["next_commit"] = n
                        break
                    tracker["next_commit"] = 0
            tracker["write_cursor"](tracker["next_commit"])

        print(f"[INFO] Parallel processing: {max_workers} threads")
        
        # Submit initial batch
        for _ in range(max_workers * 2):
            try:
                url, action_type, update_idx = next(url_gen)
                if action_type == "create" and url in created_urls:
                    continue
                print(f"\n[INFO] Queuing {action_type}: {url}")
                log_event(url, action_type, "started")
                # Pass skip_creates_on_limit=True to allow deferring creates when limit is hit
                future = executor.submit(process_single_url_enhanced, url, action_type, shopify_products, skip_creates_on_limit=True)
                futures[future] = (url, action_type, update_idx)
            except StopIteration:
                bulk_file_exhausted = True
                break
        
        # Process as they complete
        # Keep processing even if futures list becomes empty temporarily (generator might be waiting)
        consecutive_empty_iterations = 0
        while True:
            if stop_after_matched and not futures:
                print(f"\n{'='*70}")
                print(f"[STOP] --stop-after-url: matched {args.stop_after_url!r}; in-flight work finished. Exiting Phase 3.")
                print(f"{'='*70}\n")
                break
            if phase3_single_pass and bulk_file_exhausted and not futures:
                if update_list_once_mode:
                    print("[INFO] --update-list-once finished (single pass complete).")
                else:
                    print("[INFO] Bulk URL file finished (single pass).")
                break
            # If no futures, try to get more URLs from generator
            if not futures:
                if phase3_single_pass and bulk_file_exhausted:
                    break
                consecutive_empty_iterations += 1
                if consecutive_empty_iterations > 10:
                    # After 10 empty iterations, wait longer before checking again
                    print("[INFO] No active futures. Waiting 30 seconds before checking for more URLs...")
                    time.sleep(30)
                    consecutive_empty_iterations = 0
                    # Re-read URL lists in case new URLs were added
                    if phase3_single_pass:
                        pass
                    elif args.update_only:
                        url_gen = updates_only_generator()
                    else:
                        url_gen = alternating_url_generator()
                    tracker["n"] = len(read_url_list(UPDATE_LIST_FILE))
                    if cursor_enabled:
                        tracker["next_commit"] = read_update_list_cursor(tracker["n"])
                        tracker["done"] = set()
                
                # Try to get new URLs
                for _ in range(max_workers * 2):
                    try:
                        url, action_type, update_idx = next(url_gen)
                        if action_type == "create" and url in created_urls:
                            continue
                        print(f"\n[INFO] Queuing {action_type}: {url}")
                        log_event(url, action_type, "started")
                        future = executor.submit(process_single_url_enhanced, url, action_type, shopify_products, skip_creates_on_limit=True)
                        futures[future] = (url, action_type, update_idx)
                        consecutive_empty_iterations = 0  # Reset counter
                    except StopIteration:
                        bulk_file_exhausted = True
                        if not phase3_single_pass:
                            time.sleep(5)
                        break
                
                # If still no futures after trying, wait a bit more
                if not futures:
                    if phase3_single_pass and bulk_file_exhausted:
                        break
                    time.sleep(10)
                    continue
            
            # Process completed futures
            done, _ = concurrent.futures.wait(futures.keys(), return_when=concurrent.futures.FIRST_COMPLETED, timeout=1.0)
            
            if not done:
                # Timeout - no futures completed yet, continue loop
                continue
            
            for future in done:
                url, action_type, update_idx = futures.pop(future)
                
                try:
                    success = future.result()
                except RateLimitException as e:
                    error_msg = str(e).lower()
                    
                    # Check if this is specifically variant creation limit
                    if is_variant_creation_limit(e) and action_type == "create":
                        print(f"[INFO] ⏸️  Variant creation limit hit for {url}")
                        print(f"[INFO] Deferring create to deferred_creates.txt")
                        append_deferred_create(url)
                        log_event(url, action_type, "deferred", reason="variant_creation_limit")
                        
                        # Switch to updates-only mode (not when running a one-shot file list)
                        if single_pass_bulk_file or update_list_once_mode:
                            print("[INFO] Bulk / single-pass mode: create deferred; remaining queued URLs keep file order.")
                        else:
                            print(f"[INFO] 🔄 Switching to UPDATES-ONLY mode (skipping all creates)")
                            url_gen = updates_only_generator()
                            tracker["n"] = len(read_url_list(UPDATE_LIST_FILE))
                            if cursor_enabled:
                                tracker["next_commit"] = read_update_list_cursor(tracker["n"])
                                tracker["done"] = set()
                            print(f"[INFO] Continue processing updates only...")
                        continue  # Continue with next future, don't stop everything
                    else:
                        # Other 429 errors (general rate limit) - use existing behavior
                        print(f"[CRITICAL] 429 in thread! URL: {url}")
                        log_event(url, action_type, "429", reason="rate_limited", retry_after=getattr(e, 'retry_after', None))
                        executor.shutdown(wait=False, cancel_futures=True)
                        backoff_sleep(1, getattr(e, 'retry_after', None))
                        return False, None
                except Exception as e:
                    print(f"[ERROR] Thread error {url}: {e}")
                    append_error_url(url, f"{action_type}_exception: {str(e)}")
                    if action_type == "create":
                        remove_url_from_create_list(url)
                    log_event(url, action_type, "error")
                    consecutive_failures += 1
                    success = False
                
                if success is None:
                    # URL was deferred (variant creation limit)
                    print(f"[INFO] URL deferred (will retry later): {url}")
                    # Don't increment counters, just continue
                    continue
                elif success:
                    # CRITICAL FIX: Always move URLs to completed status regardless of auto-conversion
                    # For ANY successful operation (create, update, or auto-converted), move URL to completed
                    append_created_url(url)
                    
                    if action_type == "create":
                        remove_url_from_create_list(url)  # Remove from create list
                        print(f"[INFO] Moved URL from create_list to created_urls: {url}")
                    else:
                        print(f"[INFO] Tracked completed operation: {url}")
                        on_update_success(update_idx)
                        # SSE queue mode: remove slug from queue on success
                        if args.sse_queue or (args.sse_listen and not args.update_only):
                            removed = remove_slug_from_sse_queue(url)
                            if removed:
                                print(f"[INFO] SSE queue: removed {url} ({removed} line(s))")
                    
                    # ok + title logged inside create_product_enhanced / update_product_enhanced
                    processed_count += 1
                    success_count += 1  # SAFETY: Increment success counter
                    consecutive_failures = 0  # SAFETY: Reset failure counter
                else:
                    consecutive_failures += 1
                    print(f"[WARNING] Failed/skipped: {url}")
                
                if args.stop_after_url and args.stop_after_url in url:
                    stop_after_matched = True
                    print(f"\n[INFO] --stop-after-url: completed URL matches {args.stop_after_url!r} → {url}")
                
                # Submit new work
                if not stop_after_matched:
                    try:
                        next_url, next_action, next_update_idx = next(url_gen)
                        if not (next_action == "create" and next_url in created_urls):
                            print(f"\n[INFO] Queuing {next_action}: {next_url}")
                            log_event(next_url, next_action, "started")
                            new_future = executor.submit(
                                process_single_url_enhanced, next_url, next_action, shopify_products, skip_creates_on_limit=True
                            )
                            futures[new_future] = (next_url, next_action, next_update_idx)
                    except StopIteration:
                        bulk_file_exhausted = True
                        if phase3_single_pass:
                            pass
                        else:
                            # Generator exhausted - wait a bit and try to reinitialize
                            print("[WARNING] URL generator exhausted. Waiting 5 seconds before checking for more URLs...")
                            time.sleep(5)
                            # Try to get a new URL (generator should loop or wait)
                            try:
                                next_url, next_action, next_update_idx = next(url_gen)
                                if not (next_action == "create" and next_url in created_urls):
                                    print(f"\n[INFO] Queuing {next_action}: {next_url}")
                                    log_event(next_url, next_action, "started")
                                    new_future = executor.submit(
                                        process_single_url_enhanced,
                                        next_url,
                                        next_action,
                                        shopify_products,
                                        skip_creates_on_limit=True,
                                    )
                                    futures[new_future] = (next_url, next_action, next_update_idx)
                            except StopIteration:
                                # Still exhausted - wait longer and continue loop
                                print("[WARNING] Still no URLs available. Waiting 30 seconds...")
                                time.sleep(30)
                                # Continue the loop - futures might still be processing
                                pass
            
            # SAFETY CHECK: Prevent endless loops without actual progress
            if consecutive_failures >= 50:
                print(f"[CRITICAL] SAFETY STOP: {consecutive_failures} consecutive failures!")
                log_event("system", "safety_stop", "error", reason=f"consecutive_failures_{consecutive_failures}")
                executor.shutdown(wait=True)
                return False, "safety_stop"
        
        # Clean shutdown
        executor.shutdown(wait=True)
        print(f"\n[INFO] Cycle complete. Processed {processed_count} URLs, {success_count} successful.")
        if stop_after_matched:
            return True, "stop_after_url"
        if phase3_single_pass and bulk_file_exhausted:
            if tracker["enabled"]:
                tracker["write_cursor"](tracker["n"])
            try:
                write_pass_report()
            except Exception as e:
                print(f"[WARNING] pass report failed: {e}")
            return True, "file_complete"
        return False, None

    # Main execution with auto-restart capability
    if args.auto_restart:
        print("[INFO] Running in auto-restart mode. Will continue after 24h limits automatically.")
        print("[INFO] NOTE: On restart, all Shopify products are fetched fresh to prevent duplicates.")
        print("[INFO]      Products created before 429 will be recognized and updated (not recreated).")
        
        while True:
            # Check for manual stop signal before starting/restarting
            if os.path.exists('.stop_process'):
                print("[INFO] Stop signal detected. Exiting auto-restart loop.")
                os.remove('.stop_process')
                break
                
            completed, last_limit_time = run_processing_enhanced()
            
            if last_limit_time == "stop_after_url":
                print("[INFO] --stop-after-url triggered; exiting auto-restart loop.")
                break

            if last_limit_time == "file_complete":
                print("[INFO] URL file fully processed. Exiting auto-restart loop.")
                break

            if completed:
                print("[INFO] Processing cycle completed. Continuing with next cycle...")
                continue

            if os.path.exists('.stop_process'):
                print("[INFO] Stop signal detected. Exiting auto-restart loop.")
                os.remove('.stop_process')
                break

            if last_limit_time == "safety_stop":
                wait_time = 120
                print(f"[WARNING] Safety stop (not 429). Retrying in {wait_time}s...")
            elif args.no_wait:
                wait_time = 60
                print(f"[INFO] --no-wait: retry in {wait_time}s...")
            else:
                # Real 429 already slept 24h inside run_processing via backoff_sleep()
                wait_time = 60
                print(f"[INFO] Run ended after rate-limit backoff. Retry in {wait_time}s...")

            rate_limit_until = time.time() + wait_time
            with open('.rate_limit_until', 'w') as f:
                f.write(str(rate_limit_until))

            end_time = datetime.datetime.now() + datetime.timedelta(seconds=wait_time)
            stop_requested = False
            while datetime.datetime.now() < end_time:
                if os.path.exists('.stop_process'):
                    print(f"\n[INFO] Stop signal detected during countdown. Exiting.")
                    os.remove('.stop_process')
                    try:
                        os.remove('.rate_limit_until')
                    except FileNotFoundError:
                        pass
                    stop_requested = True
                    break

                remaining = (end_time - datetime.datetime.now()).total_seconds()
                if wait_time >= 3600:
                    hours_left = int(remaining // 3600)
                    minutes_left = int((remaining % 3600) // 60)
                    seconds_left = int(remaining % 60)
                    sys.stdout.write(f"\r[INFO] Restarting in: {hours_left:02d}:{minutes_left:02d}:{seconds_left:02d}")
                else:
                    sys.stdout.write(f"\r[INFO] Restarting in: {int(remaining)}s")
                sys.stdout.flush()
                time.sleep(1)

            sys.stdout.write("\r" + " " * 60 + "\r")

            if stop_requested:
                break

            try:
                os.remove('.rate_limit_until')
            except FileNotFoundError:
                pass

            print("[INFO] Restarting processing...")
    else:
        # Run once without auto-restart
        run_processing_enhanced()
