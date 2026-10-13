/**
 * Align Shopify "Website stock" with live StockX asks (same rule as the Python
 * consumer: 1 when the size has ≥1 ask, 0 otherwise).
 *
 * Shopify quantities are otherwise only written by the Python SSE consumer,
 * which only runs on SSE events / sweeper refreshes, so sizes that sell out or
 * come back between those drift from the DB. A Shopify variant is changed only when:
 *   - it is stocked at the online location (Chemin / Website stock),
 *   - it matches exactly one StockX variant of the live payload,
 *   - zero: available > 0 and that StockX variant has 0 asks across every lane,
 *   - restore: available = 0, ≥1 ask and a Shopify price ≥ the lowest live ask,
 *   - it is not price_locked and not an admin-only product.
 * Physical locations are never touched; unmatched / ambiguous sizes are skipped.
 */
import crypto from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { extractVariantEan, extractVariantGtin } from "@/galaxus/kickdb/client";
import { ONLINE_LOCATION } from "@/shopify/inventory/locationConfig";
import { isAdminOnlyShopifyVariant } from "@/shopify/protection/adminOnlyProducts";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";

const VARIANTS_QUERY = /* GraphQL */ `
query StxStockVariants($id: ID!, $loc: ID!) {
  product(id: $id) {
    id
    variants(first: 100) {
      nodes {
        id
        title
        price
        barcode
        usSize: metafield(namespace: "custom", key: "us_size") { value }
        priceLocked: metafield(namespace: "custom", key: "price_locked") { value }
        inventoryItem {
          id
          inventoryLevel(locationId: $loc) {
            quantities(names: ["available"]) { quantity }
          }
        }
      }
    }
  }
}`;

const SET_QUANTITIES = /* GraphQL */ `
mutation StxStockSet($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    userErrors { field message }
  }
}`;

export type StxShopifyVariant = {
  id: string;
  title: string | null;
  price?: string | null;
  barcode: string | null;
  usSize: { value: string | null } | null;
  priceLocked?: { value: string | null } | null;
  inventoryItem?: {
    id: string;
    inventoryLevel: { quantities: Array<{ quantity: number }> } | null;
  } | null;
};

export type LiveStxVariant = {
  barcodes: Set<string>;
  /** EU sizes ("37 1/3", "40.5"). */
  eu: Set<string>;
  /** StockX primary size + US men's ("7", "4C", "5W"). Never the other gender's US. */
  primary: Set<string>;
  asks: number;
  /** Lowest ask price across lanes with asks (payload currency, CHF). */
  minAsk: number | null;
};

export type StxStockStats = {
  checked: number;
  inSync: number;
  unmatched: number;
  notStocked: number;
  noPrice: number;
  underpriced: number;
  locked: number;
  adminOnly: number;
  zeroed: number;
  restored: number;
  applyFail: number;
  examples: string[];
};

export function emptyStxStockStats(): StxStockStats {
  return {
    checked: 0,
    inSync: 0,
    unmatched: 0,
    notStocked: 0,
    noPrice: 0,
    underpriced: 0,
    locked: 0,
    adminOnly: 0,
    zeroed: 0,
    restored: 0,
    applyFail: 0,
    examples: [],
  };
}

function gtinKey(value: string | null | undefined): string {
  return cleanGtin(String(value ?? "")).replace(/^0+/, "");
}

