/**
 * POST /api/restock/from-url
 *
 * Create a physical product from a nike.com PDP when the GTIN is not on StockX/KickDB.
 *
 * Body:
 *  - { url }                                   → preview: parsed brand/name/sku/sizes(GTIN)/images
 *  - { url, sellPrice, stock: {"5C":1,...}, locationId?, dryRun? } → create on Shopify + `ner:` rows
 *
 * No Galaxus push is triggered: the next nightly feed (02h stock/price, 04h master/specs)
 * picks up the new `ner:` rows.
 */
import { NextResponse } from "next/server";
import { fetchNikeProduct, nikeToProductData } from "@/shopify/restock/parseNikeProduct";
import { createProductFromData, validateProductFromData } from "@/shopify/restock/createProductFromData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const url = typeof body?.url === "string" ? body.url.trim() : "";
    if (!url) return NextResponse.json({ ok: false, error: "Missing url" }, { status: 400 });

    const parsed = await fetchNikeProduct(url);

    const sellPrice = Number(body?.sellPrice);
    const stockRaw = body?.stock && typeof body.stock === "object" ? body.stock : null;
    if (!(sellPrice > 0) || !stockRaw) {
      // Preview mode: show what the page gives and what is still missing.
      const allSizes = nikeToProductData(parsed, {
        sellPrice: 1,
        stockByNikeLabel: Object.fromEntries(parsed.sizes.map((s) => [s.nikeLabel, 1])),
      });
      return NextResponse.json({
        ok: true,
        mode: "preview",
        parsed,
        missingFromPage: validateProductFromData(allSizes),
      });
    }

    const stockByNikeLabel: Record<string, number> = {};
    for (const [k, v] of Object.entries(stockRaw)) {
      const n = Math.trunc(Number(v));
      if (Number.isFinite(n) && n > 0) stockByNikeLabel[k] = n;
    }
    const data = nikeToProductData(parsed, { sellPrice, stockByNikeLabel });
    const result = await createProductFromData(data, {
      dryRun: body?.dryRun === true,
      locationId: typeof body?.locationId === "string" ? body.locationId : null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
