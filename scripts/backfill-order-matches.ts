#!/usr/bin/env npx tsx
/**
 * Backfill missing OrderMatch rows for Shopify paid orders.
 *
 * Coverage today ~65% (30d) / 76% (90d) → target >90%.
 *
 * Runs headless: fetch unmatched Shopify lines + StockX buys (all states) +
 * in-stock Essentials/Bape/AP fixed-price rules, run matchShopifyToSupplier,
 * upsert high-confidence matches to OrderMatch. Skips already-matched lines
 * and StockX buys already claimed elsewhere.
 *
 * Usage:
 *   npx tsx scripts/backfill-order-matches.ts --days=30              # dry-run
 *   npx tsx scripts/backfill-order-matches.ts --days=90 --apply
 *   npx tsx scripts/backfill-order-matches.ts --days=90 --apply --limit=25
 *   npx tsx scripts/backfill-order-matches.ts --days=30 --json=tmp/backfill-30d.json
 *
 * Flags:
 *   --days=N       Lookback window (default 30, max 365).
 *   --apply        Persist to DB. Otherwise dry-run only.
 *   --limit=N      Only apply first N high-confidence matches.
 *   --include-medium  Also list medium-confidence (never applies).
 *   --enrich       Fetch StockX buy details for supplierCost (slower, needs valid token).
 *   --json=PATH    Write full report JSON.
 */
