import requests
import random
import string
import os
import time

STOCKX_REQUEST_DELAY_SEC = float(os.getenv("STOCKX_REQUEST_DELAY_SEC", "0"))
STOCKX_MAX_RETRIES = int(os.getenv("STOCKX_MAX_RETRIES", "5"))
STOCKX_TIMEOUT_SEC = float(os.getenv("STOCKX_TIMEOUT_SEC", "25"))
KICKS_API_KEY = os.getenv("KICKSDB_API_KEY") or os.getenv("KICKS_API_KEY") or "sd_kRbsuYh7brcMNR5BermZnUhufKUNBnuA"
# Set by getOne on failure: timeout | http_404 | http_error | empty_body | None
last_fetch_error = None


def search(query, limit=10):
    """
    Search StockX products via Kicks list endpoint.
    Returns list of product dicts (each usually has slug, sku, title, brand, ...).
    """
    q = (query or "").strip()
    if not q:
        return []
    url = "https://api.kicks.dev/v3/stockx/products"
    headers = {"Authorization": KICKS_API_KEY}
    params = {
        "query": q,
        "currency": "CHF",
        "market": "CH",
    }
    try:
        if STOCKX_REQUEST_DELAY_SEC > 0:
            time.sleep(STOCKX_REQUEST_DELAY_SEC)
        response = requests.get(url, headers=headers, params=params, timeout=STOCKX_TIMEOUT_SEC)
        if response.status_code != 200:
            print(f"[STOCKX SEARCH] HTTP {response.status_code} for query={q!r}")
            return []
        data = response.json().get("data") or []
        if not isinstance(data, list):
            return []
        return data[: max(1, int(limit))]
    except Exception as e:
        print(f"[STOCKX SEARCH] Error for query={q!r}: {e}")
        return []


def resolve_slug_from_query(query):
    """
    Best-effort: query (style SKU / title / GTIN) → StockX slug.
    Prefers exact SKU match, else first hit with a slug.
    """
    q = (query or "").strip()
    if not q:
        return None
    hits = search(q, limit=20)
    if not hits:
        return None
    q_norm = q.upper().replace(" ", "")
    for hit in hits:
        sku = str(hit.get("sku") or "").strip().upper().replace(" ", "")
        if sku and sku == q_norm:
            slug = (hit.get("slug") or hit.get("urlKey") or hit.get("url_key") or "").strip()
            if slug:
                return slug
    for hit in hits:
        slug = (hit.get("slug") or hit.get("urlKey") or hit.get("url_key") or "").strip()
        if slug:
            return slug
    return None


def getOne(product_id, proxies=None):
    """
    Makes a GET request to the new /products/prices_data endpoint.
    :param product_id: The URL key or product identifier for which to retrieve data.
    :param proxies: Optional dictionary of proxies (if needed).
    :return: Parsed JSON data from the new endpoint or None if an error occurred.
    """

    # New endpoint URL
    url = 'https://api.kicks.dev/v3/stockx/products/'+product_id
    
    headers = {
        "Authorization": KICKS_API_KEY,
    }

    # Query parameters: pass product_id as 'url_key'
    params = {
        "currency": "CHF",
        "market": "CH",
        "display[variants]": True,
        "display[traits]": True,
        "display[identifiers]": True,
        "display[prices]": True,
        # Needed for `gallery` / `gallery_360` on product detail (otherwise omitted).
        "display[gallery]": True,
        "display[gallery_360]": True,
    }

    global last_fetch_error
    last_fetch_error = None

    for attempt in range(STOCKX_MAX_RETRIES):
        try:
            if STOCKX_REQUEST_DELAY_SEC > 0:
                time.sleep(STOCKX_REQUEST_DELAY_SEC)

            response = requests.get(
                url,
                headers=headers,
                params=params,
                timeout=STOCKX_TIMEOUT_SEC,
            )

            print("Response Status Code:", response.status_code)

            if response.status_code == 200:
                data = response.json()
                if not data or not data.get("data"):
                    last_fetch_error = "empty_body"
                    print(f"[STOCKX] Empty body for {product_id}")
                    break
                return data
            if response.status_code == 404:
                last_fetch_error = "http_404"
                print(f"[STOCKX] Product not found (404): {product_id}")
                break
            if response.status_code in [429, 403, 503]:
                last_fetch_error = "http_error"
                backoff = min(2 ** attempt, 8)
                print(
                    f"⚠️  StockX/Kicks returned {response.status_code} "
                    f"(attempt {attempt + 1}/{STOCKX_MAX_RETRIES}), backing off {backoff}s"
                )
                if attempt < STOCKX_MAX_RETRIES - 1:
                    time.sleep(backoff)
                    continue
            else:
                last_fetch_error = "http_error"
                print(f"Failed to get product info. Status code: {response.status_code}")
                break

        except requests.Timeout:
            last_fetch_error = "timeout"
            print(f"[STOCKX] Timeout after {STOCKX_TIMEOUT_SEC}s for {product_id} (attempt {attempt + 1}/{STOCKX_MAX_RETRIES})")
            if attempt < STOCKX_MAX_RETRIES - 1:
                time.sleep(min(2 ** attempt, 8))
                continue
            break
        except requests.RequestException as e:
            last_fetch_error = "timeout" if "timed out" in str(e).lower() else "http_error"
            print(f"An error occurred: {e}")
            if attempt < STOCKX_MAX_RETRIES - 1:
                time.sleep(min(2 ** attempt, 8))
                continue
            break

    return None