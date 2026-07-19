# Supplier Order Management + Shopify Matching

A complete solution for managing supplier orders and matching them with Shopify orders.

## Features

### Supplier Integration
- 🔐 **Secure Token Management**: Store your Bearer token locally (optional)
- 📊 **Paginated Results**: Fetch first page, next page, or all pages automatically
- 📝 **Editable Queries**: Modify GraphQL queries and variables on the fly
- 📈 **Results Table**: View all your purchasing orders with full details
- 💰 **Total TTC Pricing**: Fetch complete pricing including fees and shipping
- 🐛 **Debug Panel**: Track HTTP status, errors, cursors, and total results
- 📦 **CSV Export**: Export your results to `supplier_orders.csv`
- ⏱️ **Rate Limiting**: Automatic delays to avoid rate limits

### Shopify Integration & Matching
- 🏪 **Shopify Orders Fetching**: Load recent 100 paid, unfulfilled orders from Shopify Admin API
- 🎯 **Intelligent Matching Algorithm**:
  - ✅ Product name 100% match (required)
  - ✅ Size 100% match (required for sized products)
  - ⏱️ Time proximity scoring (main differentiator)
  - 🔐 SKU validation (optional bonus)
- 📊 **Confidence Scoring**: High/Medium/Low based on time proximity
- 🚫 **Smart Exclusions**: 
  - Fear of God Essentials (in-stock items)
  - Liquidation products (manual match only)
- ⚠️ **Threshold Alerts**: Highlights matches outside 4-day window
- ✏️ **Manual Override**: Edit and confirm matches manually
- 🔍 **Match Reasons**: Detailed breakdown of why items were matched
- 🛍️ **Special Handling**: LEGO products, liquidation items, duplicate prevention

## Tech Stack

- Next.js 14 (App Router)
- TypeScript
- Tailwind CSS
- localStorage (no database)

## Getting Started

### Installation

```bash
npm install
```

### Configuration

#### 1. Create `.env.local` file

Create a file named `.env.local` in root directory with Shopify credentials:

```bash
# Shopify Admin API Configuration
# Preferred env keys
SHOP_NAME_SHOPIFY=your-shop.myshopify.com
ACCESS_TOKEN_SHOPIFY=shpat_xxxxxxxxxxxxx
API_VERSION_SHOPIFY=2026-07

# Backward-compatible aliases still accepted by code
# SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
# SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
# SHOPIFY_API_VERSION=2026-07

# Optional OAuth install flow
SHOPIFY_API_KEY=shpka_xxxxxxxxxxxxx
SHOPIFY_API_SECRET=xxxxxxxxxxxxx
SHOPIFY_SCOPES=read_orders,read_products,write_products,read_inventory,write_inventory,read_locations
SHOPIFY_APP_URL=https://your-app-domain.com

# Scan page auto-fulfill + browser print (VPS build-time/runtime envs)
# 1 = enabled, 0 = disabled
NEXT_PUBLIC_SCAN_AUTO_FULFILLMENT=1
NEXT_PUBLIC_SCAN_BROWSER_PRINT=1
SCAN_BROWSER_PRINT_ENABLED=1

# Browser print paper size in mm (example: Brother 62x86)
SCAN_BROWSER_PRINT_WIDTH_MM=62
SCAN_BROWSER_PRINT_HEIGHT_MM=86
SCAN_BROWSER_PRINT_MARGIN_MM=0

# Optional split billing by staff role (fallback stays SWISS_POST_FRANKING_LICENSE)
SWISS_POST_FRANKING_LICENSE=YOUR_DEFAULT_LICENSE
SWISS_POST_FRANKING_LICENSE_LOGISTICS=YOUR_LOGISTICS_LICENSE
# Optional
# SWISS_POST_FRANKING_LICENSE_ADMIN=YOUR_ADMIN_LICENSE
```

#### 2. Configure Shopify OAuth URLs (VPS/production)

In Shopify app settings, keep OAuth URLs on the same HTTPS domain:

- App URL: `https://solutions.resell-lausanne.ch`
- Allowed redirection URL(s): `https://solutions.resell-lausanne.ch/auth/callback`

Set `SHOPIFY_APP_URL` to the same base domain. The app now exposes public OAuth routes (`/auth`, `/auth/callback`) and auto-redirects install traffic from `/` to `/auth` when Shopify sends `shop` parameters.

#### 3. Get Shopify Admin Access Token

1. Go to your Shopify Admin → Settings → Apps and sales channels
2. Click "Develop apps"
3. Create a new app or select existing
4. Configure Admin API scopes:
   - `read_orders`
   - `read_products`
   - `write_products`
   - `read_inventory`
   - `write_inventory`
   - `read_locations`
