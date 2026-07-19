import requests
import os
import json
import re
from dotenv import load_dotenv
import math
import time
import uuid
from decimal import Decimal, ROUND_HALF_UP
import os

# Load environment variables
load_dotenv()
shop_name = (os.getenv("SHOP_NAME_SHOPIFY") or "").strip()
if shop_name.endswith(".myshopify.com"):
    shop_name = shop_name[: -len(".myshopify.com")]
DEFAULT_API_VERSION = "2026-04"
api_version = os.getenv("API_VERSION_SHOPIFY") or os.getenv("SHOPIFY_API_VERSION") or DEFAULT_API_VERSION
api_access_token = os.getenv("ACCESS_TOKEN_SHOPIFY") or os.getenv("SHOPIFY_ADMIN_ACCESS_TOKEN")

SHOP_URL = f"https://{shop_name}.myshopify.com/admin/api/{api_version}/graphql.json"
HEADERS = {
    "X-Shopify-Access-Token": api_access_token,
    "Content-Type": "application/json",
    "Accept": "application/json",
}
# Verbose HTTP logging floods terminal. Keep off by default.
VERBOSE_SHOPIFY_HTTP = os.getenv("SHOPIFY_VERBOSE_HTTP", "0").strip().lower() in ("1", "true", "yes", "on")
_CACHED_FIRST_LOCATION_ID = None
_CACHED_LOCATION_IDS = None
_CACHED_SECONDARY_LOCATION_IDS = None

# Primary online fulfillment location (Resell Lausanne web sales)
ONLINE_LOCATION_GID = os.getenv(
    "SHOPIFY_ONLINE_LOCATION_ID",
    "gid://shopify/Location/72553660705",  # Chemin de Bas-de-Plan 6
)
ONLINE_LOCATION_NAME_HINT = os.getenv("SHOPIFY_ONLINE_LOCATION_NAME", "Chemin de Bas-de-Plan")


def _api_version_at_least(current, minimum):
    """Return True when YYYY-MM current version is >= minimum."""
    try:
        c_year, c_month = [int(x) for x in str(current).split("-", 1)]
        m_year, m_month = [int(x) for x in str(minimum).split("-", 1)]
        return (c_year, c_month) >= (m_year, m_month)
    except Exception:
        return False


class RateLimitException(Exception):
    """Custom exception for 429 rate limit errors"""
    def __init__(self, message, retry_after=None):
        super().__init__(message)
        self.retry_after = retry_after

def _run_query(query, variables=None, max_retries=3, delay=5):
    """Executes a GraphQL query or mutation with retry logic."""
    payload = {"query": query, "variables": variables or {}}
    
    # Add intelligent delay to prevent throttling
    # Only add delay for mutation operations (create/update), not simple queries
    import time
    is_mutation = 'mutation' in query.lower()
    is_bulk_operation = any(op in query.lower() for op in ['product', 'variant', 'inventory'])
    
    if is_mutation and is_bulk_operation:
        base_delay = 0.1  # 500ms delay to prevent VARIANT_THROTTLE_EXCEEDED
        print(f"[DEBUG] Adding {base_delay}s delay for mutation to prevent throttling...")
        time.sleep(base_delay)
    # No delay for simple queries like inventory checks
    
    for attempt in range(max_retries):
        try:
            response = requests.post(SHOP_URL, json=payload, headers=HEADERS)
            
            # ========== SHOPIFY API RESPONSE LOGGING ==========
            if VERBOSE_SHOPIFY_HTTP:
                print(f"[SHOPIFY API] Status Code: {response.status_code}")
                print(f"[SHOPIFY API] Headers: {dict(response.headers)}")
                print(f"[SHOPIFY API] Raw Response Text: {response.text}")
                print(f"[SHOPIFY API] ===================================")
            
            # Check for HTTP 429 rate limit (proper rate limit)
            if response.status_code == 429:
                retry_after = response.headers.get('Retry-After')
                print(f"[CRITICAL] HTTP 429 RATE LIMIT DETECTED!")
                print(f"[CRITICAL] Status Code: {response.status_code}")
                print(f"[CRITICAL] Retry-After: {retry_after}")
                print(f"[CRITICAL] Full Response: {response.text}")
                print(f"[CRITICAL] This is a REAL HTTP 429 from Shopify API")
                
                # Create enhanced exception with full response details
                exception = RateLimitException(f"HTTP 429 Rate limited", retry_after=retry_after)
                exception.shopify_response = response.text
                exception.api_status_code = response.status_code
                raise exception
            
            response.raise_for_status()
            data = response.json()
            
            # Print parsed JSON only in verbose mode
            if VERBOSE_SHOPIFY_HTTP:
                print(f"[SHOPIFY API] Parsed JSON Response: {data}")
                print(f"[SHOPIFY API] =====================================")
            
            # BULLETPROOF 429 DETECTION: Check for exact Shopify 429 response format
            is_mutation = 'mutation' in query.lower()
            if is_mutation:
                # Check for EXACT Shopify 429 response format
                response_text = str(data)
                
                # EXACT Shopify 429 pattern: "Daily variant creation limit reached"
                shopify_429_pattern = "Daily variant creation limit reached"
                
                if shopify_429_pattern in response_text:
                    print(f"[CRITICAL] ⚠️  SHOPIFY 429 RATE LIMIT DETECTED! ⚠️")
                    print(f"[CRITICAL] 🚫 Daily variant creation limit reached")
                    print(f"[CRITICAL] 📋 Mutation Query: {query[:100]}...")
                    print(f"[CRITICAL] 📄 Full Shopify 429 Response: {data}")
                    print(f"[CRITICAL] ✅ This is the REAL Shopify 429 response format")
                    print(f"[CRITICAL] ⏰ Entering 24-hour cooldown...")
                    
                    # Create enhanced exception with full response details
                    exception = RateLimitException(f"Shopify 429: Daily variant creation limit reached")
                    exception.shopify_response = str(data)
                    exception.api_status_code = response.status_code
                    exception.retry_after = 24 * 60 * 60  # 24 hours
                    raise exception
            
            # Check for GraphQL errors - distinguish between THROTTLED and actual rate limits
            if "errors" in data:
                error_messages = str(data['errors']).lower()
                error_codes = str(data['errors'])  # Keep original case for code checking
                print(f"[DEBUG] GraphQL errors detected: {data['errors']}")
                
                # VARIANT_THROTTLE_EXCEEDED is NOT a daily limit - just needs delays
                if 'VARIANT_THROTTLE_EXCEEDED' in error_codes or 'variant_throttle' in error_messages:
                    throttle_delay = 5  # 5 second delay for variant throttle
                    print(f"[WARNING] VARIANT_THROTTLE_EXCEEDED (NOT daily limit)")
                    print(f"[INFO] Adding {throttle_delay}s delay and continuing...")
                    time.sleep(throttle_delay)
                    # Don't raise exception - just continue with delay
                    if attempt < max_retries - 1:
                        continue
                    else:
                        # Even after retries, don't treat as 429 - just log warning
                        print(f"[WARNING] Variant throttle persists after retries - continuing anyway")
                        return data  # Return data even with throttle warning
                
                # THROTTLED is NOT a rate limit - it's a soft limit that needs different handling
                if 'throttled' in error_messages:
                    print(f"[WARNING] GraphQL THROTTLED error (NOT rate limit): {data['errors']}")
                    print(f"[INFO] THROTTLED requires longer delays between requests, not 24h wait")
                    # For THROTTLED, we should add delay and retry, not trigger 24h backoff
                    if attempt < max_retries - 1:
                        throttle_delay = min(delay * 2, 60)  # Max 60 seconds for throttle
                        print(f"[INFO] Retrying after {throttle_delay}s due to THROTTLED...")
                        time.sleep(throttle_delay)
                        continue
                    else:
                        # If we've exhausted retries, treat as soft error
                        raise Exception(f"GraphQL THROTTLED after {max_retries} attempts: {data['errors']}")
                
                # Check for EXACT Shopify 429 message in GraphQL errors
                elif "daily variant creation limit reached" in error_messages:
                    print(f"[CRITICAL] ⚠️  SHOPIFY 429 IN GRAPHQL ERRORS! ⚠️")
                    print(f"[CRITICAL] 🚫 Daily variant creation limit reached")
                    print(f"[CRITICAL] 📄 GraphQL Error Response: {data['errors']}")
                    print(f"[CRITICAL] ✅ This is the REAL Shopify 429 in GraphQL format")
                    # Create enhanced exception with full response details
                    exception = RateLimitException(f"Shopify GraphQL 429: Daily variant creation limit reached")
                    exception.shopify_response = str(data)
                    exception.api_status_code = response.status_code
                    exception.retry_after = 24 * 60 * 60  # 24 hours
                    raise exception
                
                # Other GraphQL errors
                else:
                    print(f"[ERROR] Other GraphQL error: {data['errors']}")
                    raise Exception(f"GraphQL Errors: {data['errors']}")
            
            return data.get("data", {})
            
        except RateLimitException:
            # Re-raise rate limit exceptions immediately (only for true rate limits)
            raise
        except requests.exceptions.HTTPError as e:
            if e.response.status_code in [502, 503, 504] and attempt < max_retries - 1:
                print(f"Attempt {attempt + 1} failed with {e.response.status_code}. Retrying in {delay} seconds...")
                time.sleep(delay)
                delay *= 2  # Exponential backoff
                continue
            raise Exception(f"HTTP Error: {e}")
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                print(f"Attempt {attempt + 1} failed. Retrying in {delay} seconds...")
                time.sleep(delay)
                delay *= 2
                continue
            raise Exception(f"HTTP Error: {e}")
        except Exception as e:
            raise Exception(f"GraphQL Query Error: {e}")
    
    raise Exception(f"Failed after {max_retries} attempts")


def get_all_products():
    """Fetch all products with variants (first 100) plus handle/status.
    Simple sequential pagination - threading doesn't help due to cursor dependencies.
    """
    query = """
    query getAllProducts($cursor: String) {
      products(first: 250, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            handle
            status
            publishedAt
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  price
                  sku
                  barcode
                  inventoryItem {
                    id
                    unitCost { amount currencyCode }
                    tracked
                  }
                }
              }
            }
          }
        }
        pageInfo { hasNextPage }
      }
    }
    """
    
    all_products = []
    cursor = None
    page_num = 0
    
    while True:
        data = _run_query(query, {"cursor": cursor})
        edges = data.get("products", {}).get("edges", [])
        
        # Add delay between prefetch requests to prevent throttling
        time.sleep(0.5)  # 500ms delay between prefetch pages
        
        # Process products
        for edge in edges:
            node = edge["node"]
            product_info = {
                "id": node["id"],
                "title": node["title"],
                "handle": node.get("handle"),
                "status": node.get("status"),
                "publishedAt": node.get("publishedAt"),
                "variants": []
            }
            for vedge in node.get("variants", {}).get("edges", []):
                vnode = vedge["node"]
                inv = vnode.get("inventoryItem")
                product_info["variants"].append({
                    "id": vnode["id"],
                    "title": vnode["title"],
                    "price": vnode.get("price"),
                    "sku": vnode.get("sku"),
                    "barcode": vnode.get("barcode"),
                    "inventoryItemId": inv["id"] if inv else None,
                    "tracked": inv["tracked"] if inv else None,
                    "unitCost": (inv["unitCost"]["amount"] if inv and inv.get("unitCost") else None),
                })
            all_products.append(product_info)
        
        page_num += 1
        print(f"[PREFETCH] Page {page_num}: {len(edges)} products (total: {len(all_products)})")
        
        # Check if there's a next page
        page_info = data.get("products", {}).get("pageInfo", {})
        has_next_page = page_info.get("hasNextPage", False)
        if not has_next_page or not edges:
            break
        
        cursor = edges[-1]["cursor"]
    
    print(f"[PREFETCH] Complete! Fetched {len(all_products)} total products in {page_num} pages")
    return all_products


def get_lego_shipping_cost(product_handle):
    """Get manual shipping cost for specific LEGO products based on size/complexity"""
    if not product_handle:
        return 20  # Default shipping
    
    handle_lower = str(product_handle).lower()
 
    # Manual per-product shipping overrides (CHF).
    # These return the FINAL shipping value (not an add-on).
    custom_shipping_overrides = {
        "lego-pet-shop-set-10218": 45,
        "lego-grand-emporium-set-10211": 25,
        "lego-ideas-nasa-apollo-saturn-v-set-92176": 25,
    }
    for set_name, shipping in custom_shipping_overrides.items():
        if set_name in handle_lower:
            return shipping
    
    # Large LEGO sets - 60 CHF shipping
    large_sets = ['lego-eiffel-tower-set-10307', 'lego-titanic-set-10294', 
                  'lego-palace-cinema-set-10232', 'lego-marvel-studios-infinity-saga-hulkbuster-set-76210',
                  'lego-icons-the-endurance-set-10335']
    if any(set_name in handle_lower for set_name in large_sets):
        return 60
    
    # Medium LEGO sets - 45 CHF shipping
    medium_sets = ['lego-creator-fairgrounds-mixer-set-10244', 'lego-stranger-things-the-upside-down-set-75810',
                   'lego-tower-bridge-set-10214', 'lego-technic-land-rover-defender-set-42110',
                   'lego-creator-ferris-wheel-2015-set-10247', 'lego-architecture-taj-mahal-set-21056']
    if any(set_name in handle_lower for set_name in medium_sets):
        return 45
    
    # Small LEGO sets - 35 CHF shipping
    small_sets = ['lego-star-wars-tie-fighter-set-75095', 'lego-creator-horizon-express-set-10233',
                  'lego-creator-santas-workshop-set-10245']
    if any(set_name in handle_lower for set_name in small_sets):
        return 35
    
    # Default LEGO shipping (if product is LEGO but not in specific lists)
    if 'lego' in handle_lower:
        return 20
    
    return 20  # Default for non-LEGO products


def calc_touch_price(stockx_raw_price, product_category="sneakers", product_handle=""):
    """
    Calculate the actual buy/cost price from StockX raw price.
    
    Formula: 
    - Sneakers: StockX price * 1.08 (8% fees) + 20 CHF (standard shipping)
    - LEGO: StockX price * 1.10 (10% fees) + variable shipping (20-60 CHF based on size)
    
    This represents your ACTUAL cost to acquire the product.
    """
    amount = Decimal(stockx_raw_price)
    
    # LEGO products have higher processing fees (10% vs 8%)
    is_lego = "lego" in str(product_category or "").lower() or "lego" in str(product_handle or "").lower()
    
    if is_lego:
        # LEGO: 10% processing fees + variable shipping
        shipping = get_lego_shipping_cost(product_handle)
        result = amount * Decimal('1.10') + Decimal(str(shipping))
        print(f"[COST DEBUG] LEGO pricing: {stockx_raw_price} × 1.10 + {shipping} (shipping) = {result:.2f} CHF")
    else:
        # Sneakers: 8% processing fees + standard 20 CHF shipping
        result = amount * Decimal('1.08') + Decimal('20')
    
    return result.quantize(Decimal('0.01'), rounding=ROUND_HALF_UP)


