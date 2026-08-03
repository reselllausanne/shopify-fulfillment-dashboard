import { prisma } from "@/app/lib/prisma";
import { decathlonListPriceFromTargetPayout } from "@/decathlon/exports/physicalLiquidationPricing";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { loadAllPhysicalMirrorStockByGtin } from "@/shopify/inventory/physicalAvailability";

const ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;
/** Physical liquidation ships ~48h — same leadtime band as THE warehouse. */
const PHYSICAL_LEADTIME_TO_SHIP = "2";
const OFFER_STATE = "11";

export type PhysicalLiquidationOfferRow = {
  providerKey: string;
  offerSku: string;
  gtin: string;
  supplierVariantId: string | null;
  stock: number;
  payoutSellChf: number;
  listPrice: string;
  priceSource: "manual_lock" | "shopify_listing";
  leadtimeToShip: string;
  state: string;
};

export type PhysicalLiquidationOfferBuildResult = {
  rows: PhysicalLiquidationOfferRow[];
  summary: {
    physicalGtins: number;
    built: number;
    skippedNoMapping: number;
    skippedNoPrice: number;
    skippedBadPrice: number;
  };
  skipped: Array<{ gtin: string; reason: string }>;
};

function toFinitePositive(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n;
}

type PriceHit = { payoutSellChf: number; source: "manual_lock" | "shopify_listing"; supplierVariantId: string | null };

async function resolvePayoutSellByGtin(gtins: string[]): Promise<Map<string, PriceHit>> {
  const out = new Map<string, PriceHit>();
  if (gtins.length === 0) return out;

  const variants = await prisma.supplierVariant.findMany({
    where: { gtin: { in: gtins } },
    select: {
      supplierVariantId: true,
      gtin: true,
      manualLock: true,
      manualPrice: true,
    },
  });

  // Prefer stx_ locked liquidation sell; else any locked row for the GTIN.
  const byGtin = new Map<string, typeof variants>();
  for (const v of variants) {
    const gtin = String(v.gtin ?? "").trim();
    if (!gtin) continue;
    const list = byGtin.get(gtin) ?? [];
    list.push(v);
    byGtin.set(gtin, list);
  }

  for (const gtin of gtins) {
    const list = byGtin.get(gtin) ?? [];
    const stxLocked = list.find(
      (v) =>
        String(v.supplierVariantId).startsWith("stx_") &&
        v.manualLock &&
        toFinitePositive(v.manualPrice) != null
    );
    const anyLocked = list.find((v) => v.manualLock && toFinitePositive(v.manualPrice) != null);
    const hit = stxLocked ?? anyLocked;
    if (hit) {
      const payout = toFinitePositive(hit.manualPrice)!;
      out.set(gtin, {
        payoutSellChf: payout,
        source: "manual_lock",
        supplierVariantId: hit.supplierVariantId,
      });
    }
  }

  const missing = gtins.filter((g) => !out.has(g));
  if (missing.length === 0) return out;

  const listings = await prisma.channelListingState.findMany({
    where: {
      channel: "SHOPIFY",
      gtin: { in: missing },
      lastPushedPrice: { not: null },
    },
    select: {
      gtin: true,
      lastPushedPrice: true,
      supplierVariantId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  for (const row of listings) {
    const gtin = String(row.gtin ?? "").trim();
    if (!gtin || out.has(gtin)) continue;
    const payout = toFinitePositive(row.lastPushedPrice);
    if (payout == null) continue;
    out.set(gtin, {
      payoutSellChf: payout,
      source: "shopify_listing",
      supplierVariantId: row.supplierVariantId ?? null,
    });
  }

  return out;
}

async function resolveOfferIdentityByGtin(
  gtins: string[],
  preferredSupplierVariantId: Map<string, string | null>
): Promise<
  Map<
    string,
    {
      providerKey: string;
      supplierVariantId: string | null;
    }
  >
> {
  const out = new Map<string, { providerKey: string; supplierVariantId: string | null }>();
  if (gtins.length === 0) return out;

  const mappings = await prisma.variantMapping.findMany({
    where: {
      gtin: { in: gtins },
      status: { in: [...ELIGIBLE_MAPPING_STATUSES] },
      providerKey: { not: null },
    },
    select: {
      gtin: true,
      providerKey: true,
      supplierVariantId: true,
      updatedAt: true,
    },
    orderBy: { updatedAt: "desc" },
  });

  const byGtin = new Map<string, typeof mappings>();
  for (const m of mappings) {
    const gtin = String(m.gtin ?? "").trim();
    if (!gtin) continue;
    const list = byGtin.get(gtin) ?? [];
    list.push(m);
    byGtin.set(gtin, list);
  }

  for (const gtin of gtins) {
    const list = byGtin.get(gtin) ?? [];
    if (list.length === 0) continue;
    const preferred = preferredSupplierVariantId.get(gtin);
    const preferredHit =
      preferred != null
        ? list.find((m) => String(m.supplierVariantId ?? "") === preferred)
        : null;
    const stxHit = list.find((m) => String(m.supplierVariantId ?? "").startsWith("stx_"));
    const hit = preferredHit ?? stxHit ?? list[0];
    const supplierVariantId = String(hit.supplierVariantId ?? "").trim() || null;
    const built = buildProviderKey(gtin, supplierVariantId);
    const providerKey = built || String(hit.providerKey ?? "").trim();
    if (!providerKey) continue;
    out.set(gtin, { providerKey, supplierVariantId });
  }

  return out;
}

/**
 * Build full OF01 rows for every GTIN with physical location stock > 0.
 * Price: liquidation/website sell (target payout) grossed up for Decathlon fees.
 */
export async function buildPhysicalLiquidationOfferRows(params?: {
  limit?: number;
}): Promise<PhysicalLiquidationOfferBuildResult> {
  const physical = await loadAllPhysicalMirrorStockByGtin();
  let gtins = [...physical.keys()].sort();
  if (params?.limit && Number.isFinite(params.limit) && params.limit > 0) {
    gtins = gtins.slice(0, Math.floor(params.limit));
  }

  const prices = await resolvePayoutSellByGtin(gtins);
  const preferredSv = new Map<string, string | null>();
  for (const [gtin, price] of prices) {
    preferredSv.set(gtin, price.supplierVariantId);
  }
  const identities = await resolveOfferIdentityByGtin(gtins, preferredSv);

  const rows: PhysicalLiquidationOfferRow[] = [];
  const skipped: Array<{ gtin: string; reason: string }> = [];
  let skippedNoMapping = 0;
  let skippedNoPrice = 0;
  let skippedBadPrice = 0;

  for (const gtin of gtins) {
    const qty = Math.max(0, Math.floor(physical.get(gtin)?.qty ?? 0));
    if (qty <= 0) continue;

    const identity = identities.get(gtin);
    if (!identity) {
      skippedNoMapping += 1;
      skipped.push({ gtin, reason: "NO_MAPPING" });
      continue;
    }

    const priceHit = prices.get(gtin);
    if (!priceHit) {
      skippedNoPrice += 1;
      skipped.push({ gtin, reason: "NO_SELL_PRICE" });
      continue;
    }

    const list = decathlonListPriceFromTargetPayout(priceHit.payoutSellChf);
    if (list == null || list <= 0) {
      skippedBadPrice += 1;
      skipped.push({ gtin, reason: "BAD_LIST_PRICE" });
      continue;
    }

    rows.push({
      providerKey: identity.providerKey,
      offerSku: identity.providerKey,
      gtin,
      supplierVariantId: identity.supplierVariantId,
      stock: qty,
      payoutSellChf: priceHit.payoutSellChf,
      listPrice: list.toFixed(2),
      priceSource: priceHit.source,
      leadtimeToShip: PHYSICAL_LEADTIME_TO_SHIP,
      state: OFFER_STATE,
    });
  }

  return {
    rows,
    summary: {
      physicalGtins: gtins.length,
      built: rows.length,
      skippedNoMapping,
      skippedNoPrice,
      skippedBadPrice,
    },
    skipped,
  };
}
