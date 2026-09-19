/**
 * Batch-1 observation adapters — HAW, BWZ, TUS, EXL, VEN, WRK.
 * Scrapers call record{Xxx}Observation per variant; scraperRunner drains via
 * drainSupplierObservations at run end. Observation-only; never writes stock.
 */

import { registerObservationAdapter } from "./observationAdapter";
import {
  beginSupplierObservationRun,
  pushSupplierObservation,
  drainSupplierObservations,
} from "./observationBuffer";
import type { SourceAvailability, SupplierVariantObservation } from "./types";
import { decideHawPublishedQty } from "./hawQty";
import { decideBwzPublishedQty } from "./bwzQty";
import { buildTusObservationId, decideTusPublishedQty } from "./tusQty";
import { decideExlPublishedQty } from "./exlQty";
import { decideVenPublishedQty } from "./venQty";
import { decideWrkPublishedQty } from "./wrkQty";

function availFromDecision(proposedQty: number, reason: string): SourceAvailability {
  if (proposedQty > 0) return "in_stock";
  if (/preorder/i.test(reason)) return "preorder";
  if (/page_missing|cloudflare|scrape_invalid|no_page_obs/i.test(reason)) return "unavailable";
  if (/gift.?card|gutschein/i.test(reason)) return "out_of_stock";
  return "out_of_stock";
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
  inStockSchema?: boolean;
};

export function beginHawObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("haw", scrapeRunId);
}
export function drainHawObservations(scrapeRunId: number) {
  return drainSupplierObservations("haw", scrapeRunId);
}
export function recordHawObservation(
  input: HawObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideHawPublishedQty({
    htmlOrText: input.htmlOrText,
    inStockSchema: input.inStockSchema,
    availability: input.availability,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "haw",
    supplierVariantId: `haw_${input.gtin}`,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    manufacturerRef: input.mpn ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "lagerbestand" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      stockLabel: d.stockLabel,
      qtyReason: d.reason,
    },
  };
  pushSupplierObservation(obs);
  return obs;
}

// ---- BWZ ----
export type BwzObservationInput = {
  productUrl: string;
  gtin: string;
  sku?: string | null;
  productName?: string | null;
  productType?: string | null;
  priceChf: number;
  nuxtQty: number | null;
  inStock: boolean;
};
export function beginBwzObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("bwz", scrapeRunId);
}
export function drainBwzObservations(scrapeRunId: number) {
  return drainSupplierObservations("bwz", scrapeRunId);
}
export function recordBwzObservation(
  input: BwzObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideBwzPublishedQty({
    nuxtQty: input.nuxtQty,
    inStock: input.inStock,
    name: input.productName,
    productType: input.productType,
    url: input.productUrl,
    sku: input.sku,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "bwz",
    supplierVariantId: `bwz_${input.gtin}`,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "nuxt_qty" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      excluded: d.excluded,
    },
  };
  pushSupplierObservation(obs);
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
  verfuegbarQty?: number | null;
  cartMax?: number | null;
  purchasable?: boolean;
  inStock?: boolean;
  htmlOrText?: string | null;
  isPreorder?: boolean;
  isGiftCard?: boolean;
};
export function beginTusObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("tus", scrapeRunId);
}
export function drainTusObservations(scrapeRunId: number) {
  return drainSupplierObservations("tus", scrapeRunId);
}
export function recordTusObservation(
  input: TusObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideTusPublishedQty({
    verfuegbarQty: input.verfuegbarQty,
    cartMax: input.cartMax,
    purchasable: input.purchasable,
    inStock: input.inStock,
    htmlOrText: input.htmlOrText,
    isPreorder: input.isPreorder,
    isGiftCard: input.isGiftCard,
  });
  const supplierVariantId = buildTusObservationId({
    parentWooId: input.parentWooId ?? null,
    variantWooId: input.wooId,
    gtin: input.gtin,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "tus",
    supplierVariantId,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "verfuegbar" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
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
  pushSupplierObservation(obs);
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
  scrapeValid?: boolean;
};
export function beginExlObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("exl", scrapeRunId);
}
export function drainExlObservations(scrapeRunId: number) {
  return drainSupplierObservations("exl", scrapeRunId);
}
export function recordExlObservation(
  input: ExlObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideExlPublishedQty({
    stockLabel: input.stockLabel,
    availabilityText: input.availabilityText,
    scrapeValid: input.scrapeValid,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "exl",
    supplierVariantId: `exl_${input.gtin}`,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? input.gtin,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "delivery_lead" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: null,
    quantityUnknown: d.quantityUnknown,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      stockLabel: input.stockLabel ?? null,
      availabilityText: input.availabilityText ?? null,
      scrapeValid: input.scrapeValid ?? true,
    },
  };
  pushSupplierObservation(obs);
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
  buyableSofort?: boolean;
  pageObservedThisRun?: boolean;
  stockSource?: string | null;
  rawQty?: number | null;
};
export function beginVenObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("ven", scrapeRunId);
}
export function drainVenObservations(scrapeRunId: number) {
  return drainSupplierObservations("ven", scrapeRunId);
}
export function recordVenObservation(
  input: VenObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideVenPublishedQty({
    buyableSofort: input.buyableSofort,
    pageObservedThisRun: input.pageObservedThisRun,
    stockSource: input.stockSource,
    rawQty: input.rawQty,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "ven",
    supplierVariantId: `ven_${input.gtin}`,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    manufacturerRef: input.mpn ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "sofort_verfuegbar" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
      stockSource: input.stockSource ?? null,
    },
  };
  pushSupplierObservation(obs);
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
  inventoryTracked?: boolean;
  isPreorder?: boolean;
  lateDelivery?: boolean;
  pagePresent?: boolean;
};
export function beginWrkObservationRun(scrapeRunId: number) {
  beginSupplierObservationRun("wrk", scrapeRunId);
}
export function drainWrkObservations(scrapeRunId: number) {
  return drainSupplierObservations("wrk", scrapeRunId);
}
export function recordWrkObservation(
  input: WrkObservationInput,
  ctx: { scrapeRunId: number; observedAt: Date }
): SupplierVariantObservation {
  const d = decideWrkPublishedQty({
    pagePresent: input.pagePresent ?? true,
    available: input.available,
    trackedQty: input.trackedQty,
    inventoryTracked: input.inventoryTracked,
    isPreorder: input.isPreorder,
    lateDelivery: input.lateDelivery,
  });
  const obs: SupplierVariantObservation = {
    supplierKey: "wrk",
    supplierVariantId: `wrk_${input.gtin}`,
    productUrl: input.productUrl,
    variantUrl: input.productUrl,
    gtin: input.gtin,
    supplierSku: input.sku ?? null,
    productName: input.productName ?? null,
    sourcePrice: input.priceChf,
    currency: "CHF",
    purchaseSignal: d.hasPositiveProof ? "shopify_tracked_qty" : d.reason,
    sourceAvailability: availFromDecision(d.proposedQty, d.reason),
    supplierStockQty: d.sourceQty,
    quantityUnknown: false,
    scrapeRunId: ctx.scrapeRunId,
    observedAt: ctx.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      sourceQty: d.sourceQty,
      proposedPublishQty: d.proposedQty,
      qtyReason: d.reason,
    },
  };
  pushSupplierObservation(obs);
  return obs;
}

// Register no-op adapters so hasLiveObservationAdapter returns true.
for (const key of ["haw", "bwz", "tus", "exl", "ven", "wrk"] as const) {
  registerObservationAdapter({
    supplierKey: key,
    toObservations() {
      return [];
    },
  });
}