def calc_sell_price(stockx_raw, product_category="sneakers", is_express=False, product_handle="", brand=""):
    """
    HYBRID ADS-COST PRICING MODEL: ~12% EBITDA @ 35-37k CHF monthly revenue (calibration band)

    Goal: Output a Shopify sell price that includes shipping and yields ~12% EBITDA
    using a hybrid ads-cost model (percent for low AOV, flat CPA for high AOV).

    Higher CA (e.g. ~55k) does not auto-retune constants — if ops/ads % change materially,
    adjust ADS_PCT / CM2_TARGET / CPA_CAP manually.

    Why hybrid? Ad spend per order doesn't scale linearly at high AOV. % ads overcharges
    premium items. We use:
    - % of price for lower AOV (below ~190 CHF)
    - Flat CPA cap (CHF/order) above that threshold

    Pipeline (classic / restored):
    1. After-fees cost C (StockX fees + inbound shipping model)
    2. C_plus_ship = C + SHIP_F (customer ship inside hybrid base; bump SHIP_F when fulfil model changes)
    3. Hybrid on C_plus_ship: % mode if implied price ≤ 190, else CPA-cap with CPA_CAP
    4. Adidas / Onitsuka sneakers: -10%; Saucony sneakers: -8% only (no default stack); sneakers else -5%; clothing/streetwear -2%
    5. Low-AOV floor when C ≤ 100: max(hybrid, C + 50 + 13) — hybrid wins above ~86 all-in
    6. Psychological rounding (no global +3%, no second ship bump)
    
    LEGO: C_plus_ship * 1.33 (33% brut) only, then psych rounding. Manual inbound ship via get_lego_shipping_cost(handle).
    
    Args:
        stockx_raw: StockX tile price BEFORE their fees (CHF)
        product_category: Product category (sneakers, lego, etc.)
        is_express: Express delivery — higher ship in base + 5% upsell before rounding
        product_handle: Product URL slug for LEGO-specific shipping
    """
    print(f"[PRICE DEBUG] calc_sell_price INPUT: stockx_raw={stockx_raw}")
    
    # ---- Tunables (update monthly if needed) ----
    PSP = 0.032         # payment fee %
    VAT = 0.023         # VAT %
    ADS_PCT = 0.13      # ads as % of revenue (~13% observed; was 9%)
    CPA_CAP = 17.0      # CHF per order (flat piece in CPA branch; Q4 updated)
    CM2_TARGET = 0.19   # ~19% CM2 to land ~12% EBITDA at 35-37k CA band
    SHIP_F_STANDARD = 7.0
    SHIP_F_EXPRESS = 15.0
    EXPRESS_UPSELL_PCT = 0.05  # small express premium on top of hybrid price
    SHIP_F = SHIP_F_EXPRESS if is_express else SHIP_F_STANDARD
    BRAND_MARGIN_DISCOUNT = 0.10  # adidas / onitsuka sneakers only
    SAUCONY_MARGIN_DISCOUNT = 0.08  # saucony sneakers: -8% vs hybrid base only, no default stack
    SNEAKER_MARGIN_DISCOUNT = 0.05  # nike, jordan, nb, etc.
    CLOTHING_MARGIN_DISCOUNT = 0.02  # streetwear, jerseys, apparel
    LOW_AOV_COST_THRESHOLD = 100.0  # all-in StockX buy (C) at or below this
    LOW_AOV_MIN_MARGIN = 50.0       # fixed margin on low-AOV items
    LOW_AOV_FULFIL = 15.0 if is_express else 13.0  # outbound logistics
    
    # Check if this is a LEGO product
    is_lego = "lego" in str(product_category or "").lower() or "lego" in str(product_handle or "").lower()
    
    # Step 1: After-fees cost from StockX
    if is_lego:
        # LEGO: 10% processing fees + variable shipping
        lego_shipping = get_lego_shipping_cost(product_handle)
        C = stockx_raw * 1.10 + lego_shipping
        print(f"[PRICE DEBUG] LEGO After-fees cost C: {stockx_raw} * 1.10 + {lego_shipping} (shipping) = {C:.2f} CHF")
    else:
        # Sneakers: 8% processing fees + standard 20 CHF shipping
        C = stockx_raw * 1.08 + 20.0
        print(f"[PRICE DEBUG] After-fees cost C: {stockx_raw} * 1.08 + 20 = {C:.2f} CHF")
    
    # Step 2: Include customer ship in hybrid base
    C_plus_ship = C + SHIP_F
    print(f"[PRICE DEBUG] C + Shipping: {C:.2f} + {SHIP_F} = {C_plus_ship:.2f} CHF")
    
    # LEGO pricing: 33% brut markup on C_plus_ship (manual inbound ship per handle in get_lego_shipping_cost)
    LEGO_MARKUP = 1.33
    if is_lego:
        final_price_raw = C_plus_ship * LEGO_MARKUP
        mode = "LEGO 33% brut"
        print(f"[PRICE DEBUG] LEGO detected → Using 33% brut markup (inbound ship={lego_shipping} CHF via handle override)")
        print(f"[PRICE DEBUG] LEGO price: {C_plus_ship:.2f} × {LEGO_MARKUP} = {final_price_raw:.2f} CHF")

        if is_express:
            before_upsell = final_price_raw
            final_price_raw *= 1.0 + EXPRESS_UPSELL_PCT
            print(
                f"[PRICE DEBUG] Express upsell: {before_upsell:.2f} → {final_price_raw:.2f} "
                f"(+{EXPRESS_UPSELL_PCT * 100:.0f}%)"
            )
            mode = f"{mode} + express upsell"
        
        # Round UP to psychological endings (...9, ...19, ...29, ...39, ...49, ...59, ...69, ...79, ...89, ...99)
        endings = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99]
        base = (int(final_price_raw) // 100) * 100
        final_price = base + 109  # default to next hundred's ...09
        for e in endings:
            cand = base + e
            if cand >= final_price_raw:
                final_price = cand
                break
        
        print(f"[PRICE DEBUG] Final price: {final_price_raw:.2f} → Rounded to {final_price} CHF ({mode})")
        print(f"[PRICE DEBUG] calc_sell_price OUTPUT: {final_price} CHF")
        return final_price
    
    # Step 3: Hybrid on C_plus_ship
    k_pct = 1.0 / (1.0 - (PSP + VAT + ADS_PCT + CM2_TARGET))
    price_pct = C_plus_ship * k_pct
    print(f"[PRICE DEBUG] % mode multiplier: {k_pct:.3f} (PSP+VAT+ADS+CM2={PSP+VAT+ADS_PCT+CM2_TARGET:.3f})")
    print(f"[PRICE DEBUG] % mode price: {C_plus_ship:.2f} * {k_pct:.3f} = {price_pct:.2f} CHF")
    
    # Step 4: Choose mode based on price threshold
    if price_pct <= 190.0:
        # Use % mode for low AOV (ads scale with price)
        final_price_raw = price_pct
        mode = "% mode"
        print(f"[PRICE DEBUG] Using % MODE (price ≤ 190 CHF)")
    else:
        # Use CPA-cap mode for high AOV (flat CPA, ads don't scale)
        denom = 1.0 - (PSP + VAT + CM2_TARGET)
        price_cpa = (C_plus_ship + CPA_CAP) / denom
        final_price_raw = price_cpa
        mode = "CPA-cap mode"
        print(f"[PRICE DEBUG] Switching to CPA-CAP MODE (% price > 190 CHF)")
        print(f"[PRICE DEBUG] CPA mode: ({C_plus_ship:.2f} + {CPA_CAP}) / {denom:.3f} = {price_cpa:.2f} CHF")
    
    # Step 4.5: Brand / default margin discount (before rounding)
    brand_lower = str(brand or "").lower()
    handle_lower = str(product_handle or "").lower()
    category_lower = str(product_category or "").lower()
    is_adidas = "adidas" in brand_lower or ("adidas" in handle_lower and not brand_lower)
    is_saucony = "saucony" in brand_lower or ("saucony" in handle_lower and not brand_lower)
    is_onitsuka = "onitsuka" in brand_lower or ("onitsuka" in handle_lower and not brand_lower)
    is_sneaker = "sneaker" in category_lower
    if (is_adidas or is_onitsuka) and is_sneaker:
        before_discount = final_price_raw
        final_price_raw = final_price_raw * (1.0 - BRAND_MARGIN_DISCOUNT)
        if is_adidas:
            discount_brand = "Adidas"
        else:
            discount_brand = "Onitsuka"
        print(f"[PRICE DEBUG] {discount_brand} margin discount: {before_discount:.2f} → {final_price_raw:.2f} (-{BRAND_MARGIN_DISCOUNT*100:.0f}%)")
    elif is_saucony and is_sneaker:
        before_discount = final_price_raw
        final_price_raw = final_price_raw * (1.0 - SAUCONY_MARGIN_DISCOUNT)
        print(
            f"[PRICE DEBUG] Saucony margin discount: {before_discount:.2f} → {final_price_raw:.2f} "
            f"(-{SAUCONY_MARGIN_DISCOUNT*100:.0f}%, no default stack)"
        )
    else:
        discount = SNEAKER_MARGIN_DISCOUNT if is_sneaker else CLOTHING_MARGIN_DISCOUNT
        discount_label = "Sneaker" if is_sneaker else "Clothing"
        before_discount = final_price_raw
        final_price_raw = final_price_raw * (1.0 - discount)
        print(
            f"[PRICE DEBUG] {discount_label} margin discount: {before_discount:.2f} → {final_price_raw:.2f} (-{discount*100:.0f}%)"
        )

    # Step 4.6: Low-AOV floor — fixed margin + fulfil when all-in cost ≤ 100 CHF
    if C <= LOW_AOV_COST_THRESHOLD:
        low_aov_floor = C + LOW_AOV_MIN_MARGIN + LOW_AOV_FULFIL
        if final_price_raw < low_aov_floor:
            print(
                f"[PRICE DEBUG] Low-AOV floor: {final_price_raw:.2f} → {low_aov_floor:.2f} "
                f"(C={C:.2f} + {LOW_AOV_MIN_MARGIN} + {LOW_AOV_FULFIL})"
            )
            final_price_raw = low_aov_floor
            mode = "low-AOV floor"

    if is_express:
        before_upsell = final_price_raw
        final_price_raw *= 1.0 + EXPRESS_UPSELL_PCT
        print(
            f"[PRICE DEBUG] Express upsell: {before_upsell:.2f} → {final_price_raw:.2f} "
            f"(+{EXPRESS_UPSELL_PCT * 100:.0f}%)"
        )
        mode = f"{mode} + express upsell"

    # Step 5: Round UP to psychological endings (...9, ...19, ...29, ...39, ...49, ...59, ...69, ...79, ...89, ...99)
    endings = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99]
    base = (int(final_price_raw) // 100) * 100
    final_price = base + 109  # default to next hundred's ...09
    for e in endings:
        cand = base + e
        if cand >= final_price_raw:
            final_price = cand
            break
    
    print(f"[PRICE DEBUG] Final price: {final_price_raw:.2f} → Rounded to {final_price} CHF ({mode})")
    print(f"[PRICE DEBUG] calc_sell_price OUTPUT: {final_price} CHF")
    return final_price


def remove_20(price):
    """Example cost logic: removing 20% from price (or some custom logic)."""
    float_price = float(price)
    return float_price * 0.75


def get_all_location_ids(force_refresh=False):
    """Fetch (and cache) all active location IDs."""
    global _CACHED_LOCATION_IDS
    if _CACHED_LOCATION_IDS is not None and not force_refresh:
        return list(_CACHED_LOCATION_IDS)

    query = """
    query {
      locations(first: 100) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
    """
    data = _run_query(query)
    edges = (data.get("locations") or {}).get("edges") or []
    _CACHED_LOCATION_IDS = [e["node"]["id"] for e in edges if (e.get("node") or {}).get("id")]
    return list(_CACHED_LOCATION_IDS)


def get_online_location_id(force_refresh=False):
    """Primary web-sales location (Chemin de Bas-de-Plan 6). Stock qty 1 goes here."""
    global _CACHED_FIRST_LOCATION_ID
    if _CACHED_FIRST_LOCATION_ID and not force_refresh:
        return _CACHED_FIRST_LOCATION_ID

    configured = (ONLINE_LOCATION_GID or "").strip()
    if configured:
        _CACHED_FIRST_LOCATION_ID = configured
        return _CACHED_FIRST_LOCATION_ID

    query = """
    query {
      locations(first: 100) {
        edges {
          node { id name }
        }
      }
    }
    """
    data = _run_query(query)
    hint = (ONLINE_LOCATION_NAME_HINT or "").strip().lower()
    for edge in (data.get("locations") or {}).get("edges") or []:
        node = edge.get("node") or {}
        name = str(node.get("name") or "").lower()
        if hint and hint in name:
            _CACHED_FIRST_LOCATION_ID = node["id"]
            return _CACHED_FIRST_LOCATION_ID

    edges = (data.get("locations") or {}).get("edges") or []
    if edges:
        _CACHED_FIRST_LOCATION_ID = edges[0]["node"]["id"]
        return _CACHED_FIRST_LOCATION_ID
    _CACHED_FIRST_LOCATION_ID = None
    return None


def get_secondary_location_ids(force_refresh=False):
    """Retail/transfer locations only — activated at qty 0, never primary web stock."""
    global _CACHED_SECONDARY_LOCATION_IDS
    if _CACHED_SECONDARY_LOCATION_IDS is not None and not force_refresh:
        return list(_CACHED_SECONDARY_LOCATION_IDS)

    online = get_online_location_id(force_refresh=force_refresh)
    _CACHED_SECONDARY_LOCATION_IDS = [
        lid for lid in get_all_location_ids(force_refresh=force_refresh)
        if lid and lid != online
    ]
    return list(_CACHED_SECONDARY_LOCATION_IDS)


def get_first_location_id(force_refresh=False):
    """Online sales location where variant stock qty is set (Chemin de Bas-de-Plan 6)."""
    return get_online_location_id(force_refresh=force_refresh)


def bulk_toggle_inventory_item_locations(inventory_item_id, location_ids, activate=True):
    """Ensure inventory item is activated/deactivated at multiple locations."""
    if not inventory_item_id or not location_ids:
        return {"inventoryLevels": [], "userErrors": []}
    updates = [
        {"locationId": lid, "activate": bool(activate)}
        for lid in location_ids
        if lid
    ]
    if not updates:
        return {"inventoryLevels": [], "userErrors": []}

    mutation = """
    mutation ToggleInventoryActivation(
      $inventoryItemId: ID!,
      $updates: [InventoryBulkToggleActivationInput!]!
    ) {
      inventoryBulkToggleActivation(
        inventoryItemId: $inventoryItemId
        inventoryItemUpdates: $updates
      ) {
        inventoryItem { id }
        inventoryLevels {
          id
          location { id name }
          quantities(names: ["available"]) { name quantity }
        }
        userErrors { field message code }
      }
    }
    """
    resp = _run_query(mutation, {"inventoryItemId": inventory_item_id, "updates": updates})
    return (resp.get("inventoryBulkToggleActivation") or {})


def inventory_set_quantities_bulk(quantity_updates, location_id, reason="correction", reference_document_uri=None):
    """
    Set inventory quantities in one mutation (absolute quantities, no pre-read).

    quantity_updates: list of dicts containing:
      - inventoryItemId (or inventory_item_id)
      - quantity
    """
    if not quantity_updates:
        return None
    if not location_id:
        raise Exception("inventory_set_quantities_bulk: missing location_id")

    quantities = []
    seen = set()
    for upd in quantity_updates:
        inv_id = upd.get("inventoryItemId") or upd.get("inventory_item_id")
        if not inv_id:
            continue
        # Keep last value per inventory item ID.
        if inv_id in seen:
            quantities = [q for q in quantities if q["inventoryItemId"] != inv_id]
        seen.add(inv_id)
        quantities.append({
            "inventoryItemId": inv_id,
            "locationId": location_id,
            "quantity": int(upd.get("quantity", 0)),
            "changeFromQuantity": None,
        })

    if not quantities:
        return None

    if not reference_document_uri:
        reference_document_uri = f"gid://resell-lausanne/SyncJob/{int(time.time())}"

    base_input = {
        "name": "available",
        "reason": reason,
        "referenceDocumentUri": reference_document_uri,
        "quantities": quantities,
    }

    use_idempotent = _api_version_at_least(api_version, "2026-01")
    if use_idempotent:
        mutation = """
        mutation InventorySet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
          inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
            inventoryAdjustmentGroup {
              reason
              changes { name delta quantityAfterChange }
            }
            userErrors { code field message }
          }
        }
        """
        variables = {
            "input": base_input,
            "idempotencyKey": str(uuid.uuid4()),
        }
    else:
        mutation = """
        mutation InventorySet($input: InventorySetQuantitiesInput!) {
          inventorySetQuantities(input: $input) {
            inventoryAdjustmentGroup {
              reason
              changes { name delta quantityAfterChange }
            }
            userErrors { code field message }
          }
        }
        """
        variables = {"input": base_input}

    try:
        resp = _run_query(mutation, variables)
    except Exception as e:
        # Backward compatibility: if endpoint rejects @idempotent, retry once without it.
        err = str(e)
        if use_idempotent and ("undefinedDirective" in err or "@idempotent" in err):
            print("[WARNING] @idempotent unsupported by current endpoint, retrying inventorySetQuantities without directive")
            fallback_mutation = """
            mutation InventorySet($input: InventorySetQuantitiesInput!) {
              inventorySetQuantities(input: $input) {
                inventoryAdjustmentGroup {
                  reason
                  changes { name delta quantityAfterChange }
                }
                userErrors { code field message }
              }
            }
            """
            resp = _run_query(fallback_mutation, {"input": base_input})
        else:
            raise

    ue = (resp.get("inventorySetQuantities") or {}).get("userErrors") or []
    if ue:
        raise Exception(f"inventory_set_quantities_bulk userErrors: {ue}")
    return resp

def update_option_name(product_id, option_id, new_name):
    """Update an option's name (e.g., from 'Title' to 'Size')"""
    mutation = """
    mutation productOptionUpdate($productId: ID!, $option: OptionUpdateInput!) {
      productOptionUpdate(productId: $productId, option: $option) {
        product {
          id
          options { id name }
        }
        userErrors { field message }
      }
    }
    """
    variables = {
        "productId": product_id,
        "option": {
            "id": option_id,
            "name": new_name
        }
    }
    data = _run_query(mutation, variables)
    user_errors = data.get("productOptionUpdate", {}).get("userErrors", [])
    if user_errors:
        print(f"[WARNING] Failed to update option name: {user_errors}")
    else:
        print(f"[INFO] Updated option to: '{new_name}'")
    return data


# ---------------------------------------------------------------------------
# Shopify taxonomy category GIDs (verified 2026-04)
_TAXONOMY = {
    # Sneakers / Footwear
    "sneakers":          "gid://shopify/TaxonomyCategory/aa-8-8",
    "shoes":             "gid://shopify/TaxonomyCategory/aa-8-8",
    # Clothing – tops (specific)
    "t-shirts":          "gid://shopify/TaxonomyCategory/aa-1-13-8",
    "tee":               "gid://shopify/TaxonomyCategory/aa-1-13-8",
    "hoodies":           "gid://shopify/TaxonomyCategory/aa-1-13-13",
    "hoodie":            "gid://shopify/TaxonomyCategory/aa-1-13-13",
    "sweatshirts":       "gid://shopify/TaxonomyCategory/aa-1-13-14",
    "sweatshirt":        "gid://shopify/TaxonomyCategory/aa-1-13-14",
    "crewneck":          "gid://shopify/TaxonomyCategory/aa-1-13-14",
    "shirts":            "gid://shopify/TaxonomyCategory/aa-1-13-7",
    "shirt":             "gid://shopify/TaxonomyCategory/aa-1-13-7",
    "polos":             "gid://shopify/TaxonomyCategory/aa-1-13-6",
    "polo":              "gid://shopify/TaxonomyCategory/aa-1-13-6",
    "tank":              "gid://shopify/TaxonomyCategory/aa-1-13-9",
    "tops":              "gid://shopify/TaxonomyCategory/aa-1-13",
    # Clothing – bottoms
    "pants":             "gid://shopify/TaxonomyCategory/aa-1-12",
    "shorts":            "gid://shopify/TaxonomyCategory/aa-1-14",
    # Clothing – outer / misc
    "outerwear":         "gid://shopify/TaxonomyCategory/aa-1-10",
    "jacket":            "gid://shopify/TaxonomyCategory/aa-1-10",
    "jackets":           "gid://shopify/TaxonomyCategory/aa-1-10",
    "activewear":        "gid://shopify/TaxonomyCategory/aa-1-1",
    "socks":             "gid://shopify/TaxonomyCategory/aa-1-18",
    "sock":              "gid://shopify/TaxonomyCategory/aa-1-18",
    "clothing":          "gid://shopify/TaxonomyCategory/aa-1",
    "apparel":           "gid://shopify/TaxonomyCategory/aa-1",
    "streetwear":        "gid://shopify/TaxonomyCategory/aa-1",
    # Accessories
    "accessories":       "gid://shopify/TaxonomyCategory/aa-2",
    "hats":              "gid://shopify/TaxonomyCategory/aa-2",
    "hat":               "gid://shopify/TaxonomyCategory/aa-2",
    "cap":               "gid://shopify/TaxonomyCategory/aa-2",
    "caps":              "gid://shopify/TaxonomyCategory/aa-2",
    "bag":               "gid://shopify/TaxonomyCategory/aa-5",
    "bags":              "gid://shopify/TaxonomyCategory/aa-5",
    "backpack":          "gid://shopify/TaxonomyCategory/aa-5",
    "wallet":            "gid://shopify/TaxonomyCategory/aa-5",
    # Toys / collectibles
    "toys":              "gid://shopify/TaxonomyCategory/tg-5-7-12",
    "collectibles":      "gid://shopify/TaxonomyCategory/tg-5-7-12",
    "lego":              "gid://shopify/TaxonomyCategory/tg-5-7-12",
    # Electronics
    "electronics":       "gid://shopify/TaxonomyCategory/el",
    "tech":              "gid://shopify/TaxonomyCategory/el",
}

# Sporting Goods > Athletics > Basketball > Basketball Shoes (Shopify Standard Product Taxonomy)
from basketball_shoe_rules import (
    TAXONOMY_BASKETBALL_SHOES as _TAXONOMY_BASKETBALL_SHOES,
    is_basketball_shoe_product,
    match_basketball_shoe_series,
    product_data_from_slug,
)
from athletic_shoe_rules import (
    TAXONOMY_ATHLETIC_SHOES as _TAXONOMY_ATHLETIC_SHOES,
    is_athletic_shoe_product,
)

# Re-export for main.py and scripts
__all__ = [
    "is_basketball_shoe_product",
    "sync_basketball_shoe_taxonomy",
    "match_basketball_shoe_series",
    "product_data_from_slug",
    "is_athletic_shoe_product",
    "sync_athletic_shoe_taxonomy",
    "TAXONOMY_ATHLETIC_SHOES",
]


def sync_basketball_shoe_taxonomy(product_id, product_data) -> bool:
    """Assign Shopify taxonomy Basketball Shoes when product_data matches a known series."""
    if not product_id or not is_basketball_shoe_product(product_data):
        return False
    match = match_basketball_shoe_series(product_data)
    print(f"[TAXONOMY] Basketball shoe series={match.get('matched_series')} reason={match.get('reason')}")
    set_product_taxonomy_category(product_id, _TAXONOMY_BASKETBALL_SHOES)
    return True


def sync_athletic_shoe_taxonomy(product_id, product_data) -> bool:
    """Assign Athletic Shoes for StockX Performance / Spikes / Trail (not basketball)."""
    if not product_id or not is_athletic_shoe_product(product_data):
        return False
    from athletic_shoe_rules import athletic_shoe_match_reason
    print(f"[TAXONOMY] Athletic shoe -> {_TAXONOMY_ATHLETIC_SHOES} ({athletic_shoe_match_reason(product_data)})")
    set_product_taxonomy_category(product_id, _TAXONOMY_ATHLETIC_SHOES)
    return True


TAXONOMY_ATHLETIC_SHOES = _TAXONOMY_ATHLETIC_SHOES

def derive_taxonomy_category(product_data):
    """Derive the correct Shopify taxonomy category GID from StockX/Kicks product data.

    Resolution order:
    0. Signature basketball shoe series -> sg-1-3-5 (see basketball_shoe_series.json)
    1. breadcrumbs level-3 (most specific: "T-Shirts", "Hoodies"…)
    2. breadcrumbs level-2 ("Tops", "Bottoms"…)
    3. breadcrumbs level-1 ("Apparel", "Sneakers"…)
    4. product_type field ("streetwear", "sneakers"…)
    5. title keyword scan
    6. default → sneakers
    """
    if is_basketball_shoe_product(product_data):
        print(f"[TAXONOMY] Basketball shoe -> {_TAXONOMY_BASKETBALL_SHOES}")
        return _TAXONOMY_BASKETBALL_SHOES

    if is_athletic_shoe_product(product_data):
        print(f"[TAXONOMY] Athletic shoe (Performance/Spikes/Trail) -> {_TAXONOMY_ATHLETIC_SHOES}")
        return _TAXONOMY_ATHLETIC_SHOES

    breadcrumbs = product_data.get("breadcrumbs") or []
    bc = {int(b.get("level", 0)): (b.get("alias") or b.get("value") or "").lower()
          for b in breadcrumbs if isinstance(b, dict)}

    # Level-3 first (most specific).
    for level in (3, 2, 1):
        alias = bc.get(level, "")
        if alias in _TAXONOMY:
            return _TAXONOMY[alias]

    # product_type field.
    pt = str(product_data.get("product_type") or "").strip().lower()
    if pt in _TAXONOMY:
        return _TAXONOMY[pt]

    # Title keyword scan (longest keyword first to pick most specific).
    title = str(product_data.get("title") or "").lower()
    for kw in sorted(_TAXONOMY.keys(), key=len, reverse=True):
        if kw in title:
            return _TAXONOMY[kw]

    print(f"[TAXONOMY] No match for breadcrumbs={bc} product_type={pt!r}; defaulting to sneakers")
    return _TAXONOMY["sneakers"]


def map_stockx_to_shopify_category(stockx_category, product_title="", brand=""):
    """Map StockX product category string to Shopify taxonomy GID.

    Kept for backward-compat. Prefer derive_taxonomy_category(product_data) for new code.
    """
    category_lower = (stockx_category or "").lower()
    title_lower = (product_title or "").lower()

    if category_lower in _TAXONOMY:
        return _TAXONOMY[category_lower]

    # Title keyword scan.
    for kw in sorted(_TAXONOMY.keys(), key=len, reverse=True):
        if kw in title_lower:
            return _TAXONOMY[kw]

    print(f"[TAXONOMY] Unknown/Unmatched category '{stockx_category}', leaving category unset")
    return None


def get_taxonomy_category_id(category_name="Sneakers"):
    """
    Query Shopify taxonomy to get the category ID for Google Merchant Center mapping.
    Uses childrenOf to find subcategories under "Shoes" (gid://shopify/TaxonomyCategory/aa-8)
    Returns the taxonomy category ID (e.g., gid://shopify/TaxonomyCategory/aa-8-8)
    """
    # Known parent category IDs
    SHOES_CATEGORY_ID = "gid://shopify/TaxonomyCategory/aa-8"
    
    query = """
    query ($parentId: ID!) {
      taxonomy {
        categories(first: 250, childrenOf: $parentId) {
          nodes {
            id
            name
            fullName
          }
        }
      }
    }
    """
    try:
        # Get all children of "Shoes" category
        data = _run_query(query, {"parentId": SHOES_CATEGORY_ID})
        categories = data.get("taxonomy", {}).get("categories", {}).get("nodes", [])
        
        # Find the category that matches our search
        for category in categories:
            if category.get("name", "").lower() == category_name.lower():
                category_id = category["id"]
                category_full_name = category["fullName"]
                print(f"[TAXONOMY] Mapped '{category_name}' to: {category_full_name} ({category_id})")
                return category_id
        
        print(f"[TAXONOMY] No match found for '{category_name}' under Shoes, using default")
        return None
    except Exception as e:
        print(f"[TAXONOMY] Error querying taxonomy: {e}")
        return None


def get_category_attributes(category_id):
    """
    Get the attributes for a specific Shopify taxonomy category.
    Returns list of attributes like color, material, style, etc.
    """
    query = """
    query ($categoryId: ID!) {
      taxonomy {
        categories(first: 1, ids: [$categoryId]) {
          nodes {
            id
            name
            attributes(first: 50) {
              nodes {
                id
                name
                type
                description
              }
            }
          }
        }
      }
    }
    """
    try:
        data = _run_query(query, {"categoryId": category_id})
        categories = data.get("taxonomy", {}).get("categories", {}).get("nodes", [])
        if categories:
            attributes = categories[0].get("attributes", {}).get("nodes", [])
            print(f"[TAXONOMY] Found {len(attributes)} attributes for category {category_id}")
            return attributes
        return []
    except Exception as e:
        print(f"[TAXONOMY] Error querying category attributes: {e}")
        return []


def create_product(product_info):
    """Create a new product shell with a stable handle, Taille option, and Shopify taxonomy category."""
    mutation = """
    mutation createProduct($input: ProductInput!) {
      productCreate(input: $input) {
        product {
          id
          title
          handle
          options { id name }
          category { id name fullName }
        }
        userErrors { field message }
      }
    }
    """
    # Resolve taxonomy category. Priority: precomputed GID > raw_vendor breadcrumbs > string mapping.
    product_title = product_info.get("title", "")
    brand = product_info.get("brand", "")
    stockx_category = product_info.get("productCategory", "sneakers")

    taxonomy_category_id = (
        product_info.get("taxonomyCategory")          # set by process_url via derive_taxonomy_category
        or product_info.get("taxonomy_category_id")   # legacy explicit override
    )
    if not taxonomy_category_id:
        raw_vendor = product_info.get("__raw_vendor__")
        if raw_vendor:
            taxonomy_category_id = derive_taxonomy_category(raw_vendor)
        else:
            taxonomy_category_id = map_stockx_to_shopify_category(stockx_category, product_title, brand)
    print(f"[TAXONOMY] Category for '{product_title}': {taxonomy_category_id}")

    product_type_label = product_info.get("productType")
    if not product_type_label:
        raw_for_type = product_info.get("__raw_vendor__") or product_info
        if is_basketball_shoe_product(raw_for_type):
            product_type_label = "Basketball Shoes"
        else:
            product_type_label = str(stockx_category).title() if stockx_category else "General"

    # Expect product_info["handle"] to be precomputed (from StockX slug)
    product_input = {
        "title": product_info["title"],
        "handle": product_info.get("handle"),     # important for dedupe
        "vendor": product_info.get("brand") or "Unknown",
        "productType": product_type_label,
        "tags": product_info.get("tags") or ["New"],
        "descriptionHtml": product_info.get("description") or ""
    }
    
    # Add taxonomy category if found
    if taxonomy_category_id:
        product_input["category"] = taxonomy_category_id
    data = _run_query(mutation, {"input": product_input})
    user_errors = data["productCreate"].get("userErrors", [])
    if user_errors:
        raise Exception(f"Product Creation Errors: {user_errors}")
    
    product = data["productCreate"]["product"]
    product_id = product["id"]
    
    # Print taxonomy category info
    category = product.get("category")
    if category:
        print(f"[TAXONOMY] Product category set: {category.get('fullName')} (ID: {category.get('id')})")
    
    # Get the option ID (should be the first and only option)
    option_id = product["options"][0]["id"] if product.get("options") else None
    
    # Rename the default "Title" option to "Taille" (French for Size)
    if product.get("options") and len(product["options"]) > 0:
        option_name = product["options"][0]["name"]
        print(f"[INFO] Created product with option: '{option_name}' (ID: {option_id})")
        
        # If Shopify created it as "Title", rename it to "Taille"
        if option_name != "Taille":
            print(f"[INFO] Renaming option from '{option_name}' to 'Taille'...")
            update_option_name(product_id, option_id, "Taille")
    
    return product_id, option_id



def extract_product_attributes(product_data):
    """
    Extract useful product attributes from StockX data for Shopify Standard Metafields.
    Returns a dict with standard metafield keys for Google Merchant Center optimization.
    """
    attributes = {}
    
    # 1. TARGET GENDER (shopify.target-gender)
    # Values: "female", "male", "unisex"
    gender = product_data.get("gender", "").strip().lower()
    if gender in ["women", "female", "womens"]:
        attributes["target-gender"] = "female"
    elif gender in ["men", "male", "mens"]:
        attributes["target-gender"] = "male"
    else:
        attributes["target-gender"] = "unisex"
    
    # 2. COLOR (shopify.color-pattern)
    # Primary color from traits. Kicks uses 'trait' key; StockX may use 'name'.
    primary_color = None
    traits = product_data.get("traits", [])
    for trait in traits:
        if isinstance(trait, dict):
            name = (trait.get("trait") or trait.get("name") or "").lower()
            if name in ["primary color", "colorway", "color"]:
                primary_color = trait.get("value", "")
                break
    
    if primary_color:
        # Clean up color value (e.g., "Clove" or "Multi-Color")
        attributes["color-pattern"] = primary_color.strip()
    
    # 3. ACTIVITY (shopify.activity)
    # Map subcategory to activity/sport
    subcategory = None
    breadcrumbs = product_data.get("breadcrumbs", [])
    for bc in breadcrumbs:
        if isinstance(bc, dict) and bc.get("level") == 2:
            subcategory = bc.get("value", "")
            break
    
    if subcategory:
        # Map common subcategories to activities
        subcategory_lower = subcategory.lower()
        if "basketball" in subcategory_lower:
            attributes["activity"] = "basketball"
        elif "running" in subcategory_lower or "performance" in subcategory_lower:
            attributes["activity"] = "running"
        elif "soccer" in subcategory_lower or "football" in subcategory_lower:
            attributes["activity"] = "soccer"
        elif "skateboard" in subcategory_lower:
            attributes["activity"] = "skateboarding"
        elif "tennis" in subcategory_lower:
            attributes["activity"] = "tennis"
        elif "training" in subcategory_lower or "gym" in subcategory_lower:
            attributes["activity"] = "training"
        elif "lifestyle" in subcategory_lower or "casual" in subcategory_lower:
            attributes["activity"] = "lifestyle"
        else:
            # Use the subcategory as-is if no mapping found
            attributes["activity"] = subcategory.lower()

    if not attributes.get("activity") and is_basketball_shoe_product(product_data):
        attributes["activity"] = "basketball"
    
    # 4. AGE GROUP (shopify.age-group)
    # Values: "adult", "teen", "kids", "toddler", "infant", "newborn"
    gender_raw = product_data.get("gender", "").strip().lower()
    if "kid" in gender_raw or "child" in gender_raw or "youth" in gender_raw:
        attributes["age-group"] = "kids"
    elif "infant" in gender_raw or "baby" in gender_raw:
        attributes["age-group"] = "infant"
    elif "toddler" in gender_raw:
        attributes["age-group"] = "toddler"
    else:
        attributes["age-group"] = "adult"
    
    # 5. MATERIAL (shopify.material) - Optional
    # Try to extract from traits if available
    material = None
    for trait in traits:
        if isinstance(trait, dict):
            name = (trait.get("trait") or trait.get("name") or "").lower()
            if name in ["material", "upper material", "fabric"]:
                material = trait.get("value", "")
                break
    
    if material:
        attributes["material"] = material.strip()
    
    # Store original values for backward compatibility
    attributes["subcategory"] = breadcrumbs[1].get("value") if len(breadcrumbs) > 1 and isinstance(breadcrumbs[1], dict) else None
    attributes["model"] = product_data.get("title", "").split(" - ")[0] if " - " in product_data.get("title", "") else None
    attributes["country_of_origin"] = product_data.get("country_of_origin")
    
    return attributes


def extract_product_attributes_legacy(product_data):
    """
    LEGACY VERSION - Extract custom metafield attributes.
    This is kept for backwards compatibility but we now use standard metafields.
    """
    attributes = {
        "product_type": "Sneakers",  # default
        "sneaker_style": None,
        "primary_color": None,
        "gender": None,
        "subcategory": None,
        "model": None,
        "country_of_origin": None
    }
    
    # Product type from StockX
    product_type = product_data.get("product_type", "").lower()
    if "sneaker" in product_type:
        attributes["product_type"] = "Sneakers"
    elif "apparel" in product_type or "clothing" in product_type:
        attributes["product_type"] = "Apparel"
    elif "accessory" in product_type or "accessories" in product_type:
        attributes["product_type"] = "Accessories"
    
    # Gender
    gender = product_data.get("gender", "").strip().lower()
    if gender in ["men", "male", "mens"]:
        attributes["gender"] = "Men"
    elif gender in ["women", "female", "womens"]:
        attributes["gender"] = "Women"
    elif gender in ["kids", "child", "youth"]:
        attributes["gender"] = "Kids"
    elif gender in ["unisex", "adult"]:
        attributes["gender"] = "Unisex"
    else:
        attributes["gender"] = "Unisex"  # Default
    
    # Subcategory from breadcrumbs (Level 2: e.g., "Performance", "Lifestyle", "Basketball")
    breadcrumbs = product_data.get("breadcrumbs", [])
    for bc in breadcrumbs:
        if isinstance(bc, dict) and bc.get("level") == 2:
            attributes["subcategory"] = bc.get("value", "")
            break
    
    # Model name (e.g., "Air Jordan 1", "Nike Dunk")
    model = product_data.get("model", "").strip()
    if model:
        attributes["model"] = model
    
    # Country of manufacture/origin
    country = product_data.get("country_of_manufacture", "").strip()
    if country:
        attributes["country_of_origin"] = country
    
    # Sneaker style (Low-top, Mid-top, High-top)
    title = product_data.get("title", "").lower()
    category = product_data.get("category", "").lower()
    
    if any(x in title or x in category for x in ["high", "hi top", "hi-top"]):
        attributes["sneaker_style"] = "High-top"
    elif any(x in title or x in category for x in ["mid", "mid top", "mid-top"]):
        attributes["sneaker_style"] = "Mid-top"
    elif any(x in title or x in category for x in ["low", "low top", "low-top"]):
        attributes["sneaker_style"] = "Low-top"
    else:
        # Default to Low-top for most sneakers
        attributes["sneaker_style"] = "Low-top"
    
    # Primary color from colorway trait
    traits = product_data.get("traits", [])
    for trait in traits:
        if trait.get("trait", "").lower() == "colorway":
            colorway = trait.get("value", "")
            # Extract first color (before slash or dash)
            if colorway:
                first_color = colorway.split("/")[0].split("-")[0].strip()
                attributes["primary_color"] = first_color
            break
    
    return attributes


def set_product_metafield(product_id, category_value):
    """
    Sets a single 'product_category' metafield for backwards compatibility.
    Example usage: set_product_metafield(product_id, "sneakers")
    """
    query = """
    mutation SetCategoryMetafield($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
          type
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    
    variables = {
        "metafields": [
            {
                "ownerId": product_id,
                "namespace": "categories",
                "key": "product_category",
                "type": "single_line_text_field",
                "value": category_value
            }
        ]
    }
    
    response = _run_query(query, variables)
    errors = response.get("metafieldsSet", {}).get("userErrors", [])
    if errors:
        print("[ERROR] Could not set category metafield:", errors)
    return response


def set_variant_structured_metafields(variant_payloads):
    """Set all structured variant-level metafields in one bulk call.

    variant_payloads: list of dicts:
      {
        "variantId": gid,
        "us_size": "9.5",           # optional
        "express_available": True,  # optional bool
        "gender": "male",           # product-level, optional
        "age_group": "adult",       # product-level, optional
        "mpn": "IB4025-100-40",     # variant SKU, optional
        "size_system": "EU",        # optional, default "EU"
        "condition": "new",         # optional, default "new"
      }
    Returns list of errors (empty = success).
    """
    if not variant_payloads:
        return []

    GOOGLE_GENDER = {
        "male": "male", "men": "male", "mens": "male",
        "female": "female", "women": "female", "womens": "female",
        "unisex": "unisex",
    }
    GOOGLE_AGE = {
        "adult": "adult", "adults": "adult",
        "kids": "kids", "kid": "kids", "children": "kids", "youth": "kids",
        "teen": "adult", "toddler": "kids", "infant": "kids",
        "universal": "adult",
    }

    query = """
    mutation SetVariantMeta($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id ownerType namespace key value }
        userErrors { field message }
      }
    }
    """

    inputs = []
    for vp in variant_payloads:
        vid = vp.get("variantId")
        if not vid:
            continue

        def add(ns, key, mtype, value):
            if value is None or value == "":
                return
            inputs.append({
                "ownerId": vid,
                "namespace": ns,
                "key": key,
                "type": mtype,
                "value": str(value),
            })

        # custom.us_size
        us = vp.get("us_size")
        if us:
            clean = str(us).replace("US M", "").replace("US W", "").replace("US", "").strip()
            add("custom", "us_size", "single_line_text_field", clean)

        # custom.express_available
        ea = vp.get("express_available")
        if ea is not None:
            add("custom", "express_available", "boolean", "true" if ea else "false")

        # mm-google-shopping.*
        gender_raw = str(vp.get("gender") or "").strip().lower()
        g_gender = GOOGLE_GENDER.get(gender_raw, "unisex")
        add("mm-google-shopping", "gender", "single_line_text_field", g_gender)

        age_raw = str(vp.get("age_group") or "adult").strip().lower()
        g_age = GOOGLE_AGE.get(age_raw, "adult")
        add("mm-google-shopping", "age_group", "single_line_text_field", g_age)

        add("mm-google-shopping", "condition", "single_line_text_field", vp.get("condition", "new"))
        add("mm-google-shopping", "size_system", "single_line_text_field", vp.get("size_system", "EU"))
        add("mm-google-shopping", "size_type", "single_line_text_field", vp.get("size_type", "regular"))

        mpn = vp.get("mpn")
        if mpn:
            add("mm-google-shopping", "mpn", "single_line_text_field", mpn)

    if not inputs:
        return []

    # Shopify caps metafieldsSet at 25 per call.
    all_errors = []
    chunk_size = 25
    for i in range(0, len(inputs), chunk_size):
        chunk = inputs[i:i + chunk_size]
        resp = _run_query(query, {"metafields": chunk})
        errs = (resp.get("metafieldsSet") or {}).get("userErrors") or []
        if errs:
            all_errors.extend(errs)

    if all_errors:
        print(f"[WARNING] set_variant_structured_metafields errors: {all_errors}")
    else:
        print(f"[INFO] Variant structured metafields set for {len(variant_payloads)} variants")
    return all_errors


def set_variant_express_price_metafields(variant_prices, namespace="custom", key="express_price"):
    """
    Set express sell prices on variants via metafieldsSet.
    variant_prices: [{"variantId": gid, "price": 199}, ...]
    """
    if not variant_prices:
        return None

    def build_inputs(value_type):
        inputs = []
        for entry in variant_prices:
            variant_id = entry.get("variantId") or entry.get("variant_id")
            price = entry.get("price")
            if not variant_id or price is None:
                continue
            if value_type == "money":
                value = json.dumps({
                    "amount": f"{float(price):.2f}",
                    "currency_code": "CHF",
                }, separators=(",", ":"))
            else:
                value = f"{float(price):.2f}"
            inputs.append({
                "ownerId": variant_id,
                "namespace": namespace,
                "key": key,
                "type": value_type,
                "value": value,
            })
        return inputs

    query = """
    mutation SetVariantExpressMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          ownerType
          namespace
          key
          value
          type
        }
        userErrors {
          field
          message
        }
      }
    }
    """

    metafields_input = build_inputs("money")
    if not metafields_input:
        return None

    response = _run_query(query, {"metafields": metafields_input})
    result = response.get("metafieldsSet", {})
    errors = result.get("userErrors", []) or []

    if errors:
        print(f"[ERROR] Could not set variant express metafields: {errors}")
    else:
        print(f"[SUCCESS] Set express metafield on {len(result.get('metafields', []) or [])} variants")
    return response


def set_standard_metafields(product_id, attributes):
    """
    Sets Shopify STANDARD metafields for a product (best for Google Merchant Center).
    Uses the 'shopify' namespace with standard keys like 'target-gender', 'color-pattern', etc.
    
    Example: set_standard_metafields(product_id, {
        "target-gender": "female",
        "color-pattern": "Blue",
        "activity": "running",
        "age-group": "adult",
        "material": "leather"
    })
    """
    query = """
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
          type
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    
    # Map of standard metafield keys to their Shopify types
    standard_metafields = {
        "target-gender": "single_line_text_field",
        "color-pattern": "single_line_text_field", 
        "activity": "single_line_text_field",
        "age-group": "single_line_text_field",
        "material": "single_line_text_field"
    }
    
    metafields_input = []
    
    # Only include metafields that have values
    for key, metafield_type in standard_metafields.items():
        value = attributes.get(key)
        if value:
            metafields_input.append({
                "ownerId": product_id,
                "namespace": "shopify",  # STANDARD namespace
                "key": key,
                "type": metafield_type,
                "value": str(value)
            })
    
    if not metafields_input:
        print("[INFO] No standard metafields to set")
        return
    
    print(f"[DEBUG] Setting {len(metafields_input)} standard metafields: {', '.join([mf['key'] for mf in metafields_input])}")

    variables = {"metafields": metafields_input}
    response = _run_query(query, variables)
    result = response.get("metafieldsSet", {})
    metafields = result.get("metafields", []) or []
    errors = result.get("userErrors", []) or []

    # Retry individual keys that failed due to definition type mismatches so
    # one bad definition does not kill the rest of the bundle.
    if errors:
        bad_indices = set()
        for err in errors:
            for token in (err.get("field") or []):
                if isinstance(token, int):
                    bad_indices.add(token)
                elif isinstance(token, str) and token.isdigit():
                    bad_indices.add(int(token))
        if bad_indices:
            retry = []
            for i, mf in enumerate(metafields_input):
                if i in bad_indices:
                    # Skip retry; keep going so the rest still apply on next call.
                    print(f"[WARNING] shopify.{mf['key']} rejected by store definition; skipping (value={mf['value']})")
                    continue
                retry.append(mf)
            if retry and len(retry) != len(metafields_input):
                response = _run_query(query, {"metafields": retry})
                result = response.get("metafieldsSet", {})
                metafields = result.get("metafields", []) or []
                errors = result.get("userErrors", []) or []

    if errors:
        print(f"[WARNING] Standard metafield errors after retries: {errors}")
    if metafields:
        print(f"[SUCCESS] Set {len(metafields)} standard metafields:")
        for mf in metafields:
            print(f"   • shopify.{mf['key']} = {mf['value']}")
    return response


