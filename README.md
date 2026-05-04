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
API_VERSION_SHOPIFY=2026-01

# Backward-compatible aliases still accepted by code
# SHOPIFY_SHOP_DOMAIN=your-shop.myshopify.com
# SHOPIFY_ADMIN_ACCESS_TOKEN=shpat_xxxxxxxxxxxxx
# SHOPIFY_API_VERSION=2026-01

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