import "dotenv/config";
import fs from "node:fs";
import { PrismaClient } from "@prisma/client";
import {
  isPackageProtectionShopifyLine,
  isShopifyFinancialRefunded,
  matchShopifyToSupplier,
  resolveInStockEssential,
  type NormalizedSupplierOrder,
  type ShopifyLineItem,
} from "@/app/utils/matching";
import { resolveShopifyAdminEnv } from "@/lib/shopifyEnv";
import {
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import { getSupplierToken } from "@/lib/stockxToken";

const prisma = new PrismaClient();

function argFlag(name: string, fallback?: string): string | undefined {
  const p = `--${name}=`;
  const hit = process.argv.find((a) => a.startsWith(p));
  if (hit) return hit.slice(p.length);
  return process.argv.includes(`--${name}`) ? "" : fallback;
}
function argBool(name: string): boolean {
  return process.argv.includes(`--${name}`);
}
function argInt(name: string, fallback: number): number {
  const v = argFlag(name);
  if (v == null || v === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

const DAYS = Math.min(365, argInt("days", 30));
const APPLY = argBool("apply");
const LIMIT = argInt("limit", 10_000);
const INCLUDE_MEDIUM = argBool("include-medium");
const ENRICH = argBool("enrich");
const JSON_OUT = argFlag("json");

const { shop: SHOP, token: SHOPIFY_TOKEN, version: SHOPIFY_API_VERSION } =
  resolveShopifyAdminEnv();

function gidToId(gid: string): string {
  const s = String(gid || "");
  const m = s.match(/\/(\d+)\s*$/);
  return m ? m[1] : s;
}

async function shopifyGql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!SHOP || !SHOPIFY_TOKEN) {
    throw new Error("Missing SHOPIFY_SHOP_DOMAIN / SHOPIFY_ADMIN_API_ACCESS_TOKEN");
  }
  const shop = SHOP.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const res = await fetch(`https://${shop}/admin/api/${SHOPIFY_API_VERSION}/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": SHOPIFY_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: unknown[] };
  if (json.errors?.length) throw new Error(`Shopify GQL: ${JSON.stringify(json.errors)}`);
  return json.data as T;
}

type UnmatchedLine = ShopifyLineItem & {
  reason?: string;
  qty: number;
};

async function fetchUnmatchedShopifyLines(days: number): Promise<{
  lines: UnmatchedLine[];
  ordersScanned: number;
  linesScanned: number;
  protectionSkipped: number;
  cancelledSkipped: number;
  refundedSkipped: number;
  alreadyMatchedSkipped: number;
}> {
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (days - 1));
  since.setUTCHours(0, 0, 0, 0);

  const matches = await prisma.orderMatch.findMany({
    where: { shopifyCreatedAt: { gte: since } },
    select: { shopifyLineItemId: true },
  });
  const matchedIds = new Set(matches.map((m) => String(m.shopifyLineItemId)));

  const query = `
    query UnmatchedScan($cursor: String) {
      orders(
        first: 50
        after: $cursor
        sortKey: CREATED_AT
        reverse: true
        query: "created_at:>=${since.toISOString().slice(0, 10)} financial_status:paid"
      ) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            createdAt
            displayFinancialStatus
            displayFulfillmentStatus
            cancelledAt
            customer { email firstName lastName }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  variantTitle
                  sku
                  quantity
                  currentQuantity
                  originalUnitPriceSet { shopMoney { amount currencyCode } }
                  image { url }
                  variant { barcode selectedOptions { name value } }
                }
              }
            }
          }
        }
      }
    }
  `;

  const out: UnmatchedLine[] = [];
  let cursor: string | null = null;
  let ordersScanned = 0;
  let linesScanned = 0;
  let protectionSkipped = 0;
  let cancelledSkipped = 0;
  let refundedSkipped = 0;
  let alreadyMatchedSkipped = 0;

  for (;;) {
    const data = await shopifyGql<{
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: any[] };
    }>(query, { cursor });

    for (const edge of data.orders.edges) {
      const o = edge.node;
      if (o.cancelledAt) {
        cancelledSkipped += 1;
        continue;
      }
      if (isShopifyFinancialRefunded(o.displayFinancialStatus)) {
        refundedSkipped += 1;
        continue;
      }
      ordersScanned += 1;
      const shopifyOrderId = gidToId(o.id);
      for (const liE of o.lineItems?.edges ?? []) {
        const li = liE.node;
        linesScanned += 1;
        const title = String(li.title ?? "");
        const sku = li.sku ? String(li.sku) : null;
        if (isPackageProtectionShopifyLine(title, sku)) {
          protectionSkipped += 1;
          continue;
        }
        const qty = Number(li.currentQuantity ?? li.quantity ?? 0);
        if (!Number.isFinite(qty) || qty <= 0) continue;
        const lineItemId = gidToId(li.id);
        if (matchedIds.has(lineItemId)) {
          alreadyMatchedSkipped += 1;
          continue;
        }

        const sizeOpt = (li.variant?.selectedOptions ?? []).find((opt: any) =>
          /size/i.test(String(opt?.name ?? ""))
        );
        const sizeEU = sizeOpt?.value ? String(sizeOpt.value) : li.variantTitle || null;
        const currency = String(li.originalUnitPriceSet?.shopMoney?.currencyCode || "CHF");
        const unitPrice = Number(li.originalUnitPriceSet?.shopMoney?.amount ?? 0);
        const totalPrice = unitPrice * qty;

        const shopifyItem: UnmatchedLine = {
          shopifyOrderId,
          orderName: String(o.name),
          createdAt: String(o.createdAt),
          displayFinancialStatus: String(o.displayFinancialStatus ?? ""),
          displayFulfillmentStatus: o.displayFulfillmentStatus ?? null,
          customerEmail: o.customer?.email ?? null,
          customerName:
            [o.customer?.firstName, o.customer?.lastName].filter(Boolean).join(" ") || null,
          customerFirstName: o.customer?.firstName ?? null,
          customerLastName: o.customer?.lastName ?? null,
          shippingCountry: null,
          shippingCity: null,
          lineItemId,
          title,
          sku,
          variantTitle: li.variantTitle ?? null,
          quantity: qty,
          price: String(unitPrice),
          totalPrice: String(totalPrice),
          currencyCode: currency,
          sizeEU,
          lineItemImageUrl: li.image?.url ?? null,
          qty,
        };
        out.push(shopifyItem);
      }
    }

    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
    if (ordersScanned > 10_000) break;
  }

  return {
    lines: out,
    ordersScanned,
    linesScanned,
    protectionSkipped,
    cancelledSkipped,
    refundedSkipped,
    alreadyMatchedSkipped,
  };
}

function normalizeStockxNode(n: StockxBuyingNode): NormalizedSupplierOrder | null {
  const orderNumber = String(n.orderNumber ?? "").trim();
  const orderId = String(n.orderId ?? "").trim();
  if (!orderNumber || !orderId) return null;
  const purchaseDate = String((n as any).creationDate ?? n.purchaseDate ?? "");
  const variantAny = (n as any).productVariant ?? {};
  const productAny = variantAny?.product ?? {};
  const media = productAny?.media ?? {};
  const localizedSize = String(n.localizedSizeTitle ?? "");
  const sizeType = String(n.localizedSizeType ?? "").toUpperCase();
  const sizeEU = sizeType.includes("EU") ? localizedSize.replace(/^EU\s*/i, "") : localizedSize;
  const skuKey =
    String(
      variantAny?.styleId ??
        variantAny?.model ??
        productAny?.styleId ??
        productAny?.urlKey ??
        ""
    ) || null;

  return {
    supplierOrderNumber: orderNumber,
    chainId: String(n.chainId ?? ""),
    orderId,
    supplierSource: "STOCKX",
    purchaseDate,
    offerAmount: typeof n.amount === "number" ? n.amount : null,
    totalTTC: null,
    productTitle: String(productAny?.title ?? variantAny?.product?.name ?? "—"),
    skuKey: skuKey ?? "",
    sizeEU: sizeEU || null,
    statusKey: n.state?.statusKey ?? null,
    statusTitle: n.state?.statusTitle ?? null,
    currencyCode: n.currencyCode ?? "CHF",
    stockxCheckoutType: null,
    stockxStates: null,
  } as NormalizedSupplierOrder;
}

async function fetchStockxSupply(token: string): Promise<{
  raw: StockxBuyingNode[];
  normalized: NormalizedSupplierOrder[];
}> {
  // StockX buying API collapses AUTHENTICATED/SHIPPED/COMPLETED/CANCELED into HISTORICAL.
  // state:null returns 0; fetch PENDING (active) + HISTORICAL (settled).
  const dedupe = new Map<string, StockxBuyingNode>();
  for (const state of ["PENDING", "HISTORICAL"] as const) {
    const batch = await fetchRecentStockxBuyingOrders(token, {
      first: 100,
      maxPages: 40,
      state,
      query: null,
    });
    for (const n of batch) {
      const key = String(n.orderId || n.orderNumber || "");
      if (key && !dedupe.has(key)) dedupe.set(key, n);
    }
  }
  const raw = Array.from(dedupe.values());
  const normalized: NormalizedSupplierOrder[] = [];
  for (const n of raw) {
    const norm = normalizeStockxNode(n);
    if (norm) normalized.push(norm);
  }
  return { raw, normalized };
}

async function enrichSupplierCost(
  token: string,
  chainId: string,
  orderId: string
): Promise<number | null> {
  try {
    const res = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId });
    const order: any = res?.order ?? null;
    const cost =
      order?.payment?.settledAmount?.value ??
      order?.payment?.authorizedAmount?.value ??
      order?.pricing?.finalized?.local?.total ??
      null;
    const n = typeof cost === "number" ? cost : Number(cost);
    return Number.isFinite(n) && n > 0 ? n : null;
  } catch {
    return null;
  }
}

type Candidate = {
  line: UnmatchedLine;
  supplier: NormalizedSupplierOrder | null;
  supplierSource: "STOCKX" | "ESSENTIAL_STOCK" | "NONE";
  confidence: "high" | "medium" | "low" | "none";
  score: number;
  reasons: string[];
  timeDiffHours: number;
  suggestedCost: number | null;
  costSource: "enriched" | "offer" | "essentials_fixed" | "unknown";
};

async function main() {
  console.log(
    `[backfill-order-matches] days=${DAYS} apply=${APPLY} enrich=${ENRICH} limit=${LIMIT}`
  );

  // Shopify unmatched
  const shop = await fetchUnmatchedShopifyLines(DAYS);
  console.log(
    `[backfill-order-matches] shopify: scanned ${shop.ordersScanned} orders / ${shop.linesScanned} lines · unmatched candidates ${shop.lines.length} (protection ${shop.protectionSkipped}, cancelled ${shop.cancelledSkipped}, refunded ${shop.refundedSkipped}, already-matched ${shop.alreadyMatchedSkipped})`
  );

  // StockX supply
  const token = await getSupplierToken();
  let stockx: { raw: StockxBuyingNode[]; normalized: NormalizedSupplierOrder[] } = {
    raw: [],
    normalized: [],
  };
  if (token) {
    try {
      stockx = await fetchStockxSupply(token);
      console.log(
        `[backfill-order-matches] stockx: fetched ${stockx.raw.length} raw / ${stockx.normalized.length} normalized`
      );
    } catch (err: any) {
      console.warn(`[backfill-order-matches] stockx fetch failed: ${err?.message || err}`);
    }
  } else {
    console.warn(
      "[backfill-order-matches] no StockX token in DB → will only backfill essentials/in-stock fixed-price"
    );
  }

  // Existing claims
  const existingClaims = await prisma.orderMatch.findMany({
    select: { stockxOrderNumber: true },
    where: { stockxOrderNumber: { not: "" } },
  });
  const usedSupplierNumbers = new Set<string>(
    existingClaims.map((c) => String(c.stockxOrderNumber || "")).filter(Boolean)
  );
  console.log(
    `[backfill-order-matches] claims: ${usedSupplierNumbers.size} StockX order numbers already used`
  );

  // FIFO Shopify lines by createdAt asc — same order UI uses
  const sortedLines = [...shop.lines].sort(
    (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
  );

  const candidates: Candidate[] = [];
  for (const line of sortedLines) {
    const result = matchShopifyToSupplier(line, stockx.normalized, usedSupplierNumbers, null);
    const best = result.bestMatch;

    // Fixed-price in-stock (Essentials/Bape/AP): matchShopifyToSupplier already produces synthetic ESS-*
    // only when physicalStockQty > 0 which we don't have here. Try our own resolver as fallback.
    if (!best) {
      const rule = resolveInStockEssential(line.sku, line.title);
      if (rule) {
        candidates.push({
          line,
          supplier: null,
          supplierSource: "ESSENTIAL_STOCK",
          confidence: "high",
          score: 100,
          reasons: [rule.matchReason, "in_stock_fixed_price"],
          timeDiffHours: 0,
          suggestedCost: rule.costChf,
          costSource: "essentials_fixed",
        });
        continue;
      }
      candidates.push({
        line,
        supplier: null,
        supplierSource: "NONE",
        confidence: "none",
        score: 0,
        reasons: ["no_candidate"],
        timeDiffHours: 0,
        suggestedCost: null,
        costSource: "unknown",
      });
      continue;
    }

    const supplier = best.supplierOrder;
    let suggestedCost: number | null =
      typeof supplier.offerAmount === "number" ? supplier.offerAmount : null;
    let costSource: Candidate["costSource"] = suggestedCost != null ? "offer" : "unknown";

    if (ENRICH && token && supplier.chainId && supplier.orderId) {
      const enriched = await enrichSupplierCost(token, supplier.chainId, supplier.orderId);
      if (enriched != null) {
        suggestedCost = enriched;
        costSource = "enriched";
      }
      await new Promise((r) => setTimeout(r, 320));
    }

    candidates.push({
      line,
      supplier,
      supplierSource: "STOCKX",
      confidence: best.confidence,
      score: Number(best.score) || 0,
      reasons: best.reasons,
      timeDiffHours: Number(best.timeDiffHours) || 0,
      suggestedCost,
      costSource,
    });

    // Reserve StockX supplier for FIFO (only if the match is high confidence)
    if (best.confidence === "high") {
      usedSupplierNumbers.add(supplier.supplierOrderNumber);
    }
  }

  const buckets = {
    high: candidates.filter((c) => c.confidence === "high"),
    medium: candidates.filter((c) => c.confidence === "medium"),
    low: candidates.filter((c) => c.confidence === "low"),
    none: candidates.filter((c) => c.confidence === "none"),
  };
  console.log(
    `[backfill-order-matches] candidates: high=${buckets.high.length}, medium=${buckets.medium.length}, low=${buckets.low.length}, none=${buckets.none.length}`
  );

  const highWithCost = buckets.high.filter((c) => c.suggestedCost != null || c.supplierSource === "ESSENTIAL_STOCK");
  const highNoCost = buckets.high.filter((c) => c.suggestedCost == null && c.supplierSource !== "ESSENTIAL_STOCK");
  console.log(
    `[backfill-order-matches] high with cost: ${highWithCost.length} · high missing cost: ${highNoCost.length}`
  );

  const toApply = highWithCost.slice(0, LIMIT);
  let applied = 0;
  const applyErrors: Array<{ lineItemId: string; err: string }> = [];

  if (APPLY && toApply.length) {
    for (const c of toApply) {
      const revenue = Number(c.line.totalPrice) || 0;
      const supplierCost = Number(c.suggestedCost) || 0;
      const margin = Number((revenue - supplierCost).toFixed(2));
      const marginPct = revenue > 0 ? Number(((margin / revenue) * 100).toFixed(2)) : 0;

      const isEss = c.supplierSource === "ESSENTIAL_STOCK";
      const stockxOrderNumber = isEss
        ? `ESS-${c.line.orderName || c.line.lineItemId}`
        : c.supplier?.supplierOrderNumber || `SAVED-${c.line.lineItemId}`;

      try {
        await prisma.orderMatch.upsert({
          where: { shopifyLineItemId: c.line.lineItemId },
          create: {
            shopifyOrderId: c.line.shopifyOrderId,
            shopifyOrderName: c.line.orderName,
            shopifyLineItemId: c.line.lineItemId,
            shopifyProductTitle: c.line.title,
            shopifySku: c.line.sku ?? null,
            shopifySizeEU: c.line.sizeEU ?? null,
            shopifyTotalPrice: revenue,
            shopifyCurrencyCode: c.line.currencyCode || "CHF",
            shopifyCreatedAt: new Date(c.line.createdAt),
            shopifyCustomerEmail: c.line.customerEmail ?? null,
            shopifyCustomerFirstName: c.line.customerFirstName ?? null,
            shopifyCustomerLastName: c.line.customerLastName ?? null,
            shopifyLineItemImageUrl: c.line.lineItemImageUrl ?? null,
            supplierSource: isEss ? "OTHER" : "STOCKX",
            stockxOrderNumber,
            stockxChainId: c.supplier?.chainId || null,
            stockxOrderId: c.supplier?.orderId || null,
            stockxProductName: c.supplier?.productTitle || c.line.title,
            stockxSizeEU: c.supplier?.sizeEU || c.line.sizeEU || null,
            stockxSkuKey: c.supplier?.skuKey || c.line.sku || null,
            stockxPurchaseDate: c.supplier?.purchaseDate
              ? new Date(c.supplier.purchaseDate)
              : null,
            matchConfidence: "high",
            matchScore: c.score,
            matchType: isEss ? "essentials_in_stock" : "auto_backfill",
            matchReasons: JSON.stringify(c.reasons),
            timeDiffHours: c.timeDiffHours,
            stockxStatus: isEss ? "ESSENTIAL_STOCK" : c.supplier?.statusKey || "MATCHED",
            supplierCost,
            marginAmount: margin,
            marginPercent: marginPct,
            shopifyMetafieldsSynced: false,
          },
          update: {
            // Only update if the current row is missing critical fields — safety
            supplierCost: supplierCost > 0 ? supplierCost : undefined,
            marginAmount: margin,
            marginPercent: marginPct,
            matchType: isEss ? "essentials_in_stock" : "auto_backfill",
            matchReasons: JSON.stringify(c.reasons),
            matchScore: c.score,
            matchConfidence: "high",
            stockxOrderNumber,
            stockxChainId: c.supplier?.chainId || undefined,
            stockxOrderId: c.supplier?.orderId || undefined,
            stockxProductName: c.supplier?.productTitle || undefined,
            stockxSizeEU: c.supplier?.sizeEU || undefined,
            stockxSkuKey: c.supplier?.skuKey || undefined,
            stockxPurchaseDate: c.supplier?.purchaseDate
              ? new Date(c.supplier.purchaseDate)
              : undefined,
            stockxStatus: isEss ? "ESSENTIAL_STOCK" : c.supplier?.statusKey || undefined,
            supplierSource: isEss ? "OTHER" : "STOCKX",
          },
        });
        applied += 1;
      } catch (err: any) {
        applyErrors.push({
          lineItemId: c.line.lineItemId,
          err: String(err?.message || err),
        });
      }
    }
    console.log(
      `[backfill-order-matches] APPLIED ${applied}/${toApply.length} matches · errors ${applyErrors.length}`
    );
  } else if (toApply.length) {
    console.log(
      `[backfill-order-matches] DRY-RUN — would apply ${toApply.length} high-confidence matches`
    );
  }

  const preview = (list: Candidate[], k: number) =>
    list.slice(0, k).map((c) => ({
      order: c.line.orderName,
      line: c.line.lineItemId,
      title: c.line.title.slice(0, 60),
      sku: c.line.sku,
      size: c.line.sizeEU,
      revenue: Number(c.line.totalPrice) || 0,
      cost: c.suggestedCost,
      costSource: c.costSource,
      confidence: c.confidence,
      score: c.score,
      stockx: c.supplier?.supplierOrderNumber || null,
      reasons: c.reasons,
    }));

  const summary = {
    generatedAt: new Date().toISOString(),
    days: DAYS,
    apply: APPLY,
    enrich: ENRICH,
    limit: LIMIT,
    shopifyOrdersScanned: shop.ordersScanned,
    shopifyLinesScanned: shop.linesScanned,
    protectionSkipped: shop.protectionSkipped,
    cancelledSkipped: shop.cancelledSkipped,
    refundedSkipped: shop.refundedSkipped,
    alreadyMatchedSkipped: shop.alreadyMatchedSkipped,
    unmatchedCandidates: shop.lines.length,
    stockxFetched: stockx.raw.length,
    stockxUsable: stockx.normalized.length,
    stockxClaimsPreExisting: existingClaims.length,
    highConfidence: buckets.high.length,
    highWithCost: highWithCost.length,
    highMissingCost: highNoCost.length,
    mediumConfidence: buckets.medium.length,
    lowConfidence: buckets.low.length,
    noCandidate: buckets.none.length,
    applied,
    applyErrors,
    previewHigh: preview(highWithCost, 25),
    previewHighNoCost: preview(highNoCost, 25),
    previewMedium: INCLUDE_MEDIUM ? preview(buckets.medium, 25) : undefined,
    previewNoCandidate: preview(buckets.none, 25),
  };

  console.log(JSON.stringify(
    {
      ...summary,
      previewHigh: summary.previewHigh.slice(0, 10),
      previewHighNoCost: summary.previewHighNoCost.slice(0, 10),
      previewMedium: undefined,
      previewNoCandidate: summary.previewNoCandidate.slice(0, 10),
    },
    null,
    2
  ));

  const outPath = JSON_OUT || `tmp/backfill-order-matches-${DAYS}d${APPLY ? "-applied" : "-dryrun"}.json`;
  fs.mkdirSync(outPath.replace(/\/[^/]+$/, "") || ".", { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(summary, null, 2));
  console.log(`[backfill-order-matches] wrote ${outPath}`);

  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-order-matches] fatal", err);
  await prisma.$disconnect();
  process.exit(1);
});
