import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { STX_SUPPLIER_VARIANT_WHERE } from "@/galaxus/supplier/supplierKeyGuards";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/restock/search?q=<text>
 * Product name/SKU/brand search against the STX supplier catalog.
 * Returns up to 10 distinct products (grouped by providerKey / StockX slug).
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const q = (url.searchParams.get("q") ?? "").trim();
    if (q.length < 2) {
      return NextResponse.json({ ok: true, results: [] });
    }

    const rows = await prisma.supplierVariant.findMany({
      where: {
        AND: [
          STX_SUPPLIER_VARIANT_WHERE,
          { providerKey: { not: null } },
          {
            OR: [
              { supplierProductName: { contains: q, mode: "insensitive" } },
              { supplierBrand: { contains: q, mode: "insensitive" } },
              { supplierSku: { contains: q, mode: "insensitive" } },
              { providerKey: { contains: q, mode: "insensitive" } },
            ],
          },
        ],
      },
      select: {
        providerKey: true,
        supplierProductName: true,
        supplierBrand: true,
        supplierSku: true,
      },
      orderBy: { updatedAt: "desc" },
      take: 150,
    });

    // Deduplicate by providerKey — take first (most recently updated) per slug
    const seen = new Set<string>();
    const results: Array<{
      slug: string;
      title: string;
      brand: string | null;
      sku: string | null;
    }> = [];
    for (const r of rows) {
      if (!r.providerKey || seen.has(r.providerKey)) continue;
      seen.add(r.providerKey);
      results.push({
        slug: r.providerKey,
        title: r.supplierProductName ?? r.providerKey,
        brand: r.supplierBrand ?? null,
        sku: r.supplierSku ?? null,
      });
      if (results.length >= 10) break;
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
