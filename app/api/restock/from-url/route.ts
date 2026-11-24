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
import { findBrandPageByGtin, serpApiSearch } from "@/shopify/restock/findBrandPageByGtin";
import { cleanGtin } from "@/shopify/restock/gtinNormalize";
import { fetchNikeProduct, nikeToProductData } from "@/shopify/restock/parseNikeProduct";
import { createProductFromData, validateProductFromData } from "@/shopify/restock/createProductFromData";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    let url = typeof body?.url === "string" ? body.url.trim() : "";
    let found: Awaited<ReturnType<typeof findBrandPageByGtin>> | null = null;
    // Auto: no URL but a GTIN → Google (SerpAPI) → official brand page.
    if (!url && typeof body?.gtin === "string" && body.gtin.trim()) {
      const key = process.env.SERPAPI_KEY?.trim();
      if (!key) return NextResponse.json({ ok: false, error: "SERPAPI_KEY missing" }, { status: 500 });
      found = await findBrandPageByGtin(cleanGtin(body.gtin), serpApiSearch(key));
      if (!found.ok || !found.url) {
        return NextResponse.json({ ok: false, error: found.error ?? "page_not_found", found }, { status: 404 });
      }
      url = found.url;
    }
    if (!url) return NextResponse.json({ ok: false, error: "Missing url or gtin" }, { status: 400 });
    if (!/(^|\.)nike\.com$/i.test(new URL(url).hostname)) {
      return NextResponse.json(
        { ok: false, error: "brand_parser_missing", url, found },
        { status: 422 }
      );
    }

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
        url,
        found,
        parsed,
        missingFromPage: validateProductFromData(allSizes),
      });
    }

    const stockByNikeLabel: Record<string, number> = {};
    for (const [k, v] of Object.entries(stockRaw)) {
      const n = Math.trunc(Number(v));
      if (Number.isFinite(n) && n > 0) stockByNikeLabel[k] = n;
    }
    const compareAt = Number(body?.compareAt);
    const data = {
      ...nikeToProductData(parsed, { sellPrice, stockByNikeLabel }),
      compareAt: Number.isFinite(compareAt) && compareAt > sellPrice ? compareAt : null,
    };
    const result = await createProductFromData(data, {
      dryRun: body?.dryRun === true,
      locationId: typeof body?.locationId === "string" ? body.locationId : null,
    });
    return NextResponse.json(result, { status: result.ok ? 200 : 422 });
  } catch (err: any) {
    return NextResponse.json({ ok: false, error: err?.message ?? String(err) }, { status: 500 });
  }
}
