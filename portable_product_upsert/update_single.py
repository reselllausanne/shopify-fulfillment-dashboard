#!/usr/bin/env python3
"""
Quick script to update a single product by URL without fetching entire store
Usage: python3 update_single.py <stockx-url-slug> [--allow-new-variants]
Example: python3 update_single.py birkenstock-boston-soft-footbed-suede-black
Example with new variants: python3 update_single.py birkenstock-boston-soft-footbed-suede-black --allow-new-variants
"""

import sys
import argparse
from stockXAPI import getOne
from stockx_images import (
    list_all_gallery_360_urls,
    select_stockx_product_images,
    urls_to_add_for_gallery_sync,
    should_auto_rebuild_product_images,
)
from shopifyAPI_GQL import (
    find_product_by_stockx_slug,
    sync_product_handle_to_stockx_slug,
    get_product_variants,
    update_product_description,
    update_product_title,
    sync_product_listing_enrichment,
    get_product_media_images,
    add_images_to_product,
    delete_product_media,
    update_variants_bulk,
    adjust_inventory_quantity,
    get_first_location_id,
    get_first_option_id_of_product,
    create_variants_bulk,
    delete_variants_bulk,
    set_variant_express_price_metafields,
    calc_touch_price,
    calc_sell_price,
    RateLimitException,
)
from main import get_eu_size, extended_size_lookup


def resolve_shopify_size(variant, brand, gender):
    """Same US→EU resolution as main.py process_url (Shopify uses EU variant titles)."""
    sizes_list = variant.get("sizes", []) or []
    eu_size = get_eu_size(variant)
    if eu_size:
        return eu_size

    us_label = None
    for s in sizes_list:
        size_type = str(s.get("type", "") or "").lower()
        if size_type in ("us m", "us w", "us"):
            size_val = s.get("size")
            if size_val is not None:
                us_label = str(size_val).strip().replace("US M", "").replace("US W", "").replace("US", "").strip()
                break
    if not us_label:
        us_label = str(variant.get("size", "") or "").strip()

    if us_label:
        mapped = extended_size_lookup(brand, gender, us_label)
        if mapped:
            print(f"[DEBUG] US '{us_label}' -> EU '{mapped}' ({brand})")
            return mapped
        print(f"[INFO] No EU map for brand '{brand}' US '{us_label}' — using as-is")
        return us_label

    alpha_candidates = {
        "xxs": "XXS", "xs": "XS", "s": "S", "small": "S", "m": "M", "medium": "M",
        "l": "L", "large": "L", "xl": "XL", "xxl": "XXL", "2xl": "XXL", "xxxl": "XXXL", "3xl": "XXXL",
    }
    for s in sizes_list:
        raw = str(s.get("size", "") or "").strip()
        lowered = raw.lower()
        if lowered in alpha_candidates:
            return alpha_candidates[lowered]
        for key, norm in alpha_candidates.items():
            if f" {key}" in lowered or lowered.startswith(key):
                return norm
    return str(variant.get("size", "") or "").strip() or "One Size"

def _stockx_image_slots(product_data, full_360=False):
    if full_360:
        all360 = list_all_gallery_360_urls(product_data)
        if all360:
            return all360
    return select_stockx_product_images(product_data)


def _rebuild_product_images(product_id, valid_images, existing_media=None):
    """Delete current Shopify product images, then add clean StockX set once."""
    if existing_media is None:
        existing_media = get_product_media_images(product_id)
    existing_media_ids = [item["id"] for item in existing_media if item.get("id")]

    print(
        f"[INFO] Rebuilding product images: existing={len(existing_media)}, "
        f"target={len(valid_images)}"
    )

    if existing_media_ids:
        delete_result = delete_product_media(product_id, existing_media_ids)
        print(
            f"[INFO] Image cleanup: deleted={delete_result.get('deleted', 0)}, "
            f"attempted={delete_result.get('attempted', 0)}"
        )
        if delete_result.get("errors"):
            print(f"[ERROR] Image cleanup failed: {delete_result['errors']}")
            return False

    if not valid_images:
        print("[WARNING] Rebuild skipped add step: no valid StockX images found")
        return True

    upload_result = add_images_to_product(product_id, valid_images)
    print(
        f"[SUCCESS] Image rebuild: added={upload_result.get('added', 0)}, "
        f"attempted={upload_result.get('attempted', 0)}"
    )
    if upload_result.get("errors"):
        print(f"[ERROR] Image rebuild add failed: {upload_result['errors']}")
        return False
    return True


