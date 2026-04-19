#!/usr/bin/env node
/**
 * StockX full fetch + enrichment (A + B), using PUBLIC Galaxus endpoints.
 *
 * Why: /api/stockx can redirect to /login (auth_token cookie). /api/galaxus/* is public in proxy.ts.
 *
 * What it does:
 * A) Fetches pages of StockX Buying orders via:
 *    GET /api/galaxus/stx/buying-orders?state=...&pages=...&first=...
 * B) Enriches each order with details via:
 *    GET /api/galaxus/stx/buy-order-details?chainId=...&orderId=...
 * C) Saves JSON to disk.
 *
 * Usage:
 *   node scripts/stockx-full-fetch-enriched.js
 *
 * Optional env:
 *   BASE_URL=http://localhost:3000
 *   STATE=PENDING
 *   FIRST=50
 *   PAGES=8
 *   BATCH_SIZE=10
 *   BATCH_DELAY_MS=750
 *   OUTPUT=stockx-full-enriched.json
 */

const fs = require("node:fs/promises");

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const STATE = process.env.STATE || "PENDING";
const FIRST = Number(process.env.FIRST || 50);
const PAGES = Number(process.env.PAGES || 8);
const BATCH_SIZE = Number(process.env.BATCH_SIZE || 10);
const BATCH_DELAY_MS = Number(process.env.BATCH_DELAY_MS || 750);
const OUTPUT = process.env.OUTPUT || "stockx-full-enriched.json";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function getJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Non-JSON response (${res.status}): ${text.slice(0, 300)}`);
  }
  if (!res.ok || json?.ok === false) {
    throw new Error(json?.error || `HTTP ${res.status}`);
  }
  return json;
}

function mapBuyingNode(node) {
  const product = node?.productVariant?.product || {};
  const displayOptions = node?.productVariant?.sizeChart?.displayOptions || [];
  const eu = displayOptions.find((o) => o?.type === "eu");

  let size = null;
  if (eu?.size) size = eu.size;
  else if (node?.localizedSizeTitle) size = node.localizedSizeTitle;

  return {
    chainId: node?.chainId || "",
    orderId: node?.orderId || "",
    orderNumber: node?.orderNumber || null,
    purchaseDate: node?.purchaseDate || null,
    creationDate: node?.creationDate || null,
    statusKey: node?.state?.statusKey || null,
    statusTitle: node?.state?.statusTitle || null,
    amount: typeof node?.amount === "number" ? node.amount : null,
    currencyCode: node?.currencyCode || null,
    productName: product?.name || null,
    productTitle: product?.title || null,
    displayName: product?.title || product?.name || "—",
    styleId: product?.styleId || null,
    model: product?.model || null,
    skuKey: product?.styleId || product?.model || product?.id || node?.productVariant?.id || "unknown",
    size,
    sizeType: node?.localizedSizeType || null,
    estimatedDeliveryDate: node?.estimatedDeliveryDateRange?.estimatedDeliveryDate || null,
    latestEstimatedDeliveryDate: node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate || null,
    productVariantId: node?.productVariant?.id || null,
    thumbUrl: product?.media?.thumbUrl || null,
    raw: node,
  };
}

function mergeEnrichment(base, details) {
  const buyOrder = details?.order || null;
  return {
    ...base,
    enrich: {
      chainId: details?.chainId || base.chainId,
      orderId: details?.orderId || base.orderId,
      awb: details?.awb ?? null,
      etaMin: details?.etaMin ?? null,
      etaMax: details?.etaMax ?? null,
      buyOrder,
    },
  };
}

async function fetchAllBuying() {
  const url = new URL(`${BASE_URL}/api/galaxus/stx/buying-orders`);
  url.searchParams.set("state", STATE);
  url.searchParams.set("first", String(FIRST));
  url.searchParams.set("pages", String(PAGES));

  const json = await getJson(url.toString());
  const orders = Array.isArray(json.orders) ? json.orders : [];
  return orders;
}

async function enrichOne(base) {
  const url = new URL(`${BASE_URL}/api/galaxus/stx/buy-order-details`);
  url.searchParams.set("chainId", base.chainId);
  url.searchParams.set("orderId", base.orderId);
  try {
    const details = await getJson(url.toString());
    return mergeEnrichment(base, details);
  } catch (err) {
    return {
      ...base,
      enrich: {
        error: String(err?.message || err),
      },
    };
  }
}

async function enrichAll(basicOrders) {
  const out = [];
  const total = basicOrders.length;
  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = basicOrders.slice(i, i + BATCH_SIZE);
    const enriched = await Promise.all(batch.map(enrichOne));
    out.push(...enriched);
    console.log(`Enriched ${Math.min(i + BATCH_SIZE, total)}/${total}`);
    if (i + BATCH_SIZE < total) await sleep(BATCH_DELAY_MS);
  }
  return out;
}

(async () => {
  console.log("Starting A (buying orders)...");
  const rawOrders = await fetchAllBuying();
  const basicOrders = rawOrders.map(mapBuyingNode).filter((o) => o.chainId && o.orderId);
  console.log(`A done: ${basicOrders.length} orders`);

  console.log("Starting B (details enrichment)...");
  const enrichedOrders = await enrichAll(basicOrders);

  const payload = {
    fetchedAt: new Date().toISOString(),
    baseUrl: BASE_URL,
    state: STATE,
    counts: {
      basic: basicOrders.length,
      enriched: enrichedOrders.length,
    },
    basicOrders,
    enrichedOrders,
  };

  await fs.writeFile(OUTPUT, JSON.stringify(payload, null, 2), "utf8");
  console.log(`Done. Saved to ${OUTPUT}`);
})().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});