# ----------------------------------------------------------------------------
# Shopify taxonomy metaobject resolver.
# shopify.* product metafields expect list.metaobject_reference where each
# entry is a GID pointing at a taxonomy metaobject (e.g. shopify--color-pattern).
# Cache fetched entries per definition type so resolution stays cheap.
_TAXONOMY_CACHE = {}
_TAXONOMY_FETCH_LOCK = None  # not multi-threaded here; cache writes are fine.

# StockX -> taxonomy metaobject handle aliases.
_ALIAS_TARGET_GENDER = {
    "male": "masculin", "men": "masculin", "mens": "masculin", "masculin": "masculin",
    "female": "feminin", "women": "feminin", "womens": "feminin", "feminin": "feminin", "féminin": "feminin",
    "unisex": "unisexe", "unisexe": "unisexe",
}
_ALIAS_AGE_GROUP = {
    "adult": "adultes", "adults": "adultes", "adultes": "adultes",
    "kids": "enfants", "kid": "enfants", "child": "enfants", "children": "enfants", "youth": "enfants",
    "toddler": "enfants", "infant": "enfants", "baby": "enfants", "enfants": "enfants",
    "teen": "adolescents", "teens": "adolescents", "adolescent": "adolescents", "adolescents": "adolescents",
    "universal": "universal", "all-ages": "tous-ages", "tous-ages": "tous-ages",
}
_ALIAS_ACTIVITY = {
    "basketball": "basket-ball", "basket": "basket-ball", "basket-ball": "basket-ball",
    "running": "course", "run": "course", "course": "course",
    "soccer": "football", "football": "football",
    "skateboard": "skateboarding", "skateboarding": "skateboarding", "skate": "skateboarding",
    "handball": "handball",
    "hiking": "randonnee", "trail": "randonnee", "randonnee": "randonnee", "randonnée": "randonnee",
    "taekwondo": "taekwondo", "martial-arts": "taekwondo",
    "lifestyle": "universel", "casual": "universel", "training": "universel",
    "tennis": "universel", "gym": "universel", "performance": "universel",
    "universel": "universel",
}
_ALIAS_SNEAKER_STYLE = {
    "low": "bas", "low-top": "bas", "bas": "bas",
    "high": "montant", "high-top": "montant", "mid": "montant", "mid-top": "montant", "montant": "montant",
    "slip-on": "a-enfiler", "slip": "a-enfiler",
    "fashion": "fashion", "athletic": "athletique", "athletique": "athletique", "athlétique": "athletique",
}
_ALIAS_FOOTWEAR_MATERIAL = {
    "leather": "cuir", "cuir": "cuir",
    "suede": "suede", "suède": "suede",
    "synthetic": "synthetique", "synthétique": "synthetique",
    "mesh": "a-mailles",
    "rubber": "caoutchouc", "caoutchouc": "caoutchouc",
    "canvas": "toiles", "toile": "toiles", "toiles": "toiles",
    "nylon": "nylon",
    "cotton": "coton", "coton": "coton",
    "polyester": "polyester",
    "satin": "satine", "satiné": "satine",
    "wool": "laine", "laine": "laine",
    "tpu": "polyurethane-thermoplastique-tpu",
    "neoprene": "neoprene", "néoprène": "neoprene",
}
# Color keyword -> taxonomy handle. Multiple matches allowed (list.* metafield).
_ALIAS_COLOR_PATTERN = {
    "black": "noir", "noir": "noir", "matte black": "noir-mate",
    "white": "blanc", "blanc": "blanc", "ivory": "blanc", "coconut": "coconut",
    "red": "rouge", "rouge": "rouge", "crimson": "rouge",
    "burgundy": "bordeau", "wine": "bordeau", "maroon": "bordeau",
    "blue": "bleu", "bleu": "bleu", "cobalt": "bleu", "royal": "bleu",
    "navy": "marine", "midnight": "marine", "marine": "marine",
    "baby blue": "baby-blue", "light blue": "baby-blue", "sky": "baby-blue",
    "grey-blue": "gris-bleu", "gray-blue": "gris-bleu",
    "green": "vert", "vert": "vert", "olive": "vert", "forest": "vert",
    "mint": "mint-green", "mint green": "mint-green",
    "yellow": "jaune", "jaune": "jaune", "gold": "jaune",
    "brown": "marron", "marron": "marron", "tan": "marron", "chocolate": "marron",
    "grey": "gris", "gray": "gris", "gris": "gris", "charcoal": "gris",
    "silver": "argent", "argent": "argent", "chrome": "argent", "metallic silver": "argent",
    "pink": "rose", "rose": "rose",
    "light pink": "rose-claire", "rose-claire": "rose-claire",
    "beige": "beige", "cream": "beige", "sand": "beige",
    "dark-beige": "beige-claire",
    "orange": "orange",
    "purple": "lavender", "lavender": "lavender", "violet": "lavender",
    "turquoise": "turquoise", "teal": "turquoise",
    "multi": "multicolore", "multi-color": "multicolore", "multicolor": "multicolore", "multicolour": "multicolore",
    "animal": "animal",
}