5. Install app and copy the Admin API access token
6. Copy your store domain (e.g., `my-store.myshopify.com`)

#### 4. Verify token scopes

Run `GET /api/shopify/admin/scope-check` to verify required Admin scopes for catalog, inventory, and order sync.

### Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Usage

### Supplier Orders

1. **Enter Your Token**: Paste your Supplier Bearer token in the password field
2. **Save Token** (Optional): Toggle "Save token locally" to persist it in localStorage
3. **Customize Query** (Optional): Edit the GraphQL query or variables as needed
4. **Fetch Data**:
   - Click "Fetch First Page" to load orders
   - Click "Fetch Next Page" to load subsequent pages
   - Click "Fetch All Pages" to automatically fetch all available orders
5. **Get Pricing**: Click "Fetch All Pricing" to get total TTC for all orders
6. **Export Results**: Click "Export CSV" to download your orders

### Shopify Matching

1. **Load Supplier Orders First**: Make sure you have Supplier orders loaded
2. **Click "Load Shopify Orders (30d)"**: Fetches recent Shopify paid orders
3. **Review Matches**: See automatic matching suggestions with confidence scores
4. **Verify Matches**: Check SKU, size, date, and product name alignment
5. **Manual Override**: Edit the Supplier order number field if needed
6. **Color Coding**:
   - 🟢 Green border: High confidence match (name+size+time<48h)
   - 🔵 Blue border: Medium confidence match (name+size+time<4d)
   - 🟡 Yellow border: Over 4-day threshold (needs review)
   - 🟣 Purple border: Liquidation product (manual match only)
   - ⚪ Gray border: No match found
   
## Matching Logic

See [MATCHING_LOGIC.md](MATCHING_LOGIC.md) for detailed explanation of:
- Hard filters (product name + size required)
- Scoring algorithm (time proximity as main differentiator)
- Exclusions (Fear of God, liquidation products)
- Special cases (LEGO, duplicate prevention)
- Examples with scores

## API Route

The app includes a proxy API route at `/api/stockx` that:
- Validates the Bearer token
- Forwards requests to the supplier API
- Sets proper headers (authorization, origin, referer)
- Returns the upstream response with proper status codes
- Never logs tokens for security

## Safety Features

- Token is never logged or exposed
- 400 error if token is missing
- Clear UI indication for 401/403 auth errors
- 250ms delay between pages when fetching all
- localStorage is only used if explicitly enabled

## Build for Production

```bash
npm run build
npm start
```

## License

MIT

# shopify-fulfillment-dashboard

## Decathlon return receipt (Mirakl)

Minimal staff workflow: sync open Decathlon returns → scan return label → confirm physical check → receive + line refund + close on Mirakl.

Admin page: `/decathlon/returns`

### Environment

```bash
# Required (existing)
DECATHLON_MIRAKL_API_BASE_URL=https://marketplace-decathlon-eu.mirakl.net
DECATHLON_MIRAKL_API_KEY=...

# Dry-run (default true) — logs Mirakl calls, performs zero mutations
RETURN_AUTOMATION_DRY_RUN=false

# OR28 refund reason_code from Mirakl RE01 for this shop
# "17" = Item returned customer wish
DECATHLON_MIRAKL_REFUND_REASON_CODE=17
```

Set `RETURN_AUTOMATION_DRY_RUN=false` only after manual verification of reason codes and a successful dry-run on a real return.

### Migration

```bash
npm run db:migrate
```

Creates `marketplace_returns` + `marketplace_return_sync_cursors`.

### Scheduler

Daily job key: `decathlon-return-sync` (24h), via Decathlon ops tick:

```bash
# cron / external scheduler
curl -fsS "https://YOUR_HOST/api/decathlon/ops/tick?force=1&only=decathlon-return-sync"
```

### Manual sync

```bash
# CLI
npm run returns:sync

# API (authenticated)
curl -X POST https://YOUR_HOST/api/decathlon/returns/receipt \
  -H 'content-type: application/json' \
  -d '{"action":"sync"}'

# or ops run
curl -X POST https://YOUR_HOST/api/decathlon/ops/run \
  -H 'content-type: application/json' \
  -d '{"action":"return-sync"}'
```

Admin UI also has **Sync returns now**.

### Dry-run vs live

| Flag | Behavior |
|------|----------|
| `RETURN_AUTOMATION_DRY_RUN=true` (default) | Simulate receive/refund/close; write local audit only |
| `RETURN_AUTOMATION_DRY_RUN=false` | Call Mirakl mutations |

### Confirmed Mirakl endpoints (docs)

