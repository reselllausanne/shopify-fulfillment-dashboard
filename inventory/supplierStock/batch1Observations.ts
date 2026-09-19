/**
 * Batch-1 observation adapters — HAW, BWZ, TUS, EXL, VEN, WRK.
 * Wire scraper native rows → SupplierVariantObservation.
 * All go through the generic buffer so scraperRunner can drain per supplier.
 * FAN already has its own module (fanObservation.ts).
 */

import { registerObservationAdapter } from "./observationAdapter";
import { beginObservationRun, pushObservation, drainObservations } from "./supplierObservationBuffer";
import type { SourceAvailability, SupplierVariantObservation } from "./types";
import { decideHawPublishedQtyFromPage } from "./hawQty";
import { decideBwzPublishedQty, parseBwzStock } from "./bwzQty";
import { buildTusObservationId, decideTusPublishedQty, parseTusStock } from "./tusQty";
import { decideExlPublishedQty, parseExlAvailability } from "./exlQty";
import { decideVenPublishedQty, parseVenStock } from "./venQty";
import { decideWrkPublishedQty, parseWrkStock } from "./wrkQty";

// ---- helpers ----

function baseObs(
  supplierKey: string,
  variantId: string,
  runId: number,
  observedAt: Date
): Pick<SupplierVariantObservation, "supplierKey" | "supplierVariantId" | "scrapeRunId" | "observedAt"> {
  return {
    supplierKey,
    supplierVariantId: variantId,
    scrapeRunId: runId,
    observedAt,
  };
}

function availFromProof(hasPositive: boolean, reason: string): SourceAvailability {
  if (hasPositive) return "in_stock";
  if (/preorder/i.test(reason)) return "preorder";
  if (/page_missing|cloudflare|unavailable|liefertermin/i.test(reason)) return "unavailable";
  if (/gift.?card|gutschein/i.test(reason)) return "out_of_stock";
  if (/oos|zero_qty|not_purchasable|schema_(not_)?instock|not_available|not_sofort|external|not_lieferbar/i.test(reason))
    return "out_of_stock";
  return "unknown";
}

// ---- HAW ----

export type HawObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  mpn?: string | null;
  productName?: string | null;
  priceChf: number;
  htmlOrText: string;
  availability?: string | null;
};