def update_single_product(url_slug, allow_new_variants=True, images_only=False, full_360=False, rebuild_images=False):
    """Update a single product without fetching entire store
    
    Args:
        url_slug: The StockX URL slug
        allow_new_variants: If True, create new variants that don't exist yet (default: False)
        images_only: Only sync extra gallery images (skip description & variants)
        full_360: Use every `gallery_360` frame (test); falls back to 5-slot picker if empty
        rebuild_images: If True, delete current Shopify images and add StockX set cleanly once
    """
    
    print(f"[INFO] Fetching StockX data for: {url_slug}")
    if allow_new_variants:
        print(f"[INFO] New variant creation: ENABLED (will add missing sizes)")
    else:
        print(f"[INFO] New variant creation: DISABLED (existing sizes only)")
    
    # Get data from StockX
    stockx_data = getOne(url_slug)
    if not stockx_data or not stockx_data.get('data'):
        print(f"[ERROR] Could not fetch StockX data for {url_slug}")
        return False
    
    product_data = stockx_data['data']
    title = product_data.get('title', '')
    brand = product_data.get('brand', '')
    gender = product_data.get('gender', 'Men')
    
    if not title:
        print(f"[ERROR] No title found for {url_slug}")
        return False
    
    print(f"[INFO] StockX Product: {title}")
    
    # Resolve Shopify product (StockX slug + legacy handle aliases + title search)
    handle = url_slug.strip()
    print(f"[INFO] Looking for Shopify product (StockX slug: {handle})")

    shopify_product, matched_via = find_product_by_stockx_slug(handle, title=title)

    if not shopify_product:
        print(f"[WARNING] Product not found in Shopify for slug '{handle}'")
        print(f"[INFO] If it exists under a legacy handle, try: python3 create_single.py {handle}")
        print(f"[INFO] create_single.py runs full pipeline (prices, metafields, SEO, slug sync)")
        return False

    shopify_product = sync_product_handle_to_stockx_slug(shopify_product, handle)

    product_id = shopify_product['id']
    shopify_handle = shopify_product.get('handle', '')
    current_title = (shopify_product.get('title') or '').strip()
    if title and current_title != title.strip():
        update_product_title(product_id, title)
        shopify_product['title'] = title
    print(
        f"[SUCCESS] Found Shopify product: {shopify_product.get('title')} "
        f"(handle={shopify_handle}, via={matched_via}, ID: {product_id})"
    )

    if images_only:
        valid_images = _stockx_image_slots(product_data, full_360=full_360)
        try:
            existing_media = get_product_media_images(product_id)
            existing_image_urls = [item.get("url", "") for item in existing_media if item.get("url")]
            auto_rebuild_needed = should_auto_rebuild_product_images(
                len(existing_media),
                len(valid_images),
                full_360=full_360,
                explicit_rebuild=rebuild_images,
            )
            if rebuild_images or auto_rebuild_needed:
                if auto_rebuild_needed and not rebuild_images:
                    print(
                        f"[INFO] Auto image cleanup triggered: shopify_images={len(existing_media)} "
                        f"> stockx_slots={len(valid_images)}"
                    )
                return _rebuild_product_images(product_id, valid_images, existing_media=existing_media)
            to_add = urls_to_add_for_gallery_sync(
                valid_images,
                existing_image_urls,
                skip_first_slot_if_has_media=not full_360,
            )
            print(
                f"[INFO] Images-only: stockx_slots={len(valid_images)}, "
                f"shopify_existing={len(existing_image_urls)}, to_add={len(to_add)}"
            )
            if not to_add:
                print("[INFO] Nothing to add (hero + extras already present or no extras)")
                return True
            upload_result = add_images_to_product(product_id, to_add)
            print(
                f"[SUCCESS] Image sync: added={upload_result.get('added', 0)}, "
                f"attempted={upload_result.get('attempted', 0)}"
            )
            return True
        except RateLimitException as e:
            print(f"[ERROR] Rate limit during image sync: {e}")
            return False
        except Exception as e:
            print(f"[ERROR] Image sync failed: {e}")
            return False

    # Update description
    description = product_data.get('description', '').replace('StockX', 'Resell-lausanne')
    if description:
        try:
            # Add SKU to description
            sku = product_data.get('sku', '')
            enhanced_description = f"{title}\n\nAuthentique product from Resell Lausanne, manually checked.\nSKU: {sku}"
            if description:
                enhanced_description = f"{description}\n\nAuthentique product from Resell Lausanne, manually checked.\nSKU: {sku}"
            
            update_product_description(product_id, enhanced_description)
            print(f"[SUCCESS] Updated description")
        except Exception as e:
            print(f"[WARNING] Failed to update description: {e}")

    valid_images = _stockx_image_slots(product_data, full_360=full_360)

    if valid_images:
        try:
            existing_media = get_product_media_images(product_id)
            existing_image_urls = [item.get("url", "") for item in existing_media if item.get("url")]
            auto_rebuild_needed = should_auto_rebuild_product_images(
                len(existing_media),
                len(valid_images),
                full_360=full_360,
                explicit_rebuild=rebuild_images,
            )
            if rebuild_images or auto_rebuild_needed:
                if auto_rebuild_needed and not rebuild_images:
                    print(
                        f"[INFO] Auto image cleanup triggered: shopify_images={len(existing_media)} "
                        f"> stockx_slots={len(valid_images)}"
                    )
                rebuilt = _rebuild_product_images(product_id, valid_images, existing_media=existing_media)
                if not rebuilt:
                    return False
            else:
                missing_images = urls_to_add_for_gallery_sync(
                    valid_images,
                    existing_image_urls,
                    skip_first_slot_if_has_media=not full_360,
                )
                if missing_images:
                    upload_result = add_images_to_product(product_id, missing_images)
                    print(
                        f"[SUCCESS] Image sync: existing={len(existing_image_urls)}, "
                        f"extras_add={len(missing_images)}, added={upload_result.get('added', 0)}"
                    )
                else:
                    print(
                        f"[INFO] Image sync skipped: no new extras "
                        f"(shopify={len(existing_image_urls)}, stockx_slots={len(valid_images)})"
                    )
        except RateLimitException as e:
            print(f"[ERROR] Rate limit hit during image sync: {e}")
            return False
        except Exception as e:
            print(f"[WARNING] Failed to sync images: {e}")
    
    # Get existing variants
    existing_variants = get_product_variants(product_id)
    print(f"[INFO] Found {len(existing_variants)} existing variants")
    
    # Process StockX variants
    variants = product_data.get('variants', [])
    print(f"[INFO] Found {len(variants)} variants from StockX")
    
    variants_to_update = []
    variants_to_create = []
    express_metafields = []
    new_variant_titles = set()  # Track which sizes exist in StockX data
    
    for variant in variants:
        eu_size = resolve_shopify_size(variant, brand, gender)
        
        prices_list = variant.get('prices', [])
        total_asks = int(variant.get('total_asks', 0) or 0)

        # Split standard vs express lanes (same as main.py — never use express raw for standard price).
        available_prices = []
        standard_prices = []
        express_prices = []
        for price_entry in prices_list:
            price_type = price_entry.get('type', '')
            price_value = float(price_entry.get('Price', price_entry.get('price', 0)) or 0)
            asks_value = int(price_entry.get('Asks', price_entry.get('asks', 0)) or 0)
            if price_value > 0:
                entry = {'type': price_type, 'price': price_value, 'asks': asks_value}
                available_prices.append(entry)
                price_type_l = str(price_type or '').lower()
                if price_type_l == 'standard':
                    standard_prices.append(entry)
                if price_type_l.startswith('express') and asks_value > 2:
                    express_prices.append(entry)

        if not available_prices:
            new_variant_titles.add(eu_size)
            matched_variant = next((v for v in existing_variants if v['title'] == eu_size), None)
            if matched_variant:
                print(f"[UPDATE STOCK] {title} - Size {eu_size}: sold out (qty -> 0)")
                current_qty = matched_variant.get('inventoryQuantity', 0)
                if current_qty != 0:
                    try:
                        inventory_item_id = matched_variant.get('inventoryItemId')
                        if inventory_item_id:
                            location_id = get_first_location_id()
                            adjust_inventory_quantity(inventory_item_id, location_id, 0)
                            print(f"  [INVENTORY] Updated quantity: {current_qty} -> 0")
                    except Exception as e:
                        print(f"  [WARNING] Failed to update inventory: {e}")
            else:
                print(f"[SKIP] {title} - Size {eu_size}: sold out on StockX, not on Shopify")
            continue

        if standard_prices:
            lowest_price_entry = min(standard_prices, key=lambda x: x['price'])
        else:
            lowest_price_entry = min(available_prices, key=lambda x: x['price'])
            print(f"[WARNING] No standard price for {eu_size}; fallback to type='{lowest_price_entry['type']}'")
        raw_stockx_price = lowest_price_entry['price']
        price_type = lowest_price_entry['type']
        asks_count = lowest_price_entry['asks']
        
        # CORRECT PRICING LOGIC (same as main.py):
        # 1. Calculate COST from raw StockX price (what we pay)
        # 2. Calculate SELL PRICE from raw StockX price (what customer pays)
        product_category = product_data.get('product_type') or product_data.get('productCategory') or 'sneakers'
        product_handle = product_data.get('url_key', url_slug)  # Use url_slug as handle for LEGO shipping lookuppy
        
        # Ensure LEGO category is set for LEGO products
        if isinstance(title, str) and "lego" in title.lower():
            product_category = "lego"
        
        cost_value = calc_touch_price(raw_stockx_price, product_category, product_handle)
        sell_price = calc_sell_price(raw_stockx_price, product_category, is_express=False, product_handle=product_handle, brand=brand)

        express_sell_price = None
        if express_prices:
            lowest_express_entry = min(express_prices, key=lambda x: x['price'])
            express_raw_price = lowest_express_entry['price']
            express_sell_price = calc_sell_price(
                express_raw_price,
                product_category,
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
            express_sell_price = calc_sell_price(
                raw_stockx_price,
                product_category,
                is_express=True,
                product_handle=product_handle,
                brand=brand,
            )
            print(
                f"[CALCULATED EXPRESS] {title} - Size {eu_size}: no express lane — "
                f"derived from standard RAW={raw_stockx_price} CHF → SELL={express_sell_price} CHF"
            )
        if express_sell_price <= sell_price:
            fallback_express = calc_sell_price(
                raw_stockx_price,
                product_category,
                is_express=True,
                product_handle=product_handle,
                brand=brand,
            )
            express_sell_price = max(express_sell_price, fallback_express, sell_price)
            print(
                f"[EXPRESS FLOOR] {title} - Size {eu_size}: express raised to {express_sell_price} CHF "
                f"(standard={sell_price} CHF)"
            )
        
        print(f"[STOCKX PRICE] {title} - Size {eu_size}: RAW STOCKX = {raw_stockx_price} CHF (type: {price_type}, asks: {asks_count})")
        print(f"[CALCULATED] {title} - Size {eu_size}: COST = {cost_value:.2f} CHF, SELL = {sell_price} CHF")
        
        if sell_price <= 0:
            continue
        
        # Extract barcode from identifiers
        barcode = ""
        identifiers = variant.get('identifiers', [])
        if isinstance(identifiers, list) and len(identifiers) > 0:
            for id_obj in identifiers:
                if isinstance(id_obj, dict):
                    identifier = id_obj.get('identifier', '')
                    id_type = id_obj.get('identifier_type', '')
                    if identifier and identifier != '--':
                        barcode = identifier
                        if id_type:
                            print(f"  [GTIN] Found {id_type}: {identifier} for size {eu_size}")
                        break
        
        # Track this size as available in StockX
        new_variant_titles.add(eu_size)
        
        # Find matching variant in Shopify
        matched_variant = next((v for v in existing_variants if v['title'] == eu_size), None)
        
        total_asks = int(variant.get('total_asks', 0) or 0)
        if eu_size == "One Size":
            quantity = 1
        else:
            quantity = 1 if total_asks >= 2 else 0

        if matched_variant:
            old_price = matched_variant.get('price', 'N/A')
            if quantity <= 0:
                print(f"[UPDATE STOCK] {title} - Size {eu_size}: sold out (qty -> 0), price -> {sell_price} CHF")
            else:
                print(f"[UPDATE PRICE] {title} - Size {eu_size}: {old_price} -> {sell_price} CHF")
                print(f"[PRICE DEBUG] update_variants_bulk: variant price={sell_price}, cost={cost_value:.2f}")

            update_data = {
                'id': matched_variant['id'],
                'price': str(sell_price),
                'inventoryItem': {'cost': str(cost_value)}
            }
            if barcode and (not matched_variant.get('barcode') or matched_variant.get('barcode') != barcode):
                update_data['barcode'] = barcode
                print(f"[BARCODE UPDATE] Adding barcode {barcode} to variant {matched_variant['id']}")
            variants_to_update.append(update_data)

            if express_sell_price is not None:
                express_metafields.append({
                    'variantId': matched_variant['id'],
                    'price': express_sell_price,
                })

            current_qty = matched_variant.get('inventoryQuantity', 0)
            if quantity != current_qty:
                try:
                    inventory_item_id = matched_variant.get('inventoryItemId')
                    if inventory_item_id:
                        location_id = get_first_location_id()
                        adjust_inventory_quantity(inventory_item_id, location_id, quantity)
                        label = "sold out" if quantity == 0 else "in stock"
                        print(f"  [INVENTORY] Updated quantity: {current_qty} -> {quantity} ({label})")
                except Exception as e:
                    print(f"  [WARNING] Failed to update inventory: {e}")
        else:
            # Variant doesn't exist in Shopify
            if allow_new_variants and quantity > 0:
                print(f"[NEW VARIANT] {title} - Size {eu_size}: Creating with price {sell_price} CHF")
                
                # Calculate quantity
                if eu_size == "One Size":
                    quantity = 1
                else:
                    quantity = 1 if asks_count >= 2 else 0
                
                # Generate SKU
                sku = product_data.get('sku', '')
                variant_sku = f"{sku}-{eu_size}" if sku else f"SKU-{eu_size}"
                
                variants_to_create.append({
                    'size': eu_size,
                    'price': str(sell_price),
                    'sku': variant_sku,
                    'quantity': quantity,
                    'cost': {'amount': str(cost_value), 'currencyCode': 'CHF'},
                    'barcode': barcode,
                    'express_price': express_sell_price,
                })
            else:
                print(f"[SKIP] {title} - Size {eu_size}: not on Shopify (requires stock threshold or disable --no-new-variants)")
    
    # Remove variants that no longer exist in StockX (if --allow-new-variants is used)
    if allow_new_variants:
        variants_to_remove = [v for v in existing_variants if v['title'] not in new_variant_titles]
        
        if variants_to_remove:
            print(f"\n[INFO] Removing {len(variants_to_remove)} unavailable variants...")
            delete_variant_ids = [v['id'] for v in variants_to_remove]
            try:
                delete_variants_bulk(product_id, delete_variant_ids)
                print(f"[SUCCESS] Deleted {len(delete_variant_ids)} removed variants")
            except Exception as e:
                print(f"[WARNING] Failed to delete variants: {e}")
    
    # Update existing variants in bulk
    if variants_to_update:
        print(f"\n[INFO] Updating {len(variants_to_update)} existing variants...")
        try:
            update_variants_bulk(product_id, variants_to_update)
            print(f"[SUCCESS] ✅ Updated {len(variants_to_update)} variants")
            if express_metafields:
                set_variant_express_price_metafields(express_metafields)
                print(f"[SUCCESS] ✅ Updated express metafield on {len(express_metafields)} variants")
        except Exception as e:
            print(f"[ERROR] Failed to update variants: {e}")
            return False
    
    # Create new variants if any (when --allow-new-variants is used)
    if variants_to_create:
        print(f"\n[INFO] Creating {len(variants_to_create)} new variants...")
        try:
            option_id = get_first_option_id_of_product(product_id)
            if not option_id:
                print(f"[ERROR] Could not find option ID for product {product_id}")
                return False
            
            create_variants_bulk(product_id, option_id, variants_to_create)
            print(f"[SUCCESS] ✅ Created {len(variants_to_create)} new variants")

            refreshed_variants = get_product_variants(product_id)
            created_by_title = {str(v.get('title', '')): v.get('id') for v in refreshed_variants}
            express_for_new = []
            for new_var in variants_to_create:
                express_price = new_var.get('express_price')
                if express_price is None:
                    continue
                variant_id = created_by_title.get(str(new_var.get('size', '')))
                if variant_id:
                    express_for_new.append({'variantId': variant_id, 'price': express_price})
            if express_for_new:
                set_variant_express_price_metafields(express_for_new)
                print(f"[SUCCESS] ✅ Set express metafield on {len(express_for_new)} new variants")
            
            # Set inventory for new variants
            location_id = get_first_location_id()
            refreshed_variants = get_product_variants(product_id)
            for new_var in variants_to_create:
                matching_variant = next((v for v in refreshed_variants if v['title'] == new_var['size']), None)
                if matching_variant:
                    inv_id = matching_variant.get('inventoryItemId')
                    if inv_id:
                        adjust_inventory_quantity(inv_id, location_id, new_var['quantity'])
                        print(f"  [INVENTORY] Set quantity for {new_var['size']}: {new_var['quantity']}")
        except Exception as e:
            print(f"[ERROR] Failed to create new variants: {e}")
            return False
    
    if not variants_to_update and not variants_to_create:
        print(f"[INFO] No variants to update or create")
    else:
        print(f"\n[SUCCESS] ✅ Product {title} synchronized successfully!")

    try:
        enrichment = sync_product_listing_enrichment(
            product_id,
            title,
            brand=brand,
            product_type=product_data.get('product_type') or product_data.get('category'),
        )
        if enrichment.get("seo_updated"):
            print(f"[SUCCESS] SEO synced for {title}")
    except Exception as e:
        print(f"[WARNING] SEO sync failed: {e}")
    
    return True

if __name__ == "__main__":
    parser = argparse.ArgumentParser(
        description='Update a single product from StockX',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Update existing variants + add missing variants (default)
  python3 update_single.py birkenstock-boston-soft-footbed-suede-black
  
  # Existing variants only (disable creating missing sizes)
  python3 update_single.py birkenstock-boston-soft-footbed-suede-black --no-new-variants

  # Only add orbit / gallery extras (hero already on product)
  python3 update_single.py air-jordan-4-retro-lakers --images-only

  # All ~36 gallery_360 frames on one Shopify product (handle = StockX slug). 429/slow risk.
  # With --full-360, every frame not already on the product is appended (smoother spin test).
  python3 update_single.py air-jordan-4-oxidized-green --images-only --full-360

  # Delete current Shopify media, then re-add clean StockX set one time
  python3 update_single.py air-jordan-4-retro-lakers --images-only --rebuild-images
        """
    )
    parser.add_argument('url_slug', help='StockX URL slug (e.g., nike-dunk-low-panda)')
    parser.add_argument(
        '--no-new-variants',
        action='store_true',
        help='Disable creating missing variants and removing old ones',
    )
    parser.add_argument(
        '--images-only',
        action='store_true',
        help='Only append extra StockX gallery URLs (skip first slot if product already has images)',
    )
    parser.add_argument(
        '--full-360',
        action='store_true',
        help='Append all gallery_360 frames (heavy); combine with --images-only to test one product',
    )
    parser.add_argument(
        '--rebuild-images',
        action='store_true',
        help='Delete current Shopify image media and re-add clean StockX image set once',
    )

    args = parser.parse_args()

    success = update_single_product(
        args.url_slug,
        allow_new_variants=not args.no_new_variants,
        images_only=args.images_only,
        full_360=args.full_360,
        rebuild_images=args.rebuild_images,
    )
    sys.exit(0 if success else 1)

