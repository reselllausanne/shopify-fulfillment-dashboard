#!/usr/bin/env node
/**
 * Fetch ALL StockX buying pages and save JSON.
 *
 * Defaults to reading the existing Galaxus token from:
 *   .data/stockx-token-galaxus.json
 *
 * Usage:
 *   node scripts/fetch-stockx-all-pages.js
 *
 * Optional env:
 *   BASE_URL=http://localhost:3000
 *   STOCKX_TOKEN="your_jwt_token"   (only used if falling back to /api/stockx)
 *   STATE=PENDING
 *   CURRENCY=CHF
 *   PAGE_SIZE=50
 *   PAGES=20
 *   OUTPUT=stockx-buying-all.json
 */

const fs = require("node:fs/promises");
const path = require("node:path");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const TOKEN_ENV = (process.env.STOCKX_TOKEN || "").trim().replace(/^Bearer\s+/i, "");
const STATE = process.env.STATE || "PENDING";
const CURRENCY = process.env.CURRENCY || "CHF";
const PAGE_SIZE = Number(process.env.PAGE_SIZE || 50);
const PAGES = Number(process.env.PAGES || 20);
const OUTPUT = process.env.OUTPUT || "stockx-buying-all.json";
const TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token-galaxus.json");

async function readTokenFromFile() {
  try {
    const raw = (await fs.readFile(TOKEN_FILE, "utf8")).trim();
    if (!raw) return "";
    if (raw.startsWith("{")) {
      const parsed = JSON.parse(raw);
      return String(parsed?.token || "")
        .trim()
        .replace(/^Bearer\s+/i, "");
    }
    return raw.replace(/^Bearer\s+/i, "");
  } catch {
    return "";
  }
}

const BUYING_QUERY = `
query Buying(
  $first: Int
  $after: String
  $currencyCode: CurrencyCode
  $query: String
  $state: BuyingGeneralState
  $sort: BuyingSortInput
  $order: AscDescOrderInput
) {
  viewer {
    buying(
      query: $query
      state: $state
      currencyCode: $currencyCode
      first: $first
      after: $after
      sort: $sort
      order: $order
    ) {
      edges {
        node {
          chainId
          orderId
          orderNumber
          amount
          currencyCode
          purchaseDate
          creationDate
          estimatedDeliveryDateRange {
            estimatedDeliveryDate
            latestEstimatedDeliveryDate
          }
          state {
            statusKey
            statusTitle
          }
          localizedSizeTitle
          localizedSizeType
          productVariant {
            id
            traits { size sizeDescriptor }
            sizeChart {
              baseType
              baseSize
              displayOptions { size type }
            }
            product {
              id
              name
              title
              model
              styleId
              media { thumbUrl }
            }
          }
        }
      }
      pageInfo {
        endCursor
        hasNextPage
        totalCount
        startCursor
        hasPreviousPage
      }
    }
  }
}
`;

async function postStockx(body) {
  const res = await fetch(`${BASE_URL}/api/stockx`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }

  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }
  if (json?.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 500)}`);
  }

  return json;
}

(async () => {
  // Preferred path: use the server-side endpoint that already reads the token file
  // and is allowed by the proxy (no auth_token cookie required).
  const dumpUrl = new URL(`${BASE_URL}/api/galaxus/stx/buying-orders`);
  dumpUrl.searchParams.set("state", STATE);
  dumpUrl.searchParams.set("first", String(PAGE_SIZE));
  dumpUrl.searchParams.set("pages", String(PAGES));
  try {
    const res = await fetch(dumpUrl.toString(), { headers: { accept: "application/json" } });
    const json = await res.json().catch(() => null);
    if (res.ok && json?.ok && Array.isArray(json.orders)) {
      const payload = {
        fetchedAt: new Date().toISOString(),
        count: json.orders.length,
        state: json.state ?? STATE,
        currency: CURRENCY,
        orders: json.orders,
      };
      await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
      console.log(`Done. Saved ${json.orders.length} orders to ${OUTPUT}`);
      return;
    }
    throw new Error(json?.error || `HTTP ${res.status}`);
  } catch (error) {
    console.warn(
      `Warning: /api/galaxus/stx/buying-orders failed (${error.message}). Falling back to /api/stockx (may require login cookie).`
    );
  }

  const TOKEN_FILE_VALUE = await readTokenFromFile();
  const TOKEN = TOKEN_ENV || TOKEN_FILE_VALUE;
  if (!TOKEN) {
    console.error("Missing StockX token. Set STOCKX_TOKEN or ensure .data/stockx-token-galaxus.json exists.");
    process.exit(1);
  }

  const allNodes = [];
  let after = "";
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    const variables = {
      first: PAGE_SIZE,
      after,
      currencyCode: CURRENCY,
      query: null,
      state: STATE,
      sort: "MATCHED_AT",
      order: "DESC",
    };

    const data = await postStockx({
      token: TOKEN,
      operationName: "Buying",
      query: BUYING_QUERY,
      variables,
    });

    const buying = data?.data?.viewer?.buying;
    const edges = Array.isArray(buying?.edges) ? buying.edges : [];
    const pageInfo = buying?.pageInfo || {};

    const nodes = edges.map((e) => e?.node).filter(Boolean);
    allNodes.push(...nodes);

    hasNextPage = Boolean(pageInfo.hasNextPage);
    after = pageInfo.endCursor || "";

    console.log(
      `Page ${page}: +${nodes.length} orders (total=${allNodes.length}) hasNext=${hasNextPage}`
    );

    page += 1;
    if (hasNextPage && !after) {
      throw new Error("hasNextPage=true but endCursor is empty");
    }

    if (hasNextPage) await new Promise((r) => setTimeout(r, 250));
  }

  const payload = {
    fetchedAt: new Date().toISOString(),
    count: allNodes.length,
    state: STATE,
    currency: CURRENCY,
    orders: allNodes,
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Done. Saved ${allNodes.length} orders to ${OUTPUT}`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