def _load_metaobject_entries(metaobject_type):
    """Return list of {id, handle, displayName} for a definition type. Cached."""
    if metaobject_type in _TAXONOMY_CACHE:
        return _TAXONOMY_CACHE[metaobject_type]
    query = """
    query Entries($type: String!, $first: Int!, $after: String) {
      metaobjects(type: $type, first: $first, after: $after) {
        nodes { id handle displayName }
        pageInfo { hasNextPage endCursor }
      }
    }
    """
    items = []
    after = None
    try:
        while True:
            resp = _run_query(query, {"type": metaobject_type, "first": 100, "after": after})
            block = resp.get("metaobjects") or {}
            items.extend(block.get("nodes") or [])
            page = block.get("pageInfo") or {}
            if not page.get("hasNextPage"):
                break
            after = page.get("endCursor")
    except Exception as e:
        print(f"[WARNING] _load_metaobject_entries({metaobject_type}) failed: {e}")
    _TAXONOMY_CACHE[metaobject_type] = items
    return items


def _normalize_token(s):
    return re.sub(r"[^a-z0-9]+", " ", str(s or "").lower()).strip()


def _resolve_taxonomy_gid(metaobject_type, raw_value, alias_map=None):
    """Resolve single value -> metaobject GID via alias map + handle/displayName."""
    if not raw_value:
        return None
    entries = _load_metaobject_entries(metaobject_type)
    if not entries:
        return None
    by_handle = {e.get("handle"): e.get("id") for e in entries if e.get("handle")}
    by_display = {_normalize_token(e.get("displayName")): e.get("id") for e in entries if e.get("displayName")}

    key = _normalize_token(raw_value)
    if alias_map:
        # Try alias exact match.
        if key in alias_map and alias_map[key] in by_handle:
            return by_handle[alias_map[key]]
        # Hyphenated alias match (e.g. "low-top").
        hyphen = key.replace(" ", "-")
        if hyphen in alias_map and alias_map[hyphen] in by_handle:
            return by_handle[alias_map[hyphen]]
        # Substring alias match.
        for token, handle in alias_map.items():
            if token in key and handle in by_handle:
                return by_handle[handle]
    # Direct handle/display match.
    hyphen = key.replace(" ", "-")
    if hyphen in by_handle:
        return by_handle[hyphen]
    if key in by_display:
        return by_display[key]
    return None