| Step | Endpoint |
|------|----------|
| List (Connect) | `GET /v2/orders/returns` — **not available on Decathlon seller front (404)** |
| List (MMP RT11) | `GET /api/returns?return_last_updated_from=…&return_state=WAITING_ACCEPTANCE,IN_PROGRESS,RECEIVED` |
| Return label | RT11 `documents[]` type `SYSTEM_RETURN_LABEL` → download via `GET /api/orders/documents/download?document_ids=` then extract Swiss Post number (`99.60…` / `99.01…`) |
| Receive | `PUT /api/returns/receive` (RT25) |
| Refund | `PUT /api/orders/refund` (OR28 line-level) |
| Close | `PUT /api/returns/close` (RT27) |

Auth: existing seller API key in `Authorization` (no Bearer), same as other Decathlon Mirakl calls.

Label lookup uses `tracking.tracking_number` then `rma` / `rma_id`. Amount comes from Mirakl order line totals (never guessed).

## Shopify return auto-open API

Public endpoint for storefront return form to create and auto-open Shopify returns.

Endpoint: `POST /api/shopify/returns/request`

### Environment

```bash
# Shopify Admin GraphQL (required)
SHOP_NAME_SHOPIFY=your-shop.myshopify.com
ACCESS_TOKEN_SHOPIFY=shpat_xxx
API_VERSION_SHOPIFY=2026-07

# Optional hardening
RETURNS_PUBLIC_API_KEY=change-me
RETURNS_CORS_ORIGINS=https://resell-lausanne.ch,https://www.resell-lausanne.ch
# Optional, used for label public URL if origin header missing
RETURNS_PUBLIC_BASE_URL=https://solution.resell-lausanne.ch

# Swiss Post label generation for Shopify returns
SWISS_POST_LABEL_ENDPOINT=...
SWISS_POST_CLIENT_ID=...
SWISS_POST_CLIENT_SECRET=...
# Dedicated return billing license (used first for Shopify returns)
SWISS_POST_RETURN_FRANKING_LICENSE=01000259
```

Scopes required on token:

- `read_orders`
- `read_returns`
- `read_fulfillments`
- `write_returns`
- `write_store_credit_account_transactions`

### Request body

```json
{
  "orderNumber": "#1234",
  "reason": "SIZE_CHANGE",
  "details": "Size too small",
  "items": [
    {
      "fulfillmentLineItemId": "gid://shopify/FulfillmentLineItem/123",
      "quantity": 1
    }
  ]
}
```

`reason` accepted values: `SIZE_CHANGE`, `CHANGE_OF_MIND`, `DEFECTIVE_ITEM`, `WRONG_ITEM_RECEIVED`, `NON_CONFORMITY`, `OTHER`.
`items` optional. If omitted, return request includes all returnable items. If provided, only selected line(s)/quantity are returned.

### Returnable items lookup

Endpoint: `POST /api/shopify/returns/returnable`

```json
{
  "orderNumber": "#1234"
}
```

Success response includes each returnable product with `fulfillmentLineItemId`, `sku`, `title`, and max `quantity`.

### Success response

```json
{
  "success": true,
  "returnId": "gid://shopify/Return/123",
  "status": "OPEN",
  "orderId": "gid://shopify/Order/456",
  "name": "#1234-R1"
}
```

### Error response

```json
{
  "success": false,
  "error": "NO_RETURNABLE_ITEMS",
  "message": "No returnable items available on this order"
}
```

Common `error` codes: `VALIDATION_ERROR`, `ORDER_NOT_FOUND`, `EMAIL_MISMATCH` (only when email is sent and mismatched), `NO_RETURNABLE_ITEMS`, `SHOPIFY_USER_ERROR`, `RATE_LIMITED`, `SERVER_ERROR`.

### Flow implemented

1. Lookup order by `name:#<orderNumber>` (optional email check if provided)
2. Query `returnableFulfillments(orderId: ...)`
3. If `items` provided, map selected lines/quantities; else include all returnable lines
4. Create request via `returnRequest`
5. Approve via `returnApproveRequest` (status `OPEN`, no immediate notify)
6. Generate Swiss Post return label
7. Attach label via `reverseDeliveryCreateWithShipping` (`notifyCustomer: true`)
8. Upsert row in `marketplace_returns` with `platform=shopify` and `returnLabelNumber`
9. Staff scans the label on `/decathlon/returns` (Shopify tab), confirms receipt, and backend issues store credit only

Staff UI: same page as Decathlon returns at `/decathlon/returns` (Shopify tab).

Future extension hook is already stubbed (`afterReturnOpened`) for `reverseDeliveryCreateWithShipping` + external label provider.
