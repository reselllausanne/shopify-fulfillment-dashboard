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
    create_product,
    create_variants_bulk,
    add_images_to_product,
    get_product_variants,
    calc_touch_price,
    calc_sell_price,
    update_variants_bulk,
    get_first_option_id_of_product,
    set_product_metafield,
    extract_product_attributes,
    set_product_metafields,
    set_standard_metafields,
    get_taxonomy_category_id,
    get_category_attributes,
    map_stockx_to_shopify_category,
    update_product_description,
    publish_product_to_channels,
    get_all_publications,
    adjust_inventory_quantity,
    get_first_location_id,
    delete_variants_bulk,
    RateLimitException,
    _run_query
)
location_id = get_first_location_id()

from stockXAPI import getOne
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
# All files are human-readable text/JSON for easy inspection
# ----------------------------------------------------------------------------

# Helper constants for filtering fast delivery variants
FAST_DELIVERY_KEYWORDS = ["express", "fast delivery", "fast shipping", "fast", "expedited", "next day", "24h", "same day", "priority"]

def is_fast_delivery(text):
    """Check if variant title contains fast delivery keywords (case-insensitive)"""
    if not text:
        return False
    text_lower = str(text).lower()
    return any(keyword in text_lower for keyword in FAST_DELIVERY_KEYWORDS)

def filter_variants(variants):
    """Filter out invalid variants: zero price, zero qty, fast delivery"""
    filtered = []
    for variant in variants:
        # Check for fast delivery keywords in title/name
        title = variant.get("title") or variant.get("name") or variant.get("size") or ""
        if is_fast_delivery(title):
            continue
            
        # Check for valid price (> 0)
        price = float(variant.get("price") or 0)
        if price <= 0:
            continue
            
        # Check for valid quantity (> 0) 
        qty = int(variant.get("quantity") or variant.get("inventory_quantity") or 0)
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

def log_event(url, action, status, reason=None, attempt=1, retry_after=None, pending_skus=None, completed_skus=None, shopify_response=None, api_status_code=None):
    """Log an event to logs.jsonl with full Shopify API response details for 429 verification"""
    import datetime
    
    event = {
        "ts": datetime.datetime.now().isoformat(),
        "url": url,
        "action": action,
        "status": status,
        "attempt": attempt
    }
    
    if reason:
        event["reason"] = reason
    if retry_after:
        event["retry_after"] = retry_after
    if pending_skus:
        event["pending_skus"] = pending_skus
    if completed_skus:
        event["completed_skus"] = completed_skus
    
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
    
    append_jsonl("logs.jsonl", event)

def append_created_url(url):
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

def append_error_url(url, reason="unknown_error"):
    """Append URL to errors_url.txt atomically with reason"""
    tmp_path = "errors_url.txt.tmp"
    
    # Read existing URLs
    existing_urls = []
    if os.path.exists("errors_url.txt"):
        with open("errors_url.txt", "r", encoding="utf-8") as f:
            existing_urls = f.readlines()
    
    # Write all URLs + new one to temp file
    with open(tmp_path, "w", encoding="utf-8") as f:
        for url_line in existing_urls:
            f.write(url_line)
        f.write(f"{url.strip()} # {reason}\n")
    
    # Atomic replace
    os.replace(tmp_path, "errors_url.txt")

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