def _resolve_color_gids(raw_value):
    """Resolve a StockX-style colorway string -> list of color metaobject GIDs.

    StockX colorway is multi-token (e.g. "Cobalt Bliss/Metallic Silver/Midnight Navy");
    return deduped list of matched GIDs.
    """
    if not raw_value:
        return []
    entries = _load_metaobject_entries("shopify--color-pattern")
    if not entries:
        return []
    by_handle = {e.get("handle"): e.get("id") for e in entries if e.get("handle")}

    raw = str(raw_value).lower()
    tokens = re.split(r"[\/,&]| and | with ", raw)
    found = []
    seen = set()
    # First pass: exact alias against whole token / phrase.
    for tok in tokens:
        tok_norm = _normalize_token(tok)
        if not tok_norm:
            continue
        matched_handle = None
        # Try long phrases first to prefer specific matches like "metallic silver".
        for phrase, handle in sorted(_ALIAS_COLOR_PATTERN.items(), key=lambda kv: -len(kv[0])):
            if phrase in tok_norm and handle in by_handle:
                matched_handle = handle
                break
        if matched_handle and matched_handle not in seen:
            seen.add(matched_handle)
            found.append(by_handle[matched_handle])
    return found


def set_standard_metafields_v2(product_id, attributes, raw_product_data=None, taxonomy_category_id=None, allow_category_fix=True):
    """Set shopify.* standard metafields as list.metaobject_reference.

    attributes: dict from extract_product_attributes (string values).
    raw_product_data: optional Kicks/StockX payload for richer source (material, silhouette).
    Returns dict {attempted, succeeded, skipped}.
    """
    result = {"attempted": [], "succeeded": [], "skipped": []}
    if not product_id:
        return result

    # Build per-key list of GIDs.
    payload = []

    def _push(key, gids):
        if not gids:
            result["skipped"].append({"key": key, "reason": "no_taxonomy_match"})
            return
        result["attempted"].append(key)
        payload.append({
            "ownerId": product_id,
            "namespace": "shopify",
            "key": key,
            "type": "list.metaobject_reference",
            "value": json.dumps(gids, separators=(",", ":")),
        })

    # target-gender.
    gid = _resolve_taxonomy_gid("shopify--target-gender", attributes.get("target-gender"), _ALIAS_TARGET_GENDER)
    _push("target-gender", [gid] if gid else [])
    # age-group.
    gid = _resolve_taxonomy_gid("shopify--age-group", attributes.get("age-group"), _ALIAS_AGE_GROUP)
    _push("age-group", [gid] if gid else [])
    # activity.
    gid = _resolve_taxonomy_gid("shopify--activity", attributes.get("activity"), _ALIAS_ACTIVITY)
    _push("activity", [gid] if gid else [])
    # color-pattern (multi).
    colorway = None
    if raw_product_data:
        colorway = _trait_lookup(raw_product_data, "colorway", "color", "primary color")
    color_source = colorway or attributes.get("color-pattern")
    color_gids = _resolve_color_gids(color_source) if color_source else []
    _push("color-pattern", color_gids)
    # footwear-material.
    material_value = None
    if raw_product_data:
        material_value = _trait_lookup(raw_product_data, "material", "upper material", "fabric")
    material_value = material_value or attributes.get("material")
    gid = _resolve_taxonomy_gid("shopify--footwear-material", material_value, _ALIAS_FOOTWEAR_MATERIAL) if material_value else None
    _push("footwear-material", [gid] if gid else [])
    # sneaker-style derived from title/silhouette hints.
    sneaker_style_source = None
    if raw_product_data:
        sneaker_style_source = (
            _trait_lookup(raw_product_data, "silhouette")
            or raw_product_data.get("title")
        )
    gid = _resolve_taxonomy_gid("shopify--sneaker-style", sneaker_style_source, _ALIAS_SNEAKER_STYLE) if sneaker_style_source else None
    _push("sneaker-style", [gid] if gid else [])

    if not payload:
        return result

    query = """
    mutation SetStandardMetafieldsV2($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message code }
      }
    }
    """

    def _run(p):
        return _run_query(query, {"metafields": p})

    response = _run(payload)
    res = response.get("metafieldsSet", {}) or {}
    errors = res.get("userErrors", []) or []

    # If owner subtype mismatch: only fix category on CREATE (allow_category_fix=True).
    # On UPDATE, never override a manually-maintained category.
    needs_category_fix = any("Owner subtype" in str(e.get("message", "")) for e in errors)
    if needs_category_fix and allow_category_fix:
        fix_cat = taxonomy_category_id or (
            derive_taxonomy_category(raw_product_data) if raw_product_data else "gid://shopify/TaxonomyCategory/aa-8-8"
        )
        try:
            set_product_taxonomy_category(product_id, fix_cat)
            response = _run(payload)
            res = response.get("metafieldsSet", {}) or {}
            errors = res.get("userErrors", []) or []
        except Exception as e:
            print(f"[WARNING] category fix failed: {e}")
    elif needs_category_fix and not allow_category_fix:
        print(f"[INFO] Owner subtype mismatch on update — category preserved, shopify.* metafields skipped for {product_id}")

    # Per-key retry: drop keys that still fail.
    if errors:
        bad_idx = set()
        for err in errors:
            for token in (err.get("field") or []):
                if isinstance(token, int):
                    bad_idx.add(token)
                elif isinstance(token, str) and token.isdigit():
                    bad_idx.add(int(token))
        if bad_idx:
            retry = []
            for i, mf in enumerate(payload):
                if i in bad_idx:
                    result["skipped"].append({"key": mf["key"], "reason": "rejected_by_store"})
                    print(f"[WARNING] shopify.{mf['key']} rejected: dropping")
                    continue
                retry.append(mf)
            if retry and len(retry) != len(payload):
                response = _run(retry)
                res = response.get("metafieldsSet", {}) or {}
                errors = res.get("userErrors", []) or []

    succeeded_nodes = res.get("metafields", []) or []
    result["succeeded"] = [n.get("key") for n in succeeded_nodes if n.get("key")]
    if errors:
        print(f"[WARNING] set_standard_metafields_v2 final errors: {errors}")
    print(f"[INFO] shopify.* metafields attempted={result['attempted']} succeeded={result['succeeded']} skipped={[s['key'] for s in result['skipped']]}")
    return result


def set_product_taxonomy_category(product_id, category_id):
    """Set product.category to a taxonomy category GID (e.g. aa-8-8). Idempotent."""
    if not product_id or not category_id:
        return None
    mutation = """
    mutation SetCategory($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id category { id name } }
        userErrors { field message }
      }
    }
    """
    variables = {"input": {"id": product_id, "category": category_id}}
    resp = _run_query(mutation, variables)
    errors = (resp.get("productUpdate") or {}).get("userErrors", []) or []
    if errors:
        print(f"[WARNING] set_product_taxonomy_category errors: {errors}")
    else:
        print(f"[INFO] Category set on {product_id} -> {category_id}")
    return resp


def _trait_lookup(raw, *names):
    """Lookup trait value from Kicks/StockX product payload.
    Supports both 'trait' (Kicks) and 'name' (StockX) keys.
    """
    if not isinstance(raw, dict):
        return None
    targets = {str(n).strip().lower() for n in names if n}
    for t in raw.get("traits", []) or []:
        if not isinstance(t, dict):
            continue
        n = (t.get("trait") or t.get("name") or "").strip().lower()
        if n in targets:
            v = t.get("value")
            if v is None:
                return None
            v = str(v).strip()
            return v or None
    return None


def _normalize_release_date(value):
    """Return YYYY-MM-DD or None if cannot parse."""
    if not value:
        return None
    s = str(value).strip()
    if not s:
        return None
    # Common StockX formats: 'YYYY-MM-DD', 'YYYY-MM-DDTHH:MM:SS', 'Month D, YYYY'
    fmts = ["%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%SZ", "%B %d, %Y", "%b %d, %Y", "%m/%d/%Y"]
    import datetime as _dt
    for f in fmts:
        try:
            return _dt.datetime.strptime(s.split("T")[0] if f.startswith("%Y-%m-%d") and "T" in s and f == "%Y-%m-%d" else s, f).strftime("%Y-%m-%d")
        except Exception:
            continue
    # Substring ISO date fallback
    m = re.search(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return f"{m.group(1)}-{m.group(2)}-{m.group(3)}"
    return None


def _normalize_decimal(value):
    """Return string decimal or None."""
    if value is None:
        return None
    try:
        f = float(value)
        if f <= 0:
            return None
        return f"{f:.2f}"
    except (TypeError, ValueError):
        s = str(value).strip()
        m = re.search(r"\d+(?:[.,]\d+)?", s.replace(" ", ""))
        if not m:
            return None
        try:
            f = float(m.group(0).replace(",", "."))
            return f"{f:.2f}" if f > 0 else None
        except ValueError:
            return None


def set_required_product_metafields(product_id, raw_product_data):
    """Set required custom.* product metafields for SEO/SEA/GMC/AI.

    Idempotent via metafieldsSet (namespace+key+ownerId is the merge key).
    Returns dict: {attempted: [...], succeeded: [...], skipped: [{key, reason}]}.
    """
    result = {"attempted": [], "succeeded": [], "skipped": []}
    if not product_id or not isinstance(raw_product_data, dict):
        return result

    # Source values from traits / top-level fields.
    model = _trait_lookup(raw_product_data, "model") or (raw_product_data.get("model") or None)
    if not model:
        title = raw_product_data.get("title") or ""
        if isinstance(title, str) and " - " in title:
            model = title.split(" - ")[0].strip() or None

    colorway = _trait_lookup(raw_product_data, "colorway", "color")
    style_code = (
        _trait_lookup(raw_product_data, "style", "style id", "style code")
        or raw_product_data.get("sku")
        or raw_product_data.get("styleId")
    )
    release_raw = _trait_lookup(raw_product_data, "release date", "release_date") or raw_product_data.get("release_date")
    release_date = _normalize_release_date(release_raw)
    retail_raw = _trait_lookup(raw_product_data, "retail price", "retail_price") or raw_product_data.get("retail_price")
    retail_price = _normalize_decimal(retail_raw)
    silhouette = _trait_lookup(raw_product_data, "silhouette")
    country = (
        _trait_lookup(raw_product_data, "country of manufacture", "country of origin")
        or raw_product_data.get("country_of_origin")
        or raw_product_data.get("country_of_manufacture")
    )

    candidates = [
        ("model", "single_line_text_field", model),
        ("colorway", "single_line_text_field", colorway),
        ("style_code", "single_line_text_field", style_code),
        ("release_date", "date", release_date),
        ("retail_price", "number_decimal", retail_price),
        ("silhouette", "single_line_text_field", silhouette),
        ("country_of_manufacture", "single_line_text_field", country),
    ]

    metafields_input = []
    for key, mtype, value in candidates:
        if value in (None, "", []):
            result["skipped"].append({"key": key, "reason": "missing_or_invalid"})
            continue
        result["attempted"].append(key)
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": key,
            "type": mtype,
            "value": str(value),
        })

    if not metafields_input:
        return result

    query = """
    mutation SetRequiredCustomMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value type }
        userErrors { field message code }
      }
    }
    """

    def _run(payload):
        return _run_query(query, {"metafields": payload})

    response = _run(metafields_input)
    payload_result = response.get("metafieldsSet", {}) or {}
    errors = payload_result.get("userErrors", []) or []

    # Type-mismatch fallback per key: retry rejected keys with money/text alternates.
    if errors:
        bad_keys = set()
        for err in errors:
            msg = str(err.get("message", ""))
            path = err.get("field") or []
            idx = None
            for token in path:
                if isinstance(token, int):
                    idx = token
                elif isinstance(token, str) and token.isdigit():
                    idx = int(token)
            if idx is not None and 0 <= idx < len(metafields_input):
                bad_keys.add(metafields_input[idx]["key"])
            else:
                if "must be consistent with the definition's type" in msg:
                    for mf in metafields_input:
                        if mf["key"] in msg:
                            bad_keys.add(mf["key"])

        if bad_keys:
            retry_input = []
            for mf in metafields_input:
                if mf["key"] not in bad_keys:
                    continue
                k = mf["key"]
                if k == "retail_price":
                    retry_input.append({**mf, "type": "money", "value": json.dumps({"amount": mf["value"], "currency_code": "USD"}, separators=(",", ":"))})
                elif k == "release_date":
                    retry_input.append({**mf, "type": "single_line_text_field"})
                else:
                    retry_input.append({**mf, "type": "single_line_text_field"})
            if retry_input:
                response2 = _run(retry_input)
                result2 = response2.get("metafieldsSet", {}) or {}
                errors2 = result2.get("userErrors", []) or []
                # Final fallback: retail_price as plain text if money rejected.
                if errors2 and any(mf["key"] == "retail_price" for mf in retry_input):
                    final_input = [
                        ({**mf, "type": "single_line_text_field", "value": _normalize_decimal(mf["value"]) or mf["value"]}
                         if mf["key"] == "retail_price" else mf)
                        for mf in retry_input
                    ]
                    response3 = _run(final_input)
                    payload_result = response3.get("metafieldsSet", {}) or {}
                else:
                    payload_result = result2

    succeeded_nodes = payload_result.get("metafields", []) or []
    result["succeeded"] = [n.get("key") for n in succeeded_nodes if n.get("key")]
    final_errors = payload_result.get("userErrors", []) or []
    if final_errors:
        print(f"[WARNING] set_required_product_metafields errors: {final_errors}")
    print(f"[INFO] custom metafields attempted={result['attempted']} succeeded={result['succeeded']} skipped={[s['key'] for s in result['skipped']]}")
    return result


def set_product_metafields(product_id, attributes):
    """
    LEGACY - Sets custom metafields for a product (product_type, sneaker_style, color).
    This is kept for backwards compatibility. Use set_standard_metafields() instead.
    Example: set_product_metafields(product_id, {"product_type": "Sneakers", "sneaker_style": "Low-top"})
    """
    query = """
    mutation SetMetafields($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields {
          id
          namespace
          key
          value
          type
        }
        userErrors {
          field
          message
        }
      }
    }
    """

    metafields_input = []
    
    # Product type metafield
    if attributes.get("product_type"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "product_type",
            "type": "single_line_text_field",
            "value": attributes["product_type"]
        })
    
    # Sneaker style metafield
    if attributes.get("sneaker_style"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "sneaker_style",
            "type": "single_line_text_field",
            "value": attributes["sneaker_style"]
        })
    
    # Primary color metafield
    if attributes.get("primary_color"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "primary_color",
            "type": "single_line_text_field",
            "value": attributes["primary_color"]
        })
    
    # Gender metafield
    if attributes.get("gender"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "gender",
            "type": "single_line_text_field",
            "value": attributes["gender"]
        })
    
    # Subcategory metafield (e.g., "Performance", "Lifestyle", "Basketball")
    if attributes.get("subcategory"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "subcategory",
            "type": "single_line_text_field",
            "value": attributes["subcategory"]
        })
    
    # Model metafield
    if attributes.get("model"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "model",
            "type": "single_line_text_field",
            "value": attributes["model"]
        })
    
    # Country of origin metafield
    if attributes.get("country_of_origin"):
        metafields_input.append({
            "ownerId": product_id,
            "namespace": "custom",
            "key": "country_of_origin",
            "type": "single_line_text_field",
            "value": attributes["country_of_origin"]
        })
    
    if not metafields_input:
        return None

    variables = {
        "metafields": metafields_input
    }

    attr_summary = ", ".join([f"{k}={v}" for k, v in attributes.items() if v])
    print(f"[DEBUG] Setting product attributes: {attr_summary}")
    
    response = _run_query(query, variables)
    errors = response.get("metafieldsSet", {}).get("userErrors", [])
    if errors:
        print("[ERROR] Could not set product attributes:", errors)
    else:
        print(f"[SUCCESS] Set {len(metafields_input)} product attributes")

    return response

def add_new_linked_option_value(product_id, option_id, metaobject_id):
    """
    Adds a new value to an existing product option that is linked to a metaobject definition.
    Useful if you see "Cannot set name for an option value linked to a metafield."
    This uses productOptionUpdate with optionValuesToAdd referencing the metaobject ID.
    """
    query = """
    mutation UpdateOptionWithNewValue(
      $productId: ID!,
      $option: OptionUpdateInput!,
      $optionValuesToAdd: [OptionValueCreateInput!]
    ) {
      productOptionUpdate(
        productId: $productId,
        option: $option,
        optionValuesToAdd: $optionValuesToAdd
      ) {
        product {
          id
          options {
            id
            name
            linkedMetafield {
              namespace
              key
            }
            optionValues {
              id
              name
              linkedMetafieldValue
            }
          }
        }
        userErrors {
          field
          message
        }
      }
    }
    """

    variables = {
        "productId": product_id,
        "option": {
            "id": option_id
        },
        "optionValuesToAdd": [
            {
                # No "name" here, because name is derived from the metaobject
                "linkedMetafieldValue": metaobject_id
            }
        ]
    }

    print(f"[DEBUG] add_new_linked_option_value: productId={product_id}, optionId={option_id}, metaobjectId={metaobject_id}")
    response = _run_query(query, variables)
    errors = response.get("productOptionUpdate", {}).get("userErrors", [])
    if errors:
        print("[ERROR] Could not add new linked option value:", errors)
    else:
        print("[DEBUG] Successfully added new linked option value to the product option.")
        updated_product = response["productOptionUpdate"]["product"]
        for opt in updated_product["options"]:
            print(f"   Option ID: {opt['id']}, Name: {opt['name']}")
            for val in opt["optionValues"]:
                print(f"       Value ID: {val['id']}, Name: {val['name']}, MetafieldValue: {val['linkedMetafieldValue']}")
    return response



def get_product_media_images(product_id):
    """Return current image media attached to a product as [{id, url}]."""
    query = """
    query GetProductImageMedia($productId: ID!) {
      product(id: $productId) {
        media(first: 250) {
          nodes {
            id
            __typename
            ... on MediaImage {
              image {
                url
              }
            }
          }
        }
      }
    }
    """
    data = _run_query(query, {"productId": product_id})
    nodes = (data.get("product", {}).get("media", {}).get("nodes", []) or [])

    images = []
    for node in nodes:
        if (node or {}).get("__typename") != "MediaImage":
            continue
        image_obj = (node or {}).get("image") or {}
        media_id = str((node or {}).get("id", "")).strip()
        image_url = str(image_obj.get("url", "")).strip()
        if media_id and image_url:
            images.append({"id": media_id, "url": image_url})
    return images


def get_product_image_urls(product_id):
    """Return current image URLs attached to a product."""
    return [img["url"] for img in get_product_media_images(product_id)]


def delete_product_media(product_id, media_ids):
    """
    Delete specific media items from a product.
    Returns {"attempted": int, "deleted": int, "errors": list}.
    """
    clean_ids = []
    seen = set()
    for media_id in media_ids or []:
        if not isinstance(media_id, str):
            continue
        media_id = media_id.strip()
        if not media_id or media_id in seen:
            continue
        seen.add(media_id)
        clean_ids.append(media_id)

    if not clean_ids:
        return {"attempted": 0, "deleted": 0, "errors": []}

    mutation = """
    mutation DeleteProductMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        deletedProductImageIds
        mediaUserErrors { field message }
      }
    }
    """

    batch_size = 20
    deleted_count = 0
    all_errors = []

    for i in range(0, len(clean_ids), batch_size):
        batch = clean_ids[i:i + batch_size]
        data = _run_query(mutation, {"productId": product_id, "mediaIds": batch})
        payload = data.get("productDeleteMedia", {}) or {}
        errs = payload.get("mediaUserErrors", []) or []
        deleted_ids = payload.get("deletedMediaIds", []) or []

        if errs:
            all_errors.extend(errs)
            print(f"[ERROR] Deleting media from product {product_id}: {errs}")

        deleted_count += len(deleted_ids)
        print(f"[DEBUG] Image delete batch for {product_id}: attempted={len(batch)} deleted={len(deleted_ids)}")

        if i + batch_size < len(clean_ids):
            time.sleep(0.5)

    print(f"[INFO] Image delete complete for {product_id}: attempted={len(clean_ids)} deleted={deleted_count}")
    return {"attempted": len(clean_ids), "deleted": deleted_count, "errors": all_errors}


def add_images_to_product(product_id, images):
    """
    Attach valid image URLs to product media in small batches.
    Returns {"attempted": int, "added": int, "errors": list}.
    """
    if not images:
        print(f"[DEBUG] No images to add for product ID {product_id}.")
        return {"attempted": 0, "added": 0, "errors": []}

    valid_urls = []
    seen = set()
    for url in images:
        if not isinstance(url, str):
            continue
        cleaned = url.strip()
        if not cleaned.lower().startswith(("http://", "https://")):
            continue
        key = cleaned.lower()
        if key in seen:
            continue
        seen.add(key)
        valid_urls.append(cleaned)

    if not valid_urls:
        print(f"[DEBUG] No valid http(s) image URL for product {product_id}.")
        return {"attempted": 0, "added": 0, "errors": []}

    mutation = """
    mutation AddImageToProduct($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media {
          id
          status
          ... on MediaImage { image { url } }
        }
        mediaUserErrors { field message }
      }
    }
    """

    batch_size = 10
    added_count = 0
    all_errors = []

    for i in range(0, len(valid_urls), batch_size):
        batch = valid_urls[i:i + batch_size]
        media_input = [{"originalSource": url, "mediaContentType": "IMAGE"} for url in batch]
        variables = {"productId": product_id, "media": media_input}

        data = _run_query(mutation, variables)
        payload = data.get("productCreateMedia", {}) or {}
        errs = payload.get("mediaUserErrors", []) or []
        created_media = payload.get("media", []) or []

        if errs:
            all_errors.extend(errs)
            print(f"[ERROR] Adding images to product {product_id}: {errs}")

        added_in_batch = len([m for m in created_media if m and m.get("id")])
        added_count += added_in_batch
        print(f"[DEBUG] Image batch upload for {product_id}: attempted={len(batch)} added={added_in_batch}")

        # Keep safe gap between image mutations to reduce throttling risk.
        if i + batch_size < len(valid_urls):
            time.sleep(0.5)

    print(f"[INFO] Image upload complete for {product_id}: attempted={len(valid_urls)} added={added_count}")
    return {"attempted": len(valid_urls), "added": added_count, "errors": all_errors}



def get_first_option_id_of_product(product_id):
    """Retrieve the first option ID of an existing product."""
    query = """
    query GetFirstOptionId($productId: ID!) {
      product(id: $productId) {
        options { id name }
      }
    }
    """
    data = _run_query(query, {"productId": product_id})
    options = (data.get("product") or {}).get("options") or []
    return options[0]["id"] if options else None


def set_variant_weight(variant_id, weight, weight_unit="GRAMS"):
    """Set weight on a single variant using productVariantUpdate."""
    mutation = """
    mutation UpdateVariantWeight($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant {
          id
          weight
          weightUnit
        }
        userErrors { field message }
      }
    }
    """
    variables = {
        "input": {
            "id": variant_id,
            "weight": weight,
            "weightUnit": weight_unit
        }
    }
    resp = _run_query(mutation, variables)
    user_errors = (resp.get("productVariantUpdate") or {}).get("userErrors", [])
    if user_errors:
        raise Exception(f"Failed to set weight: {user_errors}")
    return resp


def delete_default_variant(product_id):
    """
    Deletes the default variant that Shopify auto-creates when a product is created.
    This default variant has title "Default Title", price 0, and no real size.
    """
    # Query to get all variants
    query = """
    query GetProductVariants($productId: ID!) {
      product(id: $productId) {
        id
        variants(first: 250) {
          nodes {
            id
            title
            price
            selectedOptions {
              name
              value
            }
          }
        }
      }
    }
    """
    
    response = _run_query(query, {"productId": product_id})
    variants = response.get("product", {}).get("variants", {}).get("nodes", [])
    
    # Find the default variant
    # It's usually titled "Default Title" or has a generic option value
    default_variant_id = None
    for variant in variants:
        title = variant.get("title", "")
        price = variant.get("price", "0")
        selected_options = variant.get("selectedOptions", [])
        
        # Identify default variant by:
        # 1. Title = "Default Title" OR
        # 2. Only 1 option with value "Default Title" OR
        # 3. Price is 0 and has no real size
        is_default = False
        if title.lower() in ["default title", "default"]:
            is_default = True
        elif len(selected_options) == 1:
            option_value = selected_options[0].get("value", "")
            if option_value.lower() in ["default title", "default"]:
                is_default = True
        
        if is_default:
            default_variant_id = variant["id"]
            print(f"[DEBUG] Found default variant to delete: {title} (ID: {default_variant_id})")
            break
    
    if not default_variant_id:
        print("[DEBUG] No default variant found to delete")
        return
    
    # Delete the default variant
    if len(variants) > 1:  # Only delete if there are other variants
        delete_variants_bulk(product_id, [default_variant_id])
        print(f"[SUCCESS] Deleted default variant")
    else:
        print(f"[INFO] Keeping default variant as it's the only one")


def create_variants_bulk(product_id, option_id, variants):
    """
    Creates multiple variants at once using productVariantsBulkCreate.
    Raises RateLimitException on daily variant cap so caller can save partials.
    """
    mutation = """
    mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkCreate(productId: $productId, variants: $variants) {
        userErrors { field message }
        productVariants {
          id
          title
          price
          inventoryItem { id sku unitCost { amount currencyCode } }
          selectedOptions { name value }
        }
      }
    }
    """
    location_id = get_first_location_id()
    variants_input = []

    for v in variants:
        price = float(v["price"])
        # Use pre-calculated cost from variant data (StockX price * 1.07 + 20)
        cost = v.get("cost", {}).get("amount", price * 0.80)  # fallback to 80% if not provided
        variants_input.append({
            "price": str(price),
            "barcode": v.get("barcode", ""),
            # Note: weight must be set separately after variant creation using productVariantUpdate
            "optionValues": [{
                "optionId": option_id,
                "name": str(v["size"])
            }],
            "inventoryItem": {
                "sku": v["sku"],
                "tracked": True,
                "cost": str(cost)
            },
            "inventoryQuantities": [{
                "locationId": location_id,
                "availableQuantity": int(v.get("quantity", 1))
            }]
        })

    resp = _run_query(mutation, {"productId": product_id, "variants": variants_input})
    ue = (resp.get("productVariantsBulkCreate") or {}).get("userErrors") or []
    
    if ue:
        msg = " ; ".join([str(e) for e in ue]).lower()
        full_error = str(ue)
        
        # Check if it's VARIANT_THROTTLE_EXCEEDED - this is NOT a daily limit!
        if 'VARIANT_THROTTLE_EXCEEDED' in full_error:
            print(f"[WARNING] VARIANT_THROTTLE_EXCEEDED in bulk create - adding delay and continuing")
            time.sleep(5)  # Add 5 second delay
            # Don't raise exception - let it continue with warning
            print(f"[INFO] Continuing after throttle delay...")
            return resp  # Return response with warning but don't fail
        
        # Heuristics for daily cap reported via userErrors (NOT throttle)
        # Be more specific to avoid false positives
        if any(k in msg for k in [
            "daily limit", "exceeded daily", "daily variant creation limit"
        ]):
            # Create enhanced exception with response details
            exception = RateLimitException(f"Variant creation limit/userErrors: {ue}")
            exception.shopify_response = str(ue)
            exception.api_status_code = 200  # GraphQL errors come with 200 status
            raise exception
        # Other validation errors: raise normal exception for caller to log
        raise Exception(f"Bulk create userErrors: {ue}")
    
    # NOTE: Weight CANNOT be set via GraphQL API in this Shopify store setup
    # The productVariantUpdate mutation does not exist despite Shopify.dev documentation
    # Weight must be set manually in Shopify Admin OR via REST API
    # Future: Consider implementing REST API weight update if needed
    
    # CRITICAL FIX: Delete the default variant that Shopify auto-creates
    # This default variant has no size, price 0, and causes inventory issues
    try:
        all_locations = get_secondary_location_ids()
        if all_locations:
            created_variants = (resp.get("productVariantsBulkCreate") or {}).get("productVariants") or []
            for created in created_variants:
                inv = created.get("inventoryItem") or {}
                inv_id = inv.get("id")
                if not inv_id:
                    continue
                activation = bulk_toggle_inventory_item_locations(inv_id, all_locations, activate=True)
                errs = activation.get("userErrors") or []
                if errs:
                    print(f"[WARNING] inventoryBulkToggleActivation errors for {inv_id}: {errs}")
                else:
                    print(f"[INFO] Activated inventory item at {len(all_locations)} retail location(s): {inv_id}")
    except Exception as e:
        print(f"[WARNING] inventory location activation failed: {e}")

    print("[INFO] Cleaning up default variant created by Shopify...")
    try:
        delete_default_variant(product_id)
    except Exception as e:
        print(f"[WARNING] Could not delete default variant: {e}")
        # Non-critical, continue

    return resp


