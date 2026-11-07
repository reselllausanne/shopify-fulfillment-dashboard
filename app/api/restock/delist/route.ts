/**
 * POST /api/restock/delist
 *
 * "Vendre" mode — scan a GTIN to record a physical sale:
 *   1. Find variant on Shopify by GTIN
 *   2. Decrement inventory by `quantity` (default 1) at the given location
 *   3. Run convergeVariant with forceDropship=true to unlock liquidation pricing
 *      and recalculate the normal sell price (clears price_locked, compareAtPrice, manualLock)
 *
 * Body: { gtin: string, locationId: string, quantity?: number }
 * Returns: { ok, variantId, newPrice, title, warnings }
 */

import { NextResponse } from "next/server";
import {
  findShopifyVariantByGtin,
  adjustInventoryAtLocation,
  getShopifyVariantDetail,
} from "@/shopify/restock/shopifyRestockInventory";
import { convergeVariant } from "@/shopify/inventory/convergence";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));

    const rawGtin = typeof body?.gtin === "string" ? body.gtin : "";
    const gtin = cleanGtin(rawGtin);
    if (!gtin) {
      return NextResponse.json({ ok: false, error: "Missing gtin" }, { status: 400 });
    }

    const locationId =
      typeof body?.locationId === "string" && body.locationId.trim()
        ? body.locationId.trim()
        : null;
    if (!locationId) {
      return NextResponse.json({ ok: false, error: "Missing locationId" }, { status: 400 });
    }

    const quantityRaw = Number(body?.quantity ?? 1);
    const quantity =
      Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.trunc(quantityRaw) : 1;

    const warnings: string[] = [];

    // 1. Find variant
    const { match, ambiguous } = await findShopifyVariantByGtin(gtin);
    if (!match) {
      return NextResponse.json(
        { ok: false, error: `GTIN ${gtin} not found on Shopify` },
        { status: 404 }
      );
    }
    if (ambiguous) {
      warnings.push("Ambiguous GTIN — used first Shopify match");
    }
    if (!match.inventoryItemId) {
      return NextResponse.json(
        { ok: false, error: "Variant has no inventory item" },
        { status: 422 }
      );
    }

    // 2. Decrement inventory (delta = -quantity)
    try {
      await adjustInventoryAtLocation({
        inventoryItemId: match.inventoryItemId,
        locationId,
        delta: -quantity,
        reason: "shrinkage",
        referenceDocumentUri: `gid://resell-lausanne/DelistScan/${Date.now()}`,
      });
    } catch (err: any) {
      return NextResponse.json(
        { ok: false, error: `Inventory adjust failed: ${err?.message ?? err}` },
        { status: 500 }
      );
    }

    // 3. Trigger convergence with forceDropship to unlock liquidation lock and
    //    recalculate normal STX price regardless of remaining stock.
    let newPrice: number | null = null;
    try {
      const conv = await convergeVariant(gtin, { forceDropship: true });
      if (conv.changed) {
        warnings.push(`Convergence: ${conv.changes.join("; ")}`);
      } else if (conv.warnings.length) {
        warnings.push(...conv.warnings.map((w) => `Convergence: ${w}`));
      }
    } catch (err: any) {
      warnings.push(`Convergence failed (non-fatal): ${err?.message ?? err}`);
    }

    // 4. Read fresh price after convergence
    try {
      const refreshed = await getShopifyVariantDetail(match.variantId);
      newPrice = refreshed?.price ?? null;
    } catch {
      // non-fatal
    }

    return NextResponse.json({
      ok: true,
      variantId: match.variantId,
      title: match.productTitle,
      sku: match.sku,
      newPrice,
      warnings,
    });
  } catch (error: any) {
    console.error("[RESTOCK][DELIST]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Delist failed" },
      { status: 500 }
    );
  }
}