/** "EU 37 1/3" / "US M 7" / "7,5" / "UK 6 (EU 40)" → "37 1/3" / "7" / "7.5" / "6". */
export function normSize(raw: unknown): string {
  return String(raw ?? "")
    .toUpperCase()
    .replace(/\(.*\)/, "")
    .replace(",", ".")
    .replace(/^(EU|US|UK)\s*/, "")
    .replace(/^(M|W|Y|C|K)\s+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function liveVariantsFromPayload(payload: any): LiveStxVariant[] {
  const variants = Array.isArray(payload?.variants) ? payload.variants : [];
  return variants.map((v: any) => {
    const barcodes = new Set<string>();
    for (const b of [extractVariantGtin(v), extractVariantEan(v)]) {
      const k = gtinKey(b);
      if (k) barcodes.add(k);
    }
    for (const id of Array.isArray(v?.identifiers) ? v.identifiers : []) {
      const k = gtinKey(id?.identifier);
      if (k.length >= 8) barcodes.add(k);
    }
    const eu = new Set<string>();
    const primary = new Set<string>();
    const add = (set: Set<string>, raw: unknown) => {
      const n = normSize(raw);
      if (n) set.add(n);
    };
    add(eu, v?.size_eu);
    add(primary, v?.size);
    add(primary, v?.size_us);
    for (const entry of Array.isArray(v?.sizes) ? v.sizes : []) {
      const type = String(entry?.type ?? "").toLowerCase();
      if (type === "eu") add(eu, entry?.size);
      else if (type === "us m" || type === "us") add(primary, entry?.size);
    }
    const lanes = (Array.isArray(v?.prices) ? v.prices : []).filter((p: any) => Number(p?.asks) > 0);
    const asks = lanes.reduce((sum: number, p: any) => sum + Number(p.asks), 0);
    const askPrices = lanes.map((p: any) => Number(p?.price)).filter((n: number) => Number.isFinite(n) && n > 0);
    const minAsk = askPrices.length > 0 ? Math.min(...askPrices) : null;
    return { barcodes, eu, primary, asks, minAsk };
  });
}

/**
 * Barcode → title as EU → title as primary size → us_size metafield as primary.
 * First step with a unique hit wins; an ambiguous step returns null.
 */
export function matchLiveStxVariant(
  node: Pick<StxShopifyVariant, "title" | "barcode" | "usSize">,
  live: LiveStxVariant[]
): LiveStxVariant | null {
  const title = normSize(node.title);
  const us = normSize(node.usSize?.value);
  const barcode = gtinKey(node.barcode);
  const steps: Array<(l: LiveStxVariant) => boolean> = [
    (l) => Boolean(barcode) && l.barcodes.has(barcode),
    (l) => Boolean(title) && l.eu.has(title),
    (l) => Boolean(title) && l.primary.has(title),
    (l) => Boolean(us) && l.primary.has(us),
  ];
  for (const step of steps) {
    const hits = live.filter(step);
    if (hits.length === 1) return hits[0]!;
    if (hits.length > 1) return null;
  }
  return null;
}

export type StxStockDecision =
  | { action: "zero" | "restore"; from: number; to: number }
  | {
      action: "skip";
      reason: "inSync" | "unmatched" | "notStocked" | "noPrice" | "underpriced" | "locked" | "adminOnly";
    };

/** `live === null` = delisted product: every size is sold out. */
export function decideStxStock(
  node: StxShopifyVariant,
  live: LiveStxVariant[] | null,
  productGid: string
): StxStockDecision {
  const level = node.inventoryItem?.inventoryLevel;
  if (!node.inventoryItem?.id || !level) return { action: "skip", reason: "notStocked" };
  const qty = level.quantities?.[0]?.quantity ?? 0;

  let wanted: 0 | 1 = 0;
  let minAsk: number | null = null;
  if (live) {
    const hit = matchLiveStxVariant(node, live);
    if (!hit) return { action: "skip", reason: "unmatched" };
    wanted = hit.asks > 0 ? 1 : 0;
    minAsk = hit.minAsk;
  }
  if (wanted === 0 ? qty <= 0 : qty !== 0) return { action: "skip", reason: "inSync" };

  if (String(node.priceLocked?.value ?? "").trim().toLowerCase() === "true") {
    return { action: "skip", reason: "locked" };
  }
  if (isAdminOnlyShopifyVariant(node.id, productGid)) return { action: "skip", reason: "adminOnly" };
  if (wanted === 1) {
    const price = Number(node.price);
    if (!(price > 0)) return { action: "skip", reason: "noPrice" };
    // A stale price under the live buy price would sell at a loss; the price workers fix it first.
    if (minAsk !== null && price < minAsk) return { action: "skip", reason: "underpriced" };
  }

  return wanted === 1 ? { action: "restore", from: qty, to: 1 } : { action: "zero", from: qty, to: 0 };
}

export async function syncShopifyStxStockForProduct(input: {
  shopifyProductId: string;
  /** Live KicksDB product. `null` = delisted product: every size is sold out. */
  payload: unknown | null;
  apply: boolean;
  stats?: StxStockStats;
}): Promise<StxStockStats> {
  const stats = input.stats ?? emptyStxStockStats();
  const productGid = input.shopifyProductId.startsWith("gid://")
    ? input.shopifyProductId
    : `gid://shopify/Product/${input.shopifyProductId}`;
  const locationId = ONLINE_LOCATION.id;

  const live = input.payload === null ? null : liveVariantsFromPayload(input.payload);
  if (live && live.length === 0) return stats;

  const res = await shopifyGraphQL<{ product: { variants: { nodes: StxShopifyVariant[] } } | null }>(
    VARIANTS_QUERY,
    { id: productGid, loc: locationId }
  );
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));

  const changes: Array<{ node: StxShopifyVariant; action: "zero" | "restore"; from: number; to: number }> = [];
  for (const node of res.data?.product?.variants?.nodes ?? []) {
    const d = decideStxStock(node, live, productGid);
    if (d.action === "skip") {
      if (d.reason !== "notStocked") stats.checked += 1;
      stats[d.reason] += 1;
      continue;
    }
    stats.checked += 1;
    changes.push({ node, ...d });
  }
  if (changes.length === 0) return stats;

  const zeroed = changes.filter((c) => c.action === "zero").length;
  const restored = changes.length - zeroed;
  if (stats.examples.length < 15) {
    stats.examples.push(`${productGid} → ${changes.map((c) => `${c.node.title}(${c.from}→${c.to})`).join(", ")}`);
  }
  if (!input.apply) {
    stats.zeroed += zeroed;
    stats.restored += restored;
    return stats;
  }

  try {
    const upd = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: Array<{ message: string }> } }>(
      SET_QUANTITIES,
      {
        input: {
          name: "available",
          reason: "correction",
          referenceDocumentUri: `gid://resell-lausanne/StxStockSync/${Date.now()}`,
          quantities: changes.map((c) => ({
            inventoryItemId: c.node.inventoryItem!.id,
            locationId,
            quantity: c.to,
            changeFromQuantity: c.from,
          })),
        },
        idempotencyKey: crypto.randomUUID(),
      }
    );
    const errs = [
      ...(upd.errors ?? []).map((e) => e.message),
      ...(upd.data?.inventorySetQuantities?.userErrors ?? []).map((e) => e.message),
    ];
    if (errs.length) throw new Error(errs.join("; "));
    stats.zeroed += zeroed;
    stats.restored += restored;
  } catch (err) {
    stats.applyFail += changes.length;
    console.error(`[stx-stock-shopify] apply ${productGid}:`, err instanceof Error ? err.message : err);
  }
  return stats;
}