def update_variants_bulk(product_id, variants):
    mutation = """
    mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        product { id }
        productVariants {
          id
          price
          barcode
          inventoryItem { sku unitCost { amount currencyCode } }
        }
        userErrors { field message }
      }
    }
    """
    variants_input = []
    for v in variants:
        price = float(v["price"])
        # Use pre-calculated cost from variant data if available
        cost = v.get("inventoryItem", {}).get("cost", price * 0.80)
        print(f"[PRICE DEBUG] update_variants_bulk: variant price={price}, cost={cost}")
        
        variant_data = {
            "id": v["id"],
            "price": str(price),
            "inventoryItem": { "cost": str(cost) }
        }
        # Note: weight cannot be updated via productVariantsBulkUpdate
        # Weight must be set during creation or via separate productVariantUpdate mutation
        # Add barcode if provided
        if v.get("barcode"):
            variant_data["barcode"] = v["barcode"]
            print(f"[BARCODE UPDATE] Adding barcode {v['barcode']} to variant {v['id']}")
        
        variants_input.append(variant_data)

    resp = _run_query(mutation, {"productId": product_id, "variants": variants_input})
    ue = (resp.get("productVariantsBulkUpdate") or {}).get("userErrors") or []
    if ue:
        print(f"[ERROR] Bulk update errors: {ue}")
    else:
        print("[SUCCESS] Variants updated successfully!")
    return resp

def delete_variants_bulk(product_id, variant_ids):
    """
    Delete specific variants from a product using productVariantsBulkDelete.
    Args:
      product_id (str): gid://shopify/Product/...
      variant_ids (list[str]): list of gid://shopify/ProductVariant/... to delete
    Returns:
      dict: GraphQL response
    Raises:
      RateLimitException on true 429; Exception on userErrors
    """
    if not variant_ids:
        return {"productVariantsBulkDelete": {"product": {"id": product_id}, "userErrors": []}}

    mutation = """
    mutation DeleteVariants($productId: ID!, $variantsIds: [ID!]!) {
      productVariantsBulkDelete(productId: $productId, variantsIds: $variantsIds) {
        product { id }
        userErrors { field message code }
      }
    }
    """
    variables = {"productId": product_id, "variantsIds": variant_ids}
    resp = _run_query(mutation, variables)
    ue = (resp.get("productVariantsBulkDelete") or {}).get("userErrors") or []
    if ue:
        msg = " ; ".join([str(e) for e in ue]).lower()
        full_error = str(ue)
        
        # Check if it's VARIANT_THROTTLE_EXCEEDED - this is NOT a daily limit!
        if 'VARIANT_THROTTLE_EXCEEDED' in full_error:
            print(f"[WARNING] VARIANT_THROTTLE_EXCEEDED in bulk delete - adding delay and continuing")
            time.sleep(5)  # Add 5 second delay
            print(f"[INFO] Continuing after throttle delay...")
            return resp  # Continue with warning
        
        # Be more specific to avoid false positives like "CANNOT_DELETE_LAST_VARIANT"
        if any(k in msg for k in ["daily limit", "exceeded daily", "daily variant creation limit"]):
            # Create enhanced exception with response details
            exception = RateLimitException(f"Daily variant limit: {ue}")
            exception.shopify_response = str(ue)
            exception.api_status_code = 200  # GraphQL errors come with 200 status
            raise exception
        raise Exception(f"Bulk delete userErrors: {ue}")
    print(f"[SUCCESS] Deleted {len(variant_ids)} variants from product {product_id}")
    return resp

def adjust_inventory_quantity(inventory_item_id, location_id, new_quantity, reason="correction"):
    """Set absolute available quantity for one inventory item."""
    if not inventory_item_id:
        print("[ERROR] Missing inventory_item_id")
        return None
    if not location_id:
        print("[ERROR] Missing location_id")
        return None

    response = inventory_set_quantities_bulk(
        [{"inventoryItemId": inventory_item_id, "quantity": int(new_quantity)}],
        location_id=location_id,
        reason=reason,
    )
    print(f"[DEBUG] Set inventory for item {inventory_item_id} to {int(new_quantity)}")
    return response



