/**
 * Zero Shopify "Website stock" for StockX sizes sold out live.
 *
 * Shopify quantities are otherwise only written by the Python SSE consumer,
 * which never hears about sold-outs found by `stx-refresh`. A Shopify variant
 * is zeroed only when:
 *   - it has available > 0 at the online location (Chemin / Website stock),
 *   - it matches exactly one StockX variant of the live payload,
 *   - that StockX variant has 0 asks across every lane,
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
query ZeroSoldoutVariants($id: ID!, $loc: ID!) {
  product(id: $id) {
    id
    variants(first: 100) {
      nodes {
        id
        title
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
mutation ZeroSoldout($input: InventorySetQuantitiesInput!, $idempotencyKey: String!) {
  inventorySetQuantities(input: $input) @idempotent(key: $idempotencyKey) {
    userErrors { field message }
  }
}`;

export type SoldoutShopifyVariant = {
  id: string;
  title: string | null;
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
};

export type ZeroSoldoutStats = {
  checked: number;
  stillOffered: number;
  unmatched: number;
  locked: number;
  adminOnly: number;
  zeroed: number;
  applyFail: number;
  examples: string[];
};

export function emptyZeroSoldoutStats(): ZeroSoldoutStats {
  return { checked: 0, stillOffered: 0, unmatched: 0, locked: 0, adminOnly: 0, zeroed: 0, applyFail: 0, examples: [] };
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
    const asks = (Array.isArray(v?.prices) ? v.prices : []).reduce(
      (sum: number, p: any) => sum + (Number(p?.asks) > 0 ? Number(p.asks) : 0),
      0
    );
    return { barcodes, eu, primary, asks };
  });
}

/**
 * Barcode → title as EU → title as primary size → us_size metafield as primary.
 * First step with a unique hit wins; an ambiguous step returns null.
 */
export function matchLiveStxVariant(
  node: Pick<SoldoutShopifyVariant, "title" | "barcode" | "usSize">,
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

function availableOnline(node: SoldoutShopifyVariant): number {
  return node.inventoryItem?.inventoryLevel?.quantities?.[0]?.quantity ?? 0;
}

export async function zeroShopifySoldoutForProduct(input: {
  shopifyProductId: string;
  /** Live KicksDB product. `null` = delisted product: every size is sold out. */
  payload: unknown | null;
  apply: boolean;
  stats?: ZeroSoldoutStats;
}): Promise<ZeroSoldoutStats> {
  const stats = input.stats ?? emptyZeroSoldoutStats();
  const productGid = input.shopifyProductId.startsWith("gid://")
    ? input.shopifyProductId
    : `gid://shopify/Product/${input.shopifyProductId}`;
  const locationId = ONLINE_LOCATION.id;

  const delisted = input.payload === null;
  const live = delisted ? [] : liveVariantsFromPayload(input.payload);
  if (!delisted && live.length === 0) return stats;

  const res = await shopifyGraphQL<{ product: { variants: { nodes: SoldoutShopifyVariant[] } } | null }>(
    VARIANTS_QUERY,
    { id: productGid, loc: locationId }
  );
  if (res.errors?.length) throw new Error(res.errors.map((e) => e.message).join("; "));
  const nodes = (res.data?.product?.variants?.nodes ?? []).filter((n) => availableOnline(n) > 0);

  const toZero: Array<{ node: SoldoutShopifyVariant; qty: number }> = [];
  for (const node of nodes) {
    stats.checked += 1;
    if (!delisted) {
      const hit = matchLiveStxVariant(node, live);
      if (!hit) {
        stats.unmatched += 1;
        continue;
      }
      if (hit.asks > 0) {
        stats.stillOffered += 1;
        continue;
      }
    }
    if (String(node.priceLocked?.value ?? "").trim().toLowerCase() === "true") {
      stats.locked += 1;
      continue;
    }
    if (isAdminOnlyShopifyVariant(node.id, productGid)) {
      stats.adminOnly += 1;
      continue;
    }
    toZero.push({ node, qty: availableOnline(node) });
  }
  if (toZero.length === 0) return stats;

  if (stats.examples.length < 15) {
    stats.examples.push(`${productGid} → ${toZero.map((z) => `${z.node.title}(${z.qty})`).join(", ")}`);
  }
  if (!input.apply) {
    stats.zeroed += toZero.length;
    return stats;
  }

  try {
    const upd = await shopifyGraphQL<{ inventorySetQuantities: { userErrors: Array<{ message: string }> } }>(
      SET_QUANTITIES,
      {
        input: {
          name: "available",
          reason: "correction",
          referenceDocumentUri: `gid://resell-lausanne/StxSoldoutZero/${Date.now()}`,
          quantities: toZero.map((z) => ({
            inventoryItemId: z.node.inventoryItem!.id,
            locationId,
            quantity: 0,
            changeFromQuantity: z.qty,
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
    stats.zeroed += toZero.length;
    const now = new Date();
    await prisma.channelListingState.updateMany({
      where: { channel: "SHOPIFY", externalVariantId: { in: toZero.map((z) => z.node.id) } },
      data: { lastPushedStock: 0, soldOutAt: now, lastSyncedAt: now },
    });
  } catch (err) {
    stats.applyFail += toZero.length;
    console.error(`[stx-soldout-zero] apply ${productGid}:`, err instanceof Error ? err.message : err);
  }
  return stats;
}

/**
 * `stx-refresh` / delist hook: push the product's sold-outs to Shopify. With a
 * live payload only 0-ask sizes are zeroed; `null` (delisted) zeroes every
 * Website-stock size. Never throws.
 */
export async function zeroShopifySoldoutForKickdbProduct(
  kickdbProductId: string,
  payload: unknown | null
): Promise<number> {
  if (["0", "false", "no"].includes(String(process.env.STX_REFRESH_SHOPIFY_ZERO ?? "1").toLowerCase())) {
    return 0;
  }
  try {
    const sss = await prisma.shopifySyncState.findFirst({
      where: { kickdbProductId, syncStatus: "synced", shopifyProductId: { not: null } },
      select: { shopifyProductId: true },
    });
    if (!sss?.shopifyProductId) return 0;
    const stats = await zeroShopifySoldoutForProduct({
      shopifyProductId: sss.shopifyProductId,
      payload,
      apply: true,
    });
    return stats.zeroed;
  } catch (err) {
    console.warn("[stx-soldout-zero] hook failed", {
      kickdbProductId,
      err: err instanceof Error ? err.message : err,
    });
    return 0;
  }
}
