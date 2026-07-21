import { NextResponse } from "next/server";
import {
  applyScanRestock,
  lookupScan,
} from "@/shopify/restock/scanRestockOrchestrator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/restock/scan?gtin=... — read-only lookup (cascade Shopify -> KickDB). */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const gtin = url.searchParams.get("gtin") ?? "";
    if (!gtin.trim()) {
      return NextResponse.json({ ok: false, error: "Missing gtin" }, { status: 400 });
    }
    const result = await lookupScan(gtin);
    return NextResponse.json({ ok: true, result });
  } catch (error: any) {
    console.error("[RESTOCK][SCAN][GET]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Scan lookup failed" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/restock/scan — apply restock.
 * Body: { gtin, quantity?, identifier?, confirmVariantId?, salePrice?, dryRun? }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const gtin = typeof body?.gtin === "string" ? body.gtin : "";
    if (!gtin.trim()) {
      return NextResponse.json({ ok: false, error: "Missing gtin" }, { status: 400 });
    }
    const quantityRaw = Number(body?.quantity ?? 1);
    const quantity = Number.isFinite(quantityRaw) && quantityRaw > 0 ? Math.trunc(quantityRaw) : 1;
    const salePriceRaw = body?.salePrice != null ? Number(body.salePrice) : null;

    const result = await applyScanRestock({
      gtin,
      quantity,
      identifier: typeof body?.identifier === "string" && body.identifier.trim() ? body.identifier.trim() : null,
      confirmVariantId:
        typeof body?.confirmVariantId === "string" && body.confirmVariantId.trim()
          ? body.confirmVariantId.trim()
          : null,
      salePrice: salePriceRaw != null && Number.isFinite(salePriceRaw) ? salePriceRaw : null,
      dryRun: body?.dryRun === true,
      locationId: typeof body?.locationId === "string" && body.locationId.trim() ? body.locationId.trim() : null,
    });

    return NextResponse.json(result, { status: result.ok || result.status === "size-confirmation-required" ? 200 : 400 });
  } catch (error: any) {
    console.error("[RESTOCK][SCAN][POST]", error);
    return NextResponse.json(
      {
        ok: false,
        status: "error",
        error: error?.message ?? "Scan restock failed",
        warnings: [],
      },
      { status: 500 }
    );
  }
}