def alternating_url_generator():
    """Generator that alternates between create and update URLs, then loops indefinitely on updates"""
    create_urls = read_url_list("create_list.txt")  # Main create URLs list
    update_urls = read_url_list("update_list.txt")  # Manually curated update URLs
    
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
            yield url, "create"
        print("[INFO] All create URLs processed. Waiting 5 minutes before checking for new URLs...")
        while True:
            time.sleep(300)  # Wait 5 minutes
            # Re-read both lists in case new URLs were added
            create_urls = read_url_list("create_list.txt")
            update_urls = read_url_list("update_list.txt")
            # Filter out already created URLs
            created_urls = set()
            if os.path.exists("created_urls.txt"):
                with open("created_urls.txt", "r", encoding="utf-8") as f:
                    created_urls = {line.strip() for line in f if line.strip()}
            create_urls = [url for url in create_urls if url not in created_urls]
            if create_urls:
                print(f"[INFO] Found {len(create_urls)} new create URLs. Processing...")
                for url in create_urls:
                    yield url, "create"
                print("[INFO] All create URLs processed. Waiting 5 minutes...")
            elif update_urls:
                print(f"[INFO] Found {len(update_urls)} update URLs. Switching to alternating mode...")
                break
            else:
                print("[INFO] No new URLs found. Waiting 5 minutes...")
    
    create_iter = iter(create_urls)
    update_iter = iter(update_urls)
    use_create = True
    create_exhausted = False
    
    while True:
        got_url = False
        
        # Phase 1: Alternate between create and update until create list is exhausted
        if not create_exhausted:
            if use_create:
                try:
                    yield next(create_iter), "create"
                    got_url = True
                except StopIteration:
                    create_exhausted = True
                    print("[INFO] Create list exhausted - switching to update-only mode")
            else:
                try:
                    yield next(update_iter), "update"
                    got_url = True
                except StopIteration:
                    # Reset update iterator to loop indefinitely
                    update_iter = iter(update_urls)
                    try:
                        yield next(update_iter), "update"
                        got_url = True
                    except StopIteration:
                        # No update URLs available
                        if create_exhausted:
                            print("[WARNING] No update URLs available and create list exhausted. Waiting...")
                            time.sleep(60)  # Wait 1 minute and continue
                            continue
        
        # Phase 2: Create list exhausted - loop indefinitely on updates only
        if create_exhausted:
            try:
                yield next(update_iter), "update"
                got_url = True
            except StopIteration:
                # Reset update iterator to loop indefinitely
                update_iter = iter(update_urls)
                if update_urls:  # Only if we have update URLs
                    try:
                        yield next(update_iter), "update"
                        got_url = True
                    except StopIteration:
                        pass
                
                if not got_url:
                    print("[INFO] No update URLs available. Waiting 5 minutes before checking again...")
                    time.sleep(300)  # Wait 5 minutes
                    # Re-read update list in case new URLs were added
                    update_urls = read_url_list("update_list.txt")
                    update_iter = iter(update_urls)
                    continue
        
        # If we didn't get a URL and create is not exhausted, try the other side
        if not got_url and not create_exhausted:
            if use_create:
                try:
                    yield next(update_iter), "update"
                    got_url = True
                except StopIteration:
                    update_iter = iter(update_urls)
                    try:
                        yield next(update_iter), "update"
                        got_url = True
                    except StopIteration:
                        pass
            else:
                try:
                    yield next(create_iter), "create"
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

def find_existing_product(title, product_info, shopify_products):
    """SAFE product matching - EXACT matches only to prevent product corruption"""
    print(f"[DEBUG] Looking for existing product: '{title}'")
    
    # CRITICAL: Check if product_info is not None before accessing it
    if product_info is None:
        print(f"[DEBUG] product_info is None, skipping matching")
        return None
    
    # Strategy 1: EXACT title match (case-insensitive) - ONLY safe matching
    normalized_title = title.strip().lower()
    for p in shopify_products:
        if p.get("title") and p["title"].strip().lower() == normalized_title:
            print(f"[DEBUG] Found EXACT title match: '{p['title']}'")
            return p
    
    # Strategy 2: EXACT handle match - handles are unique and safe
    handle = (product_info.get("handle") or "").strip()
    if handle:
        try:
            by_handle = get_product_by_handle(handle)  # must return None if not found
            if by_handle:
                print(f"[DEBUG] Found product by EXACT handle '{handle}': {by_handle.get('title')}")
                return by_handle
        except Exception as e:
            print(f"[DEBUG] productByHandle lookup failed for '{handle}': {e}")
    
    # REMOVED: All fuzzy matching and SKU partial matching to prevent product corruption
    # These were causing wrong products to be matched and variants to be replaced incorrectly
    
    print(f"[DEBUG] No EXACT match found for: '{title}' - will create NEW product")
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
                        variants_to_create.append(variant)
                
                if variants_to_update:
                    update_variants_bulk(product_id, variants_to_update)
                if variants_to_create:
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
    """Generator that only yields update URLs (for when creation limit is hit)"""
    update_urls = read_url_list("update_list.txt")
    update_iter = iter(update_urls)
    
    print("[INFO] 📝 Updates-only mode: Skipping all creates, processing updates only")
    
    while True:
        try:
            yield next(update_iter), "update"
        except StopIteration:
            # Loop back to beginning
            update_iter = iter(update_urls)
            if not update_urls:
                print("[INFO] No update URLs available. Waiting...")
                time.sleep(60)
                continue

def process_single_url_enhanced(url, action_type, shopify_products, skip_creates_on_limit=False):
    """Process a single URL for create or update with enhanced error handling
    
    Args:
        skip_creates_on_limit: If True and creation limit is hit, defer the URL instead of raising
    """
    try:
        # Stop condition: stop when processing this specific LEGO URL
        if "lego-marvel-super-heroes-iron-skull-sub-attack-set-76048" in url:
            print(f"\n{'='*70}")
            print(f"[STOP] Reached target URL: {url}")
            print(f"[STOP] Stopping automation as requested...")
            print(f"{'='*70}\n")
            import sys
            sys.exit(0)
        
        # Fetch and process the product data
        product_data = process_url(url, 0)
        if not product_data:
            print(f"[WARNING] No valid product data for {url}")
            log_event(url, action_type, "skipped", reason="no_data")
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
            if not product_info.get("variants"):
                print(f"[WARNING] No valid variants for {title}, skipping")
                log_event(url, action_type, "skipped", reason="no_valid_variants")
                continue
                
            # Find existing product with ENHANCED matching
            existing_product = find_existing_product(title, product_info, shopify_products)
            
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
                    # Update requested but product doesn't exist - try to create it
                    print(f"[INFO] Update requested for {title} but product not found in Shopify - will CREATE instead")
                    log_event(url, "update", "skipped", reason="product_not_found_converting_to_create")
                    log_event(url, "create", "started", reason="auto_converted_from_update")
                    try:
                        return create_product_enhanced(url, title, product_info)
                    except RateLimitException as e:
                        if "variant creation limit" in str(e).lower() or "daily limit" in str(e).lower():
                            if skip_creates_on_limit:
                                print(f"[INFO] ⏸️  Variant creation limit hit for {url}")
                                print(f"[INFO] Deferring create to deferred_creates.txt")
                                append_deferred_create(url)
                                log_event(url, "create", "deferred", reason="variant_creation_limit_auto_convert")
                                return None
                        raise
                
    except RateLimitException as e:
        raise  # Re-raise rate limit errors
    except Exception as e:
        print(f"[ERROR] Failed to process {action_type} {url}: {e}")
        log_event(url, action_type, "error", reason=str(e))
        return False
    
    return True

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
        
        # FIX 5: Add only the first image during creation (as per user requirement)
        first_image = [product_info["images"][0]] if product_info.get("images") else []
        if first_image:
            add_images_to_product(product_id, first_image)
        
        # Set STANDARD product attributes (best for Google Merchant Center)
        stockx_raw_data = product_info.get("__raw_vendor__", {})
        if stockx_raw_data:
            attributes = extract_product_attributes(stockx_raw_data)
            set_standard_metafields(product_id, attributes)
            print(f"[INFO] Set standard metafields: Gender={attributes.get('target-gender')}, Color={attributes.get('color-pattern')}, Activity={attributes.get('activity')}")
        
        # Keep old category metafield for backwards compatibility
        stockx_category = product_info.get("productCategory", "sneakers")
        set_product_metafield(product_id, stockx_category)
        update_product_description(product_id, product_info["description"])
        
        # Create variants with partial state tracking
        try:
            all_variant_skus = [v["sku"] for v in product_info["variants"]]
            create_response = create_variants_bulk(product_id, option_id, product_info["variants"])

            # Double-check that at least one variant exists before publishing
            created_variants = get_product_variants(product_id) or []
            if len(created_variants) == 0:
                print(f"[ERROR] Product {title} has 0 variants after creation. Not publishing.")
                log_event(url, "create", "error", reason="zero_variants_post_create")
                return False

            # Publish product only when we have variants
            publish_product_to_channels(product_id)

            print(f"[SUCCESS] Created product {title} with {len(created_variants)} variants")
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
        product_variants = get_product_variants(product_id)
        variants_to_update = []
        variants_to_create = []
        
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
        if stockx_raw_data:
            try:
                attributes = extract_product_attributes(stockx_raw_data)
                set_standard_metafields(product_id, attributes)
                print(f"[INFO] Updated standard metafields: Gender={attributes.get('target-gender')}, Color={attributes.get('color-pattern')}, Activity={attributes.get('activity')}")
            except Exception as e:
                print(f"[WARNING] Failed to update product attributes: {e}")
        
        # SKIP taxonomy category updates - user has manually corrected categories
        # Category is ONLY set during product creation, not updates
        print(f"[INFO] Skipping category update for existing product (categories manually corrected)")
        
        # Apply filtering to new variants (already filtered in process_url)
        new_variants = product_info.get("variants", [])
        if not new_variants:
            print(f"[WARNING] No variants in product_info for {title}")
            return False
        
        # Process each new variant
        for variant in new_variants:
            size_title = variant["size"]
            new_price = variant["price"]
            new_barcode = variant.get("barcode", "")
            matched_variant = next((v for v in product_variants if v["title"] == size_title), None)
            
            print(f"[UPDATE PRICE] {title} - Size {size_title}: NEW PRICE = {new_price} CHF")
            
            if matched_variant:
                old_price = matched_variant.get("price", "N/A")
                print(f"[UPDATE PRICE] {title} - Size {size_title}: {old_price} -> {new_price} CHF")
                
                # Use the pre-calculated cost from variant data (StockX price * 1.07 + 20)
                cost_value = variant.get("cost", {}).get("amount", float(new_price) * 0.80)
                
                update_data = {
                    "id": matched_variant["id"],
                    "price": str(new_price),
                    "quantity": variant["quantity"],
                    "inventoryItem": {"cost": str(cost_value)}
                }
                # Add barcode if provided from StockX and not already set or different
                if new_barcode and (not matched_variant.get("barcode") or matched_variant.get("barcode") != new_barcode):
                    update_data["barcode"] = new_barcode
                    print(f"[INFO] Updating barcode for {size_title}: {new_barcode}")
                variants_to_update.append(update_data)
            else:
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
                    "barcode": new_barcode
                })
        
        # Set quantities to 0 for variants no longer in new data
        new_variant_titles = {v["size"] for v in new_variants}
        variants_to_remove = [v for v in product_variants if v["title"] not in new_variant_titles]
        
        # CRITICAL: Also remove any existing EXPRESS/FAST DELIVERY variants
        express_variants_to_remove = [v for v in product_variants if is_fast_delivery(v["title"])]
        for v in express_variants_to_remove:
            if v not in variants_to_remove:  # Avoid duplicates
                variants_to_remove.append(v)
                print(f"[INFO] Found existing EXPRESS variant to remove: {v['title']} (ID: {v['id']})")
        
        # NEW: Prefer hard delete for express/unwanted variants to avoid extra API/logic
        delete_variant_ids = [v["id"] for v in variants_to_remove]
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
                print(f"[WARNING] Bulk delete failed ({e}); falling back to safe quantity=0 updates for {len(delete_variant_ids)} variants")
                # Fallback: Set quantity 0, keep price high to avoid 0 CHF
                for v in variants_to_remove:
                    current_price = v.get("price", "999.99")
                    if float(current_price or 0) <= 0:
                        current_price = "999.99"
                    variants_to_update.append({
                        "id": v["id"],
                        "price": current_price,
                        "quantity": 0,
                        "inventoryItem": {"cost": str(float(current_price) * 0.80)}
                    })
                    if is_fast_delivery(v["title"]):
                        print(f"[INFO] EXPRESS variant fallback set qty=0: {v['title']}")
                    else:
                        print(f"[INFO] Fallback set qty=0: {v['title']}")
        
        # Execute updates and creations (FULL SYNC MODE for main.py automation)
        if variants_to_update:
            try:
                update_variants_bulk(product_id, variants_to_update)
                
                # Adjust inventory quantities
                location_id = get_first_location_id()
                updated_variants = get_product_variants(product_id)
                for upd in variants_to_update:
                    matching_variant = next((v for v in updated_variants if v["id"] == upd["id"]), None)
                    if matching_variant:
                        inv_id = matching_variant.get("inventoryItemId") or (matching_variant.get("inventoryItem") or {}).get("id")
                        if inv_id:
                            adjust_inventory_quantity(inv_id, location_id, upd["quantity"])
                
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
        
        # Create new variants if any (FULL SYNC for main.py)
        if variants_to_create:
            try:
                print(f"[INFO] Creating {len(variants_to_create)} new variants for {title}")
                option_id = get_first_option_id_of_product(product_id)
                if not option_id:
                    print(f"[ERROR] Could not find option ID for product {product_id}")
                    return False
                
                create_variants_bulk(product_id, option_id, variants_to_create)
                print(f"[SUCCESS] Created {len(variants_to_create)} new variants for {title}")
                
                # Adjust inventory for new variants
                location_id = get_first_location_id()
                refreshed_variants = get_product_variants(product_id)
                for new_var in variants_to_create:
                    matching_variant = next((v for v in refreshed_variants if v["title"] == new_var["size"]), None)
                    if matching_variant:
                        inv_id = matching_variant.get("inventoryItemId") or (matching_variant.get("inventoryItem") or {}).get("id")
                        if inv_id:
                            adjust_inventory_quantity(inv_id, location_id, new_var["quantity"])
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
        
        if not variants_to_update and not variants_to_create:
            print(f"[INFO] No variants to update for {title}")
        
        return True
            
    except RateLimitException:
        raise  # Re-raise 429 errors
    except Exception as e:
        print(f"[ERROR] Failed to update product {title}: {e}")
        return False