export function beginHawObservationRun(scrapeRunId: number): void {
  beginObservationRun("haw", scrapeRunId);
}
export function drainHawObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("haw", scrapeRunId);
}
export function recordHawObservation(
  input: HawObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideHawPublishedQtyFromPage({
    htmlOrText: input.htmlOrText,
    availability: input.availability,
  });
  const obs: SupplierVariantObservation = {
    ...baseObs("haw", `haw_${input.gtin}`, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    manufacturerRef: input.mpn ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "lagerbestand" : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      stockLabel: d.stockLabel,
      qtyReason: d.reason,
    },
  };
  pushObservation("haw", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- BWZ ----

export type BwzObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  productName?: string | null;
  productType?: string | null;
  slug?: string | null;
  priceChf: number;
  quantity: number | null;
  isSoldOut?: boolean;
  isBuyable?: boolean;
};

export function beginBwzObservationRun(scrapeRunId: number): void {
  beginObservationRun("bwz", scrapeRunId);
}
export function drainBwzObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("bwz", scrapeRunId);
}
export function recordBwzObservation(
  input: BwzObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const parse = parseBwzStock({
    quantity: input.quantity,
    isSoldOut: input.isSoldOut,
    isBuyable: input.isBuyable,
    productName: input.productName,
    productType: input.productType,
    slug: input.slug,
  });
  const d = decideBwzPublishedQty(parse);
  const obs: SupplierVariantObservation = {
    ...baseObs("bwz", `bwz_${input.gtin}`, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "nuxt_variant_qty" : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      isSoldOut: parse.isSoldOut,
      isGiftCard: parse.isGiftCard,
    },
  };
  pushObservation("bwz", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- TUS ----

export type TusObservationInput = {
  productUrl: string;
  gtin: string;
  wooId: number;
  parentWooId?: number | null;
  sku?: string | null;
  productName?: string | null;
  variationLabel?: string | null;
  priceChf: number;
  stockText?: string | null;
  cartMax?: number | null;
  isPurchasable?: boolean;
  isInStock?: boolean;
  isPreorder?: boolean;
  isGiftCard?: boolean;
};

export function beginTusObservationRun(scrapeRunId: number): void {
  beginObservationRun("tus", scrapeRunId);
}
export function drainTusObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("tus", scrapeRunId);
}
export function recordTusObservation(
  input: TusObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const parse = parseTusStock({
    stockText: input.stockText,
    cartMax: input.cartMax,
    isPurchasable: input.isPurchasable,
    isInStock: input.isInStock,
    isPreorder: input.isPreorder,
    isGiftCard: input.isGiftCard,
  });
  const d = decideTusPublishedQty(parse);
  const variantId = buildTusObservationId({
    parentWooId: input.parentWooId ?? null,
    variantWooId: input.wooId,
    gtin: input.gtin,
  });
  const obs: SupplierVariantObservation = {
    ...baseObs("tus", variantId, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "verfuegbar" : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      wooId: input.wooId,
      parentWooId: input.parentWooId ?? null,
      variationLabel: input.variationLabel ?? null,
    },
  };
  pushObservation("tus", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- EXL ----

export type ExlObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  productName?: string | null;
  priceChf: number;
  stockLabel?: string | null;
  availabilityText?: string | null;
};

export function beginExlObservationRun(scrapeRunId: number): void {
  beginObservationRun("exl", scrapeRunId);
}
export function drainExlObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("exl", scrapeRunId);
}
export function recordExlObservation(
  input: ExlObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideExlPublishedQty(
    parseExlAvailability({
      stockLabel: input.stockLabel,
      availabilityText: input.availabilityText,
    })
  );
  const obs: SupplierVariantObservation = {
    ...baseObs("exl", `exl_${input.gtin}`, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? input.gtin,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "delivery_lead" : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: null,
    quantityUnknown: d.quantityUnknown,
    usedDefaultStock: false,
    rawParseJson: {
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      availability: d.availability,
      stockLabel: input.stockLabel ?? null,
      availabilityText: input.availabilityText ?? null,
    },
  };
  pushObservation("exl", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- VEN ----

export type VenObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  mpn?: string | null;
  productName?: string | null;
  priceChf: number;
  schemaInStock?: boolean;
  sofortVerfuegbar?: boolean;
  stockQuantityNumber?: number | null;
  liefertermUnbekannt?: boolean;
};

export function beginVenObservationRun(scrapeRunId: number): void {
  beginObservationRun("ven", scrapeRunId);
}
export function drainVenObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("ven", scrapeRunId);
}
export function recordVenObservation(
  input: VenObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const parse = parseVenStock({
    schemaInStock: input.schemaInStock,
    sofortVerfuegbar: input.sofortVerfuegbar,
    stockQuantityNumber: input.stockQuantityNumber,
    liefertermUnbekannt: input.liefertermUnbekannt,
  });
  const d = decideVenPublishedQty(parse);
  const obs: SupplierVariantObservation = {
    ...baseObs("ven", `ven_${input.gtin}`, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    manufacturerRef: input.mpn ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "sofort_verfuegbar" : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
    },
  };
  pushObservation("ven", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- WRK ----

export type WrkObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  productName?: string | null;
  priceChf: number;
  available?: boolean;
  trackedQty?: number | null;
  inventoryManagement?: string | null;
  isPreorder?: boolean;
  lateDelivery?: boolean;
  pageMissing?: boolean;
};

export function beginWrkObservationRun(scrapeRunId: number): void {
  beginObservationRun("wrk", scrapeRunId);
}
export function drainWrkObservations(scrapeRunId: number): SupplierVariantObservation[] {
  return drainObservations("wrk", scrapeRunId);
}
export function recordWrkObservation(
  input: WrkObservationInput,
  runCtx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const parse = parseWrkStock({
    available: input.available,
    trackedQty: input.trackedQty,
    inventoryManagement: input.inventoryManagement,
    isPreorder: input.isPreorder,
    lateDelivery: input.lateDelivery,
    pageMissing: input.pageMissing,
  });
  const d = decideWrkPublishedQty(parse);
  const obs: SupplierVariantObservation = {
    ...baseObs("wrk", `wrk_${input.gtin}`, runCtx.scrapeRunId, runCtx.observedAt),
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof
      ? d.quantityUnknown
        ? "untracked_available"
        : "shopify_tracked_qty"
      : d.reason,
    sourceAvailability: availFromProof(d.hasPositiveProof, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: d.quantityUnknown,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      tracked: parse.tracked,
    },
  };
  pushObservation("wrk", runCtx.scrapeRunId, obs);
  return obs;
}

// ---- Register no-op adapters (drain-only path). Adapters exist so
// hasLiveObservationAdapter(key) returns true; scrapers push directly.
for (const key of ["haw", "bwz", "tus", "exl", "ven", "wrk"] as const) {
  registerObservationAdapter({
    supplierKey: key,
    toObservations() {
      // Not used — batch1 scrapers push via recordXxxObservation.
      return [];
    },
  });
}
