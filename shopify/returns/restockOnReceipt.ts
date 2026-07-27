import { findVariantBySku } from "@/shopify/catalog/graphql";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";
import { getShopifyVariantDetail } from "@/shopify/restock/shopifyRestockInventory";
import { applyScanRestock } from "@/shopify/restock/scanRestockOrchestrator";

/** Customer returns always land in Warehouse Bussigny (priority 1 physical). */
const BUSSIGNY_LOCATION_ID =
  LOCATIONS.find((l) => l.sourceType === "physical" && /bussigny/i.test(l.name))?.id ??
  LOCATIONS.find((l) => l.sourceType === "physical")?.id ??
  null;

/**
 * Phase 4 — restock a received Shopify customer return.
 *
 * A Shopify customer return is, by definition, a product that already exists on
 * Shopify (it was sold there). So we do NOT recreate it. For each returned line:
 *   1. SKU -> Shopify variant -> barcode (GTIN)
 *   2. applyScanRestock({ gtin, identifier: sku }): bumps Bussigny stock on the
 *      existing variant + upserts the THE_ DB row for Galaxus/Decathlon export.
 *
 * Non-fatal: failures are collected and returned, never thrown (the store-credit
 * receipt must still succeed even if restock has a hiccup).
 */

type ReturnLineLike = {
  sku?: string | null;
  quantity?: number | null;
  title?: string | null;
};

export type ReceiptRestockLineResult = {
  sku: string | null;
  quantity: number;
  status: "restocked" | "no-sku" | "variant-not-found" | "no-barcode" | "error";
  gtin?: string | null;
  detail?: string;
};

export type ReceiptRestockResult = {
  ok: boolean;
  lines: ReceiptRestockLineResult[];
};

function extractLineItems(rawJson: unknown): ReturnLineLike[] {
  const raw = (rawJson ?? {}) as Record<string, unknown>;
  const lines = raw.lineItems;
  return Array.isArray(lines) ? (lines as ReturnLineLike[]) : [];
}

export async function restockShopifyReturnOnReceipt(input: {
  rawJson: unknown;
  dryRun?: boolean;
}): Promise<ReceiptRestockResult> {
  const lineItems = extractLineItems(input.rawJson);
  const results: ReceiptRestockLineResult[] = [];

  for (const line of lineItems) {
    const sku = String(line?.sku ?? "").trim() || null;
    const quantity = Math.max(1, Math.trunc(Number(line?.quantity ?? 1) || 1));

    if (!sku) {
      results.push({ sku: null, quantity, status: "no-sku" });
      continue;
    }

    try {
      const variant = await findVariantBySku(sku);
      if (!variant) {
        results.push({ sku, quantity, status: "variant-not-found" });
        continue;
      }
      const detail = await getShopifyVariantDetail(variant.variantId);
      const gtin = String(detail?.barcode ?? "").replace(/\D/g, "").trim() || null;
      if (!gtin) {
        results.push({ sku, quantity, status: "no-barcode" });
        continue;
      }

      // Product handle resolves to the KickDB slug for our auto-created products,
      // giving a reliable identifier for the THE_ DB export import (the size-
      // suffixed variant SKU does not resolve on KickDB).
      const identifier = detail?.productHandle?.trim() || sku;
      if (!BUSSIGNY_LOCATION_ID) {
        results.push({
          sku,
          quantity,
          gtin,
          status: "error",
          detail: "Bussigny locationId missing from locationConfig",
        });
        continue;
      }
      const applied = await applyScanRestock({
        gtin,
        quantity,
        identifier,
        locationId: BUSSIGNY_LOCATION_ID,
        dryRun: input.dryRun ?? false,
      });
      // Surface warnings even on success: "No StockX pricing" / "no stx row"
      // must be visible in the staff audit trail, not swallowed.
      const warningDetail = applied.warnings.filter(Boolean).join("; ");
      results.push({
        sku,
        quantity,
        gtin,
        status: applied.ok ? "restocked" : "error",
        detail: applied.ok
          ? warningDetail || undefined
          : applied.error ?? warningDetail,
      });
    } catch (error: any) {
      results.push({
        sku,
        quantity,
        status: "error",
        detail: error?.message ?? String(error),
      });
    }
  }

  const ok = results.every((r) => r.status === "restocked" || r.status === "no-sku");
  return { ok, lines: results };
}