# ----------------------------------------------------------------------------
# Helper: Build product description
def build_description(original_description, traits, title="", sku=""):
    style = ""
    colorway = ""
    release_date = ""
    for trait in traits:
        t_name = trait.get("name", "").lower()
        if t_name == "style":
            style = trait.get("value", "")
        elif t_name == "colorway":
            colorway = trait.get("value", "")
        elif t_name == "release date":
            release_date = trait.get("value", "")
    
    details = []
    if style:
        details.append(f"Style: {style}")
    if colorway:
        details.append(f"Colorway: {colorway}")
    if release_date:
        details.append(f"Release Date: {release_date}")
    details_str = "\n".join(details)
    
    if original_description and original_description.strip():
        # Has description from StockX
        return original_description.strip() + ("\n\n" + details_str if details_str else "")
    else:
        # No description from StockX - use default with title and SKU
        default_desc = f"{title}\n\nAuthentique product from Resell Lausanne, manually checked."
        if sku:
            default_desc += f"\nSKU: {sku}"
        if details_str:
            default_desc += f"\n\n{details_str}"
        return default_desc

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
def process_url(url, thread_id=0):
    thread_api_products = {}
    try:
        print(f"[Thread {thread_id}] Processing URL: {url}")
        out = getOne(url)
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
    
    # Handle images from new API structure (exclude 360° gallery to avoid extra calls)
    product_image = product_data.get("image")
    images = [product_image] if product_image else []
    # Also include static gallery when present
    gallery = product_data.get("gallery") or []
    if isinstance(gallery, list):
        images.extend([u for u in gallery if u and str(u).strip()])
    
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
    description = build_description(original_description, traits, title, base_sku)

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
            "product_barcode": product_barcode,  # NEW: Store product-level barcode
            "__raw_vendor__": product_data,
        }

    # Process each variant (new API structure)
    for variant in variants:
        # Extract EU size from the new API structure
        eu_size = None
        sizes_list = variant.get("sizes", []) or []
        
        # First try: Look for EU size directly
        for s in sizes_list:
            if str(s.get("type", "") or "").lower() == "eu":
                size_val = s.get("size")
                if size_val is not None:
                    size_val = str(size_val).strip()
                    eu_size = size_val.replace("EU", "").strip() if size_val else None
                    if eu_size:
                        break

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
        
        # Get price from new API structure - USE LOWEST PRICE AVAILABLE
        total_asks = variant.get("total_asks", 0)
        
        # FIX 3: Set qty=1 for single-variant "One Size" to survive filtering
        if eu_size == "One Size":
            valid_quantity = 1
        else:
            valid_quantity = 1 if total_asks >= 2 else 0
        
        # Look for ALL available prices and pick the LOWEST
        prices_list = variant.get("prices", []) or []
        
        # DEBUG: Show raw prices data before validation
        print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: raw prices_list type={type(prices_list)}, length={len(prices_list) if isinstance(prices_list, list) else 'N/A'}")
        if prices_list:
            print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: raw prices_list content={prices_list}")
        
        # Collect all valid prices (standard and express)
        available_prices = []
        for price_entry in prices_list:
            price_type = price_entry.get("type", "")
            # FIX: StockX API returns "Price" (capital P) not "price" (lowercase)
            price_value = float(price_entry.get("Price", price_entry.get("price", 0)) or 0)
            asks_value = int(price_entry.get("Asks", price_entry.get("asks", 0)) or 0)
            print(f"[Thread {thread_id}] [DEBUG PRICE] Size {eu_size}: Checking price_entry type='{price_type}', value={price_value}, asks={asks_value}")
            if price_value > 0:
                available_prices.append({
                    "type": price_type,
                    "price": price_value,
                    "asks": asks_value
                })
        
        if not available_prices:
            print(f"[Thread {thread_id}] [WARNING] No valid prices found for size {eu_size}; skipping (prices_list had {len(prices_list)} entries)")
            continue
        
        # Pick the LOWEST price available
        lowest_price_entry = min(available_prices, key=lambda x: x["price"])
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
            
            # Calculate cost with LEGO-specific fees and shipping
            cost_value = calc_touch_price(raw_price, pc, product_handle)
            sell_price = calc_sell_price(raw_price, pc, is_express=False, product_handle=product_handle)
            print(f"[CALCULATED] {title} - Size {eu_size}: STOCKX={raw_price} CHF, COST={cost_value:.2f} CHF, SELL={sell_price} CHF")
        else:
            print(f"[Thread {thread_id}] [WARNING] Invalid price for {title} size {eu_size}, skipping variant.")
            continue

        if sell_price <= 0:
            print(f"[Thread {thread_id}] [WARNING] Zero or negative price for {title} size {eu_size}, skipping variant.")
            continue

        # Extract GTIN/UPC from variant if available, fallback to product-level
        # kicks.dev API returns identifiers as a list of objects
        variant_identifiers = variant.get("identifiers", [])
        barcode = ""
        
        if isinstance(variant_identifiers, list) and len(variant_identifiers) > 0:
            # Extract first valid identifier from the list
            for id_obj in variant_identifiers:
                if isinstance(id_obj, dict):
                    identifier = id_obj.get("identifier", "")
                    id_type = id_obj.get("identifier_type", "")
                    if identifier and identifier != "--":
                        barcode = identifier
                        if id_type:
                            print(f"[Thread {thread_id}] [GTIN] Found {id_type}: {identifier} for size {eu_size}")
                        break
        elif isinstance(variant_identifiers, dict):
            # Fallback for dict format (older API versions)
            variant_gtin = variant_identifiers.get("gtin") or variant_identifiers.get("GTIN") or ""
            variant_upc = variant_identifiers.get("upc") or variant_identifiers.get("UPC") or ""
            variant_ean = variant_identifiers.get("ean") or variant_identifiers.get("EAN") or ""
            barcode = variant_gtin or variant_upc or variant_ean
        
        # Use product-level barcode as final fallback
        if not barcode:
            barcode = product_barcode

        print(f"[Thread {thread_id}] [DEBUG] Creating variant: size={eu_size}, price={sell_price}, barcode={barcode or 'none'}")
        thread_api_products[title]["variants"].append({
            "size": eu_size,
            "price": sell_price,
            "cost": {"amount": f"{cost_value:.2f}", "currencyCode": "CHF"},
            "sku": f"{base_sku}-OS" if eu_size == "One Size" else f"{base_sku}-{eu_size}",
            "quantity": valid_quantity,
            "barcode": barcode,
        })

        # SKIP express variants entirely as per requirement
        # No longer creating express/fast delivery variants
    
    # Apply filtering to remove invalid variants
    products_to_remove = []
    for title, product_info in thread_api_products.items():
        original_count = len(product_info["variants"])
        product_info["variants"] = filter_variants(product_info["variants"])
        filtered_count = len(product_info["variants"])
        
        if filtered_count < original_count:
            print(f"[Thread {thread_id}] [INFO] Filtered {original_count - filtered_count} invalid variants from {title}")
        
        # Mark products with no valid variants for removal
        if filtered_count == 0:
            print(f"[Thread {thread_id}] [WARNING] No valid variants for {title}, skipping product")
            products_to_remove.append(title)
    
    # Remove products with no valid variants
    for title in products_to_remove:
        del thread_api_products[title]
    
    return thread_api_products

# ----------------------------------------------------------------------------
# Main program
if __name__ == "__main__":
    # Parse command line arguments
    parser = argparse.ArgumentParser(description='Process StockX URLs to Shopify products')
    parser.add_argument('--start-url', type=str, help='URL to start processing from')
    parser.add_argument('--start-index', type=int, help='Index to start processing from')
    parser.add_argument('--reset', action='store_true', help='Reset processing state')
    parser.add_argument('--force-continue', action='store_true', help='Continue even if 24h limit has not passed')
    parser.add_argument('--auto-restart', action='store_true', help='Automatically restart after 24h when hitting the limit')
    parser.add_argument('--no-wait', action='store_true', help='Don\'t wait for 24h limit, restart immediately')
    parser.add_argument('--update-only', action='store_true', help='Skip partial creates and process updates only (avoids variant creation limit)')
    args = parser.parse_args()

    # Enhanced processing function with 429 handling and partials support
    def run_processing_enhanced():
        print("[INFO] Starting enhanced processing with partials-first architecture")

        publications = get_all_publications()
        for pub in publications:
            print(f"Publication ID: {pub['id']}  |  Name: {pub['name']}")

        # Always prefetch existing Shopify products for safest matching
        # This prevents duplicates - products created before 429 will be recognized and updated
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
        if args.update_only:
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
        print("\n[INFO] Phase 2: Processing partial update entries...")
        partials_update = load_partials("partials_update.jsonl")
        if partials_update:
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
        if args.update_only:
            print("\n[INFO] Phase 3: Processing UPDATE-ONLY URLs (--update-only flag enabled)...")
            print("[INFO] 🔄 Skipping all create operations to avoid variant creation limit")
        else:
            print("\n[INFO] Phase 3: Processing alternating create/update URLs...")
        
        # Read already created URLs to skip them
        created_urls = set()
        if os.path.exists("created_urls.txt"):
            with open("created_urls.txt", "r", encoding="utf-8") as f:
                created_urls = {line.strip() for line in f if line.strip()}
        
        processed_count = 0
        success_count = 0  # SAFETY: Track actual successes to prevent endless loops
        consecutive_failures = 0  # SAFETY: Track consecutive failures
        
        # Parallel processing (6 threads - 10 was too aggressive!)
        max_workers = 6
        executor = concurrent.futures.ThreadPoolExecutor(max_workers=max_workers)
        futures = {}
        
        # Choose generator based on --update-only flag
        if args.update_only:
            url_gen = updates_only_generator()
        else:
            url_gen = alternating_url_generator()
        
        print(f"[INFO] Parallel processing: {max_workers} threads")
        
        # Submit initial batch
        for _ in range(max_workers * 2):
            try:
                url, action_type = next(url_gen)
                if action_type == "create" and url in created_urls:
                    continue
                print(f"\n[INFO] Queuing {action_type}: {url}")
                log_event(url, action_type, "started")
                # Pass skip_creates_on_limit=True to allow deferring creates when limit is hit
                future = executor.submit(process_single_url_enhanced, url, action_type, shopify_products, skip_creates_on_limit=True)
                futures[future] = (url, action_type)
            except StopIteration:
                break
        
        # Process as they complete
        # Keep processing even if futures list becomes empty temporarily (generator might be waiting)
        consecutive_empty_iterations = 0
        while True:
            # If no futures, try to get more URLs from generator
            if not futures:
                consecutive_empty_iterations += 1
                if consecutive_empty_iterations > 10:
                    # After 10 empty iterations, wait longer before checking again
                    print("[INFO] No active futures. Waiting 30 seconds before checking for more URLs...")
                    time.sleep(30)
                    consecutive_empty_iterations = 0
                    # Re-read URL lists in case new URLs were added
                    if args.update_only:
                        url_gen = updates_only_generator()
                    else:
                        url_gen = alternating_url_generator()
                
                # Try to get new URLs
                for _ in range(max_workers * 2):
                    try:
                        url, action_type = next(url_gen)
                        if action_type == "create" and url in created_urls:
                            continue
                        print(f"\n[INFO] Queuing {action_type}: {url}")
                        log_event(url, action_type, "started")
                        future = executor.submit(process_single_url_enhanced, url, action_type, shopify_products, skip_creates_on_limit=True)
                        futures[future] = (url, action_type)
                        consecutive_empty_iterations = 0  # Reset counter
                    except StopIteration:
                        # Generator exhausted - wait a bit
                        time.sleep(5)
                        break
                
                # If still no futures after trying, wait a bit more
                if not futures:
                    time.sleep(10)
                    continue
            
            # Process completed futures
            done, _ = concurrent.futures.wait(futures.keys(), return_when=concurrent.futures.FIRST_COMPLETED, timeout=1.0)
            
            if not done:
                # Timeout - no futures completed yet, continue loop
                continue
            
            for future in done:
                url, action_type = futures.pop(future)
                
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
                        
                        # Switch to updates-only mode
                        print(f"[INFO] 🔄 Switching to UPDATES-ONLY mode (skipping all creates)")
                        url_gen = updates_only_generator()
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
                    
                    log_event(url, action_type, "ok")
                    processed_count += 1
                    success_count += 1  # SAFETY: Increment success counter
                    consecutive_failures = 0  # SAFETY: Reset failure counter
                else:
                    # Check if this was a "no_data" failure (StockX 404) vs actual API failure
                    with open("logs.jsonl", "r", encoding="utf-8") as f:
                        lines = f.readlines()
                        if lines:
                            last_log = json.loads(lines[-1].strip())
                            if last_log.get("reason") == "no_data":
                                print(f"[INFO] Skipping {url} - no StockX data")
                                consecutive_failures = 0
                            else:
                                append_error_url(url, f"{action_type}_failed")
                                if action_type == "create":
                                    remove_url_from_create_list(url)
                                log_event(url, action_type, "error")
                                consecutive_failures += 1
                
                # Submit new work
                try:
                    next_url, next_action = next(url_gen)
                    if not (next_action == "create" and next_url in created_urls):
                        print(f"\n[INFO] Queuing {next_action}: {next_url}")
                        log_event(next_url, next_action, "started")
                        new_future = executor.submit(process_single_url_enhanced, next_url, next_action, shopify_products)
                        futures[new_future] = (next_url, next_action)
                except StopIteration:
                    # Generator exhausted - wait a bit and try to reinitialize
                    print("[WARNING] URL generator exhausted. Waiting 5 seconds before checking for more URLs...")
                    time.sleep(5)
                    # Try to get a new URL (generator should loop or wait)
                    try:
                        next_url, next_action = next(url_gen)
                        if not (next_action == "create" and next_url in created_urls):
                            print(f"\n[INFO] Queuing {next_action}: {next_url}")
                            log_event(next_url, next_action, "started")
                            new_future = executor.submit(process_single_url_enhanced, next_url, next_action, shopify_products)
                            futures[new_future] = (next_url, next_action)
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
                return False, None
        
        # Clean shutdown
        executor.shutdown(wait=True)
        print(f"\n[INFO] Cycle complete. Processed {processed_count} URLs, {success_count} successful.")
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
            
            # Since we now loop indefinitely, completed will always be False
            # Only break on manual interruption (Ctrl+C)
            if completed:
                print("[INFO] Processing cycle completed. Continuing with next cycle...")
                # Don't break - continue the infinite loop
                continue
            
            # Check for manual stop signal after processing failure
            if os.path.exists('.stop_process'):
                print("[INFO] Stop signal detected. Exiting auto-restart loop.")
                os.remove('.stop_process')
                break
            
            # For 429 errors, we always do a 24h wait unless no-wait is specified
            if args.no_wait:
                wait_time = 60  # Wait a minute before retrying
                print(f"[INFO] --no-wait specified. Retrying after {wait_time} seconds...")
            else:
                # Default to 24 hours for 429 rate limits
                wait_time = 24 * 60 * 60 + random.uniform(0, 300)  # 24h + up to 5min jitter
                
                # Format time as hours, minutes, seconds
                hours = int(wait_time // 3600)
                minutes = int((wait_time % 3600) // 60)
                seconds = int(wait_time % 60)
                
                print(f"[INFO] Auto-restart mode: Waiting {hours}h {minutes}m {seconds}s until retry...")
            
            # Create rate limit file for dashboard countdown
            rate_limit_until = time.time() + wait_time
            with open('.rate_limit_until', 'w') as f:
                f.write(str(rate_limit_until))
            
            # Show countdown with stop signal checking
            end_time = datetime.datetime.now() + datetime.timedelta(seconds=wait_time)
            stop_requested = False
            while datetime.datetime.now() < end_time:
                # Check for stop signal every second during countdown
                if os.path.exists('.stop_process'):
                    print(f"\n[INFO] Stop signal detected during countdown. Exiting.")
                    os.remove('.stop_process')
                    # Clean up rate limit file
                    try:
                        os.remove('.rate_limit_until')
                    except FileNotFoundError:
                        pass
                    stop_requested = True
                    break
                
                remaining = (end_time - datetime.datetime.now()).total_seconds()
                hours_left = int(remaining // 3600)
                minutes_left = int((remaining % 3600) // 60)
                seconds_left = int(remaining % 60)
                
                sys.stdout.write(f"\r[INFO] Restarting in: {hours_left:02d}:{minutes_left:02d}:{seconds_left:02d}")
                sys.stdout.flush()
                time.sleep(1)
            
            sys.stdout.write("\r" + " " * 60 + "\r")
            
            # If stop was requested, exit the main loop
            if stop_requested:
                break
            
            # Clean up rate limit file
            try:
                os.remove('.rate_limit_until')
            except FileNotFoundError:
                pass
            
            print("[INFO] Restarting processing...")
    else:
        # Run once without auto-restart
        run_processing_enhanced()
