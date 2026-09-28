/**
 * FAN observation contract — build SupplierVariantObservation from page proof.
 * Never uses historical SupplierVariant.stock or default 5.
 */

import type { FantasyweltProduct } from "@/app/lib/fantasyweltClient";
import type { SourceAvailability, SupplierVariantObservation } from "./types";
import { registerObservationAdapter } from "./observationAdapter";

const buffers = new Map<number, SupplierVariantObservation[]>();

export function beginFanObservationRun(scrapeRunId: number): void {
  buffers.set(scrapeRunId, []);
}

export function pushFanObservation(obs: SupplierVariantObservation): void {
  const list = buffers.get(obs.scrapeRunId);
  if (list) list.push(obs);
  else buffers.set(obs.scrapeRunId, [obs]);
}

export function drainFanObservations(scrapeRunId: number): SupplierVariantObservation[] {
  const list = buffers.get(scrapeRunId) ?? [];
  buffers.delete(scrapeRunId);
  return list;
}

function mapAvailability(product: FantasyweltProduct): SourceAvailability {
  if (product.availability === "PreOrder") return "preorder";
  if (product.availability === "OutOfStock") return "out_of_stock";
  if (product.hasPositiveStockProof) return "in_stock";
  if (product.qtyReason === "cloudflare_no_proof") return "unavailable";
  return "unknown";
}

export function fantasyweltProductToObservation(
  product: FantasyweltProduct,
  input: { scrapeRunId: number; observedAt: Date; supplierKey?: string }
): SupplierVariantObservation | null {
  if (!product.gtin) return null;
  const supplierKey = String(input.supplierKey ?? "fan")
    .trim()
    .toLowerCase();
  const supplierVariantId = `${supplierKey}_${product.gtin}`;
  const sourceAvailability = mapAvailability(product);

  return {
    supplierKey,
    supplierVariantId,
    productUrl: product.productUrl,
    variantUrl: product.productUrl,
    gtin: product.gtin,
    supplierSku: product.sku,
    manufacturerRef: product.jtlArticleId,
    productName: product.name,
    sourcePrice: product.priceEur,
    currency: "EUR",
    purchaseSignal: product.hasPositiveStockProof
      ? "stk_auf_lager"
      : product.availability === "PreOrder"
        ? "vorbestellbar"
        : product.stockLabel,
    sourceAvailability,
    supplierStockQty: product.sourceStockQty,
    quantityUnknown: false,
    scrapeRunId: input.scrapeRunId,
    observedAt: input.observedAt,
    usedDefaultStock: false,
    rawParseJson: {
      stockLabel: product.stockLabel,
      sourceStockQty: product.sourceStockQty,
      proposedPublishQty: product.proposedPublishQty,
      qtyReason: product.qtyReason,
      isSale: product.isSale,
      hasPositiveStockProof: product.hasPositiveStockProof,
      availability: product.availability,
      sku: product.sku,
      brand: product.brand,
      stockDecision: product.stockDecision,
    },
  };
}

export function recordFanProductObservation(
  product: FantasyweltProduct,
  input: { scrapeRunId: number; observedAt: Date; supplierKey?: string }
): SupplierVariantObservation | null {
  const obs = fantasyweltProductToObservation(product, input);
  if (obs) pushFanObservation(obs);
  return obs;
}

registerObservationAdapter({
  supplierKey: "fan",
  toObservations(input) {
    const out: SupplierVariantObservation[] = [];
    for (const row of input.rows) {
      const product = row as FantasyweltProduct;
      if (!product?.productUrl || !product?.gtin) continue;
      const obs = fantasyweltProductToObservation(product, {
        scrapeRunId: input.scrapeRunId,
        observedAt: input.observedAt,
      });
      if (obs) out.push(obs);
    }
    return out;
  },
});