def update_product_description(product_id, description):
    """
    Update the product description (descriptionHtml) of an existing product.
    """
    mutation = """
    mutation updateProduct($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          descriptionHtml
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    product_input = {
        "id": product_id,
        "descriptionHtml": description
    }
    variables = {"input": product_input}
    response = _run_query(mutation, variables)
    errors = response.get("productUpdate", {}).get("userErrors", [])
    if errors:
        print("[ERROR] Updating product description failed:", errors)
    else:
        print("[DEBUG] Product description updated successfully for product", product_id)
    return response


def update_product_title(product_id, title):
    """Update native product title when StockX data differs from Shopify."""
    title = str(title or "").strip()
    if not product_id or not title:
        return False
    mutation = """
    mutation updateProductTitle($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id title }
        userErrors { field message }
      }
    }
    """
    resp = _run_query(mutation, {"input": {"id": product_id, "title": title}})
    errors = (resp.get("productUpdate") or {}).get("userErrors") or []
    if errors:
        print(f"[ERROR] update_product_title failed: {errors}")
        return False
    print(f"[INFO] Product title updated -> {title!r}")
    return True


def _truncate_seo_text(text, max_len):
    s = " ".join(str(text or "").split())
    if len(s) <= max_len:
        return s
    if max_len <= 3:
        return s[:max_len]
    return s[: max_len - 3].rstrip() + "..."


def generate_product_seo_title(title, brand=None):
    title = str(title or "").strip()
    seo_title = f"{title} | Sneakers Authentiques | Resell Lausanne"
    if len(seo_title) > 70:
        seo_title = f"{title} | Resell Lausanne Suisse"
    return _truncate_seo_text(seo_title, 70)


def generate_product_seo_description(title, brand=None):
    title = str(title or "").strip()
    brand = str(brand or "Sneakers").strip() or "Sneakers"
    desc = (
        f"{title} authentique en Suisse. {brand} 100% vérifié, livraison rapide. "
        f"Achetez chez Resell Lausanne."
    )
    return _truncate_seo_text(desc, 160)


def infer_alt_category(title="", vendor="", product_type=""):
    hay = f"{title} {vendor} {product_type}".lower()
    if vendor.lower() == "lego" or "lego" in hay:
        return "building set"
    if re.search(r"hoodie|t-shirt|tshirt|shirt|clothing|apparel|sweater|jacket|pants|shorts|jersey", hay):
        return "apparel"
    if re.search(r"sneaker|shoe|trainer|jordan|dunk|air max|yeezy|samba|gazelle|onitsuka|asics|new balance", hay):
        return "sneakers"
    return "product"


def generate_image_alt_text(title, brand=None, image_index=0, product_type=None):
    title = str(title or "").strip()
    brand = str(brand or "").strip()
    category = infer_alt_category(title, brand, product_type or "")
    if image_index == 0:
        alt = f"{title} - authentic {brand or 'resell'} {category}"
    else:
        alt = f"{title} - {category} view {image_index + 1}"
    return _truncate_seo_text(alt, 125)


def get_product_seo(product_id):
    query = """
    query($id: ID!) {
      product(id: $id) {
        id
        title
        vendor
        productType
        seo { title description }
        media(first: 50) {
          nodes {
            id
            __typename
            ... on MediaImage { alt }
          }
        }
      }
    }
    """
    try:
        data = _run_query(query, {"id": product_id})
        return data.get("product")
    except Exception as e:
        print(f"[DEBUG] get_product_seo failed for {product_id}: {e}")
        return None


def update_product_seo(product_id, seo_title: str, seo_description: str):
    """Set product SEO title and description (Google / organic listings)."""
    mutation = """
    mutation updateProductSeo($input: ProductInput!) {
      productUpdate(input: $input) {
        product {
          id
          seo { title description }
        }
        userErrors { field message }
      }
    }
    """
    product_input = {
        "id": product_id,
        "seo": {
            "title": (seo_title or "")[:70],
            "description": (seo_description or "")[:320],
        },
    }
    variables = {"input": product_input}
    response = _run_query(mutation, variables)
    errors = response.get("productUpdate", {}).get("userErrors", [])
    if errors:
        print("[ERROR] Updating product SEO failed:", errors)
    else:
        print("[DEBUG] Product SEO updated for", product_id)
    return response


def update_product_media_alt_text(product_id, media_updates):
    """media_updates: [{"id": media_gid, "alt": "..."}]"""
    if not product_id or not media_updates:
        return {"attempted": 0, "updated": 0, "errors": []}

    mutation = """
    mutation UpdateProductImageAltText($productId: ID!, $media: [UpdateMediaInput!]!) {
      productUpdateMedia(productId: $productId, media: $media) {
        media { ... on MediaImage { id alt } }
        mediaUserErrors { field message }
      }
    }
    """
    payload = []
    for item in media_updates:
        media_id = item.get("id")
        alt = item.get("alt")
        if media_id and alt:
            payload.append({"id": media_id, "alt": alt})
    if not payload:
        return {"attempted": 0, "updated": 0, "errors": []}

    resp = _run_query(mutation, {"productId": product_id, "media": payload})
    errs = (resp.get("productUpdateMedia") or {}).get("mediaUserErrors") or []
    updated = len((resp.get("productUpdateMedia") or {}).get("media") or [])
    if errs:
        print(f"[WARNING] update_product_media_alt_text errors: {errs}")
    else:
        print(f"[INFO] Updated alt text on {updated} media item(s)")
    return {"attempted": len(payload), "updated": updated, "errors": errs}


def sync_product_listing_enrichment(product_id, title, brand=None, product_type=None, force=False):
    """
    Idempotent SEO + image alt sync (same rules as bulk-optimize-product-seo.js).
    Returns summary dict for logging.
    """
    summary = {"seo_updated": False, "alt_updated": 0, "skipped": []}
    if not product_id:
        return summary

    product = get_product_seo(product_id) or {}
    current_seo = product.get("seo") or {}
    cur_title = str(current_seo.get("title") or "").strip()
    cur_desc = str(current_seo.get("description") or "").strip()

    next_title = generate_product_seo_title(title, brand)
    next_desc = generate_product_seo_description(title, brand)

    def _seo_field_matches_expected(current, expected):
        cur = str(current or "").strip().lower()
        exp = str(expected or "").strip().lower()
        if not cur or not exp:
            return False
        if cur == exp:
            return True
        # Require the StockX product name to appear in stored SEO (blocks wrong colorway bleed).
        product_name = str(title or "").strip().lower()
        return bool(product_name) and product_name in cur

    title_ok = _seo_field_matches_expected(cur_title, next_title)
    desc_ok = _seo_field_matches_expected(cur_desc, next_desc)
    need_seo = force or not title_ok or not desc_ok
    if need_seo:
        update_product_seo(product_id, next_title, next_desc)
        summary["seo_updated"] = True
    else:
        summary["skipped"].append("seo_already_ok")

    media_nodes = ((product.get("media") or {}).get("nodes") or [])
    alt_updates = []
    image_index = 0
    for node in media_nodes:
        if (node or {}).get("__typename") != "MediaImage":
            continue
        media_id = node.get("id")
        if not media_id:
            continue
        current_alt = str(node.get("alt") or "").strip()
        target_alt = generate_image_alt_text(title, brand, image_index, product_type)
        image_index += 1
        alt_ok = len(current_alt) >= 10 and title.split()[0].lower() in current_alt.lower()
        if force or not alt_ok:
            alt_updates.append({"id": media_id, "alt": target_alt})

    if alt_updates:
        result = update_product_media_alt_text(product_id, alt_updates)
        summary["alt_updated"] = result.get("updated", 0)
    else:
        summary["skipped"].append("alt_already_ok")

    return summary


def get_product_variants(product_id, include_lock=False):
    """
    Retrieve a product's variants with price/sku and inventory item IDs.
    If include_lock=True, also fetch barcode + custom.price_locked metafield.
    """
    if include_lock:
        query = """
        query GetProductVariants($productId: ID!) {
          product(id: $productId) {
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  barcode
                  inventoryQuantity
                  sku
                  inventoryItem {
                    id
                    tracked
                    unitCost { amount currencyCode }
                  }
                  priceLocked: metafield(namespace: "custom", key: "price_locked") {
                    value
                  }
                }
              }
            }
          }
        }
        """
    else:
        query = """
        query GetProductVariants($productId: ID!) {
          product(id: $productId) {
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  price
                  barcode
                  inventoryQuantity
                  sku
                  inventoryItem {
                    id
                    tracked
                    unitCost { amount currencyCode }
                  }
                }
              }
            }
          }
        }
        """
    resp = _run_query(query, {"productId": product_id})
    try:
        edges = ((resp.get("product") or {}).get("variants") or {}).get("edges") or []
        variants = []
        for e in edges:
            n = e["node"]
            inv = n.get("inventoryItem")
            locked_raw = ((n.get("priceLocked") or {}).get("value") if include_lock else None)
            variants.append({
                "id": n["id"],
                "title": n["title"],
                "price": n.get("price"),   # important for "keep price when qty=0"
                "barcode": n.get("barcode"),
                "inventoryQuantity": n.get("inventoryQuantity"),
                "sku": n.get("sku"),
                "inventoryItemId": inv["id"] if inv else None,
                "tracked": inv["tracked"] if inv else None,
                "unitCost": (inv["unitCost"]["amount"] if inv and inv.get("unitCost") else None),
                "price_locked": _parse_bool_metafield(locked_raw) if include_lock else False,
            })
        print(f"[DEBUG] Retrieved {len(variants)} variants for product {product_id}")
        return variants
    except Exception as e:
        print(f"[ERROR] Error processing variants for {product_id}: {e}")
        print(f"[DEBUG] Full response: {resp}")
        return []


def _parse_bool_metafield(value):
    if value is None:
        return False
    if isinstance(value, bool):
        return value
    s = str(value).strip().lower()
    return s in ("1", "true", "yes", "on")


def find_variant_by_barcode(barcode: str):
    """
    Resolve Shopify variant (+ parent product) by GTIN/UPC/EAN barcode.
    Returns dict: {variant_id, barcode, sku, title, price, product:{id,handle,title}} or None.
    """
    bc = (barcode or "").strip()
    if not bc:
        return None
    query = """
    query($q: String!) {
      productVariants(first: 5, query: $q) {
        edges {
          node {
            id
            barcode
            sku
            title
            price
            product { id handle title }
          }
        }
      }
    }
    """
    try:
        data = _run_query(query, {"q": f"barcode:{bc}"})
        edges = ((data.get("productVariants") or {}).get("edges") or [])
        for edge in edges:
            node = edge.get("node") or {}
            if str(node.get("barcode") or "").strip() == bc:
                return {
                    "variant_id": node.get("id"),
                    "barcode": node.get("barcode"),
                    "sku": node.get("sku"),
                    "title": node.get("title"),
                    "price": node.get("price"),
                    "product": node.get("product") or {},
                }
        # Soft match: Shopify search may normalize leading zeros
        if edges:
            node = edges[0].get("node") or {}
            return {
                "variant_id": node.get("id"),
                "barcode": node.get("barcode"),
                "sku": node.get("sku"),
                "title": node.get("title"),
                "price": node.get("price"),
                "product": node.get("product") or {},
            }
    except Exception as e:
        print(f"[DEBUG] find_variant_by_barcode({bc!r}) failed: {e}")
    return None


_PRICE_LOCKED_DEFINITION_READY = None


def ensure_price_locked_metafield_definition(force: bool = False) -> dict:
    """
    Ensure PRODUCTVARIANT metafield definition custom.price_locked (boolean) exists.
    Idempotent. Creates it via Admin API if missing.
    """
    global _PRICE_LOCKED_DEFINITION_READY
    if _PRICE_LOCKED_DEFINITION_READY is not None and not force:
        return _PRICE_LOCKED_DEFINITION_READY

    result = {"ok": False, "created": False, "id": None, "error": None}
    query = """
    query {
      metafieldDefinitions(first: 100, ownerType: PRODUCTVARIANT, namespace: "custom") {
        edges { node { id name namespace key type { name } } }
      }
    }
    """
    try:
        data = _run_query(query)
        edges = ((data.get("metafieldDefinitions") or {}).get("edges") or [])
        for edge in edges:
            node = edge.get("node") or {}
            if node.get("key") == "price_locked":
                result["ok"] = True
                result["id"] = node.get("id")
                result["type"] = ((node.get("type") or {}).get("name"))
                _PRICE_LOCKED_DEFINITION_READY = result
                print(f"[INFO] Metafield definition custom.price_locked exists: {result['id']}")
                return result
    except Exception as e:
        result["error"] = f"list_failed:{e}"
        print(f"[WARNING] Could not list metafield definitions: {e}")

    mutation = """
    mutation CreatePriceLocked($definition: MetafieldDefinitionInput!) {
      metafieldDefinitionCreate(definition: $definition) {
        createdDefinition { id name namespace key type { name } }
        userErrors { field message code }
      }
    }
    """
    variables = {
        "definition": {
            "name": "Price Locked",
            "namespace": "custom",
            "key": "price_locked",
            "description": (
                "When true, automation must not overwrite this variant sell price "
                "until unlocked or marked sold."
            ),
            "type": "boolean",
            "ownerType": "PRODUCTVARIANT",
            "pin": True,
        }
    }
    try:
        resp = _run_query(mutation, variables)
        created = (resp.get("metafieldDefinitionCreate") or {}).get("createdDefinition")
        errs = (resp.get("metafieldDefinitionCreate") or {}).get("userErrors") or []
        if created and not errs:
            result["ok"] = True
            result["created"] = True
            result["id"] = created.get("id")
            result["type"] = ((created.get("type") or {}).get("name"))
            _PRICE_LOCKED_DEFINITION_READY = result
            print(f"[SUCCESS] Created metafield definition custom.price_locked: {result['id']}")
            return result
        # Already exists race / taken
        msg = str(errs).lower()
        if any(k in msg for k in ("taken", "already", "exists")):
            result["ok"] = True
            result["error"] = str(errs)
            _PRICE_LOCKED_DEFINITION_READY = result
            print(f"[INFO] custom.price_locked definition already present ({errs})")
            return result
        result["error"] = str(errs or "create_failed")
        print(f"[ERROR] metafieldDefinitionCreate failed: {errs}")
    except Exception as e:
        result["error"] = str(e)
        print(f"[ERROR] ensure_price_locked_metafield_definition: {e}")

    _PRICE_LOCKED_DEFINITION_READY = result
    return result


def set_variant_price_locked(variant_id: str, locked: bool = True):
    """Set custom.price_locked on a variant. Ensures definition exists. Returns True on success."""
    if not variant_id:
        return False
    ensure_price_locked_metafield_definition()
    mutation = """
    mutation SetPriceLocked($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value }
        userErrors { field message code }
      }
    }
    """
    # Prefer boolean (definition type); fall back to text if definition type differs.
    payloads = [
        {
            "ownerId": variant_id,
            "namespace": "custom",
            "key": "price_locked",
            "type": "boolean",
            "value": "true" if locked else "false",
        },
        {
            "ownerId": variant_id,
            "namespace": "custom",
            "key": "price_locked",
            "type": "single_line_text_field",
            "value": "true" if locked else "false",
        },
    ]
    for payload in payloads:
        try:
            resp = _run_query(mutation, {"metafields": [payload]})
            errs = ((resp.get("metafieldsSet") or {}).get("userErrors") or [])
            if not errs:
                print(f"[INFO] price_locked={locked} set on {variant_id}")
                return True
            print(f"[WARNING] set_variant_price_locked type={payload['type']} errors: {errs}")
        except Exception as e:
            print(f"[WARNING] set_variant_price_locked failed ({payload['type']}): {e}")
    return False


def get_variant_price_locked(variant_id: str) -> bool:
    """Read custom.price_locked for a variant."""
    if not variant_id:
        return False
    query = """
    query($id: ID!) {
      productVariant(id: $id) {
        id
        metafield(namespace: "custom", key: "price_locked") { value }
      }
    }
    """
    try:
        data = _run_query(query, {"id": variant_id})
        value = (((data.get("productVariant") or {}).get("metafield") or {}).get("value"))
        return _parse_bool_metafield(value)
    except Exception as e:
        print(f"[DEBUG] get_variant_price_locked failed: {e}")
        return False
    
def get_all_publications():
    """
    Fetches up to 50 publications (sales channels) from Shopify and returns a list of {id, name}.
    """
    query = """
    query getPublications {
      publications(first: 50) {
        edges {
          node {
            id
            name
          }
        }
      }
    }
    """
    data = _run_query(query)  # Replace with your GraphQL execution function
    
    pub_data = data.get("publications", {}).get("edges", [])
    
    publications_list = []
    for edge in pub_data:
        node = edge["node"]
        publications_list.append({
            "id": node["id"],
            "name": node["name"]
        })
    
    return publications_list
    


    
def publish_product_to_channels(product_id):
    """
    Publish product to all available publications dynamically.
    """
    pubs = get_all_publications()  # [{id,name},...]
    if not pubs:
        print("[WARN] No publications found; skipping publish.")
        return None

    mutation = """
    mutation PublishProductToChannels($id: ID!, $input: [PublicationInput!]!) {
      publishablePublish(id: $id, input: $input) {
        publishable {
          availablePublicationsCount { count }
          resourcePublicationsCount { count }
        }
        userErrors { field message }
      }
    }
    """
    variables = {
        "id": product_id,
        "input": [{"publicationId": p["id"]} for p in pubs]
    }
    resp = _run_query(mutation, variables)
    errs = (resp.get("publishablePublish") or {}).get("userErrors") or []
    if errs:
        print(f"[ERROR] Could not publish product {product_id}: {errs}")
    else:
        counts = (resp.get("publishablePublish") or {}).get("publishable") or {}
        print(f"[INFO] Published product {product_id}. Counts: {counts}")
    return resp

# -------------------------
# Lightweight lookup helpers
# -------------------------

def _normalize_product_by_handle(product):
    """Normalize productByHandle node to the shape used elsewhere in this module."""
    if not product:
        return None
    edges = ((product.get("variants") or {}).get("edges") or [])
    variants = []
    for edge in edges:
        node = edge.get("node") or {}
        variants.append({
            "id": node.get("id"),
            "title": node.get("title"),
            "sku": node.get("sku"),
            "price": node.get("price"),
        })
    product["variants"] = variants
    return product


def generate_stockx_handle_aliases(stockx_slug: str) -> list:
    """Known legacy handle variants (StockX slug vs older Shopify handles)."""
    slug = (stockx_slug or "").strip().lower()
    if not slug:
        return []
    aliases = []
    seen = set()

    def add(h):
        h = (h or "").strip().lower()
        if h and h not in seen:
            seen.add(h)
            aliases.append(h)

    add(slug)
    if slug.startswith("air-jordan-"):
        add(slug[4:])  # air-jordan-4-... -> jordan-4-...
    elif slug.startswith("jordan-"):
        add("air-" + slug)
    if slug.endswith("-2021") and "white-black" in slug:
        add(slug.replace("-2021", "-panda"))
    if slug.endswith("-2021-w"):
        add(slug.replace("-2021-w", "-panda-womens"))
    if slug.endswith("-black-onyx"):
        add(slug.replace("-black-onyx", "-onyx"))
    if "nike-air-force-1-low-" in slug:
        if "-white-07" in slug:
            add(slug.replace("-white-07", "-07-white"))
        if "-07-white" in slug:
            add(slug.replace("-07-white", "-white-07"))
    return aliases


def search_products(query: str, limit: int = 5):
    """Admin product search (title/handle). Returns normalized product dicts."""
    if not query:
        return []
    gql = """
    query($q: String!, $first: Int!) {
      products(first: $first, query: $q) {
        edges {
          node {
            id
            title
            handle
            variants(first: 100) {
              edges { node { id title sku price } }
            }
          }
        }
      }
    }
    """
    try:
        data = _run_query(gql, {"q": query, "first": limit})
        products = []
        for edge in (data.get("products") or {}).get("edges") or []:
            node = _normalize_product_by_handle(edge.get("node"))
            if node:
                products.append(node)
        return products
    except Exception as e:
        print(f"[DEBUG] search_products({query!r}) failed: {e}")
        return []


def find_product_by_stockx_slug(stockx_slug: str, title: str = None):
    """
    Resolve an existing Shopify product for a StockX/FULLURLLIST slug.
    Tries legacy handle aliases, handle prefix, then exact title search.
    Returns (product_dict, matched_via) or (None, None).
    """
    slug = (stockx_slug or "").strip().lower()
    if not slug:
        return None, None

    for alias in generate_stockx_handle_aliases(slug):
        product = get_product_by_handle(alias)
        if product:
            via = f"handle:{alias}" if alias != slug else f"handle:{slug}"
            return product, via

    prefix_hits = search_products(f"handle:{slug}*", limit=5)
    if prefix_hits:
        exact_hits = [
            p for p in prefix_hits
            if (p.get("handle") or "").strip().lower() == slug
        ]
        if exact_hits:
            return exact_hits[0], f"handle:{slug}"

        if len(prefix_hits) == 1:
            only_handle = (prefix_hits[0].get("handle") or "").strip().lower()
            if only_handle == slug or only_handle.startswith(slug + "-"):
                return prefix_hits[0], f"handle_prefix:{only_handle}"

        if title:
            norm_title = title.strip().lower()
            for p in prefix_hits:
                if (p.get("title") or "").strip().lower() == norm_title:
                    return p, f"handle_prefix_title:{p.get('handle')}"

    if title:
        safe_title = title.replace('"', "").strip()
        title_hits = search_products(f'title:"{safe_title}"', limit=5)
        norm_title = title.strip().lower()
        for p in title_hits:
            if (p.get("title") or "").strip().lower() == norm_title:
                return p, f"title:{p.get('handle')}"

    return None, None


def sync_product_handle_to_stockx_slug(product: dict, stockx_slug: str) -> dict:
    """Rename Shopify handle to canonical StockX slug when a legacy alias was matched."""
    if not product or not stockx_slug:
        return product
    product_id = product.get("id")
    old_handle = (product.get("handle") or "").strip().lower()
    canonical = (stockx_slug or "").strip().lower()
    if not product_id or not old_handle or not canonical or old_handle == canonical:
        return product
    if update_product_handle(product_id, canonical):
        print(f"[INFO] Synced legacy handle '{old_handle}' -> StockX slug '{canonical}'")
        updated = dict(product)
        updated["handle"] = canonical
        return updated
    return product


def update_product_handle(product_id: str, new_handle: str):
    """Rename product handle in place (no recreate). Skips if handle already taken."""
    new_handle = (new_handle or "").strip().lower()
    if not product_id or not new_handle:
        return False
    existing = get_product_by_handle(new_handle)
    if existing and existing.get("id") != product_id:
        print(f"[WARNING] Cannot rename handle to '{new_handle}' — already used by {existing.get('id')}")
        return False
    mutation = """
    mutation updateProductHandle($input: ProductInput!) {
      productUpdate(input: $input) {
        product { id handle }
        userErrors { field message }
      }
    }
    """
    resp = _run_query(mutation, {"input": {"id": product_id, "handle": new_handle}})
    errors = (resp.get("productUpdate") or {}).get("userErrors") or []
    if errors:
        print(f"[WARNING] update_product_handle failed: {errors}")
        return False
    print(f"[INFO] Product handle updated -> {new_handle}")
    return True


def get_product_by_handle(handle: str):
    """Fetch a single product by its handle (slug). Returns dict or None."""
    if not handle:
        return None
    query = """
    query($handle: String!) {
      productByHandle(handle: $handle) {
        id
        title
        handle
        variants(first: 100) {
          edges { node { id title sku price } }
        }
      }
    }
    """
    try:
        data = _run_query(query, {"handle": handle})
        product = _normalize_product_by_handle(data.get("productByHandle") if data else None)
        return product
    except Exception as e:
        print(f"[DEBUG] get_product_by_handle('{handle}') failed: {e}")
        return None

def update_fast_variant_names():
    """
    Updates all variant names from "-fast" to "-express" in Shopify by modifying existing variants.
    Uses productVariantsBulkUpdate mutation.
    """
    query = """
    query getAllProducts($cursor: String) {
      products(first: 100, after: $cursor) {
        edges {
          cursor
          node {
            id
            title
            variants(first: 100) {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  inventoryItem {
                    id
                    tracked
                    unitCost {
                      amount
                      currencyCode
                    }
                  }
                }
              }
            }
          }
        }
        pageInfo {
          hasNextPage
        }
      }
    }
    """
    
    mutation = """
    mutation productVariantsBulkUpdate($inputs: [ProductVariantBulkUpdateInput!]!) {
      productVariantsBulkUpdate(inputs: $inputs) {
        productVariants {
          id
          title
        }
        userErrors {
          field
          message
        }
      }
    }
    """
    
    update_inputs = []
    cursor = None
    has_next_page = True
    
    while has_next_page:
        variables = {"cursor": cursor}
        data = _run_query(query, variables)
        edges = data.get("products", {}).get("edges", [])
        
        for edge in edges:
            node = edge["node"]
            for vedge in node.get("variants", {}).get("edges", []):
                vnode = vedge["node"]
                if "-fast" in vnode["title"]:
                    new_title = vnode["title"].replace("-fast", "-express")
                    update_input = {
                        "id": vnode["id"],
                        "title": new_title,
                        "price": vnode["price"],
                        # Include additional fields as needed by your use-case.
                    }
                    print(f"[DEBUG] Queuing update for variant {vnode['id']} from {vnode['title']} to {new_title}")
                    update_inputs.append(update_input)
        
        page_info = data.get("products", {}).get("pageInfo", {})
        has_next_page = page_info.get("hasNextPage", False)
        if has_next_page and edges:
            cursor = edges[-1]["cursor"]
    
    if update_inputs:
        response = _run_query(mutation, {"inputs": update_inputs})
        errors = response.get("productVariantsBulkUpdate", {}).get("userErrors", [])
        if errors:
            print(f"[ERROR] Failed to update variants: {errors}")
        else:
            updated_variants = response.get("productVariantsBulkUpdate", {}).get("productVariants", [])
            for variant in updated_variants:
                print(f"[SUCCESS] Updated variant {variant['id']} to {variant['title']}")
    else:
        print("No variants to update.")

