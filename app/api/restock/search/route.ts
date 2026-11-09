import { NextResponse } from "next/server";
import { searchStockxProducts, kickdbVariantMatchesGtin } from "@/galaxus/kickdb/client";
import { extractBrand, extractImageUrl, pickString } from "@/galaxus/kickdb/extract";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/restock/search?q=<text>[&gtin=<gtin>]
 *
 * Live product search against KickDB / StockX API.
 * If `gtin` is provided, variants are fetched and results with a matching
 * barcode are flagged (and sorted first).
 *
 * Returns up to 10 results:
 *   { slug, title, brand, sku, image, gtinMatch }
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    const gtin = (url.searchParams.get("gtin") ?? "").trim();

    if (q.length < 2) {
      return NextResponse.json({ ok: true, results: [] });
    }

    const includeVariants = Boolean(gtin);
    const response = await searchStockxProducts(q, { includeVariants });
    const products: any[] = response?.data ?? [];

    const results = products.slice(0, 10).map((product: any) => {
      const variants: any[] = Array.isArray(product.variants) ? product.variants : [];
      const gtinMatch = gtin
        ? variants.some((v: any) => kickdbVariantMatchesGtin(v, gtin))
        : false;

      return {
        slug: pickString(product.slug, product.urlKey, product.id) ?? "",
        title: pickString(product.title, product.name) ?? product.id ?? "Unknown",
        brand: extractBrand(product),
        sku: pickString(product.sku, product.style_id, product.styleId),
        image: extractImageUrl(product),
        gtinMatch,
      };
    });

    // GTIN-matched products surface first
    if (gtin) {
      results.sort((a, b) => Number(b.gtinMatch) - Number(a.gtinMatch));
    }

    return NextResponse.json({ ok: true, results });
  } catch (err: any) {
    console.error("[RESTOCK][SEARCH]", err);
    return NextResponse.json(
      { ok: false, error: err?.message ?? "Search failed" },
      { status: 500 }
    );
  }
}