/**
 * `stx-refresh` / delist hook: align the product's Website stock with the live
 * payload (`null` = delisted → every Website-stock size to 0). Never throws.
 */
export async function syncShopifyStxStockForKickdbProduct(
  kickdbProductId: string,
  payload: unknown | null
): Promise<{ zeroed: number; restored: number }> {
  const none = { zeroed: 0, restored: 0 };
  const toggle = process.env.STX_REFRESH_SHOPIFY_STOCK ?? process.env.STX_REFRESH_SHOPIFY_ZERO ?? "1";
  if (["0", "false", "no"].includes(toggle.toLowerCase())) {
    return none;
  }
  try {
    const sss = await prisma.shopifySyncState.findFirst({
      where: { kickdbProductId, syncStatus: "synced", shopifyProductId: { not: null } },
      select: { shopifyProductId: true },
    });
    if (!sss?.shopifyProductId) return none;
    const stats = await syncShopifyStxStockForProduct({
      shopifyProductId: sss.shopifyProductId,
      payload,
      apply: true,
    });
    return { zeroed: stats.zeroed, restored: stats.restored };
  } catch (err) {
    console.warn("[stx-stock-shopify] hook failed", {
      kickdbProductId,
      err: err instanceof Error ? err.message : err,
    });
    return none;
  }
}
