import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { scraperQuery } from "@/app/lib/scraperDb";
import { parseScraperShops } from "@/app/lib/scraperShops";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RunRow = {
  id: string;
  shop_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  products_listed: number;
  variants_upserted: number;
  with_gtin: number;
  errors: number;
  message: string | null;
};

export async function GET() {
  const shops = parseScraperShops();
  const prismaAny = prisma as any;

  if (shops.length === 0) {
    return NextResponse.json({
      ok: true,
      configured: false,
      message:
        "No websites configured. Set SCRAPER_SHOPS in .env, e.g. WEL|WellPlayed|https://www.wellplayed.ch",
      shops: [],
    });
  }

  // Last run per shop (best-effort; run tracking lives in the scraper schema).
  let lastRunByShop = new Map<string, RunRow>();
  try {
    const runs = await scraperQuery<RunRow>(
      `SELECT DISTINCT ON (shop_id)
         id, shop_id, started_at, finished_at, status,
         products_listed, variants_upserted, with_gtin, errors, message
       FROM scraper.scrape_runs
       ORDER BY shop_id, started_at DESC`
    );
    lastRunByShop = new Map(runs.map((r) => [r.shop_id, r]));
  } catch {
    /* scrape_runs may not exist yet — stats still work from the catalog */
  }

  // One indexed query for all shops: VariantMapping.supplierKey is indexed and
  // the join to SupplierVariant uses the unique supplierVariantId index. Avoids
  // the seq scan that `supplierVariantId LIKE 'key_%'` caused on ~280k rows.
  const statsByShop = new Map<string, { withGtin: number; inStock: number }>();
  try {
    const keys = shops.map((s) => s.key);
    const rows = await prismaAny.$queryRaw<
      Array<{ key: string; with_gtin: number; in_stock: number }>
    >`
      SELECT vm."supplierKey" AS key,
             COUNT(*)::int AS with_gtin,
             COUNT(*) FILTER (WHERE sv.stock > 0)::int AS in_stock
      FROM "VariantMapping" vm
      LEFT JOIN "SupplierVariant" sv ON sv."supplierVariantId" = vm."supplierVariantId"
      WHERE vm."supplierKey" = ANY(${keys})
      GROUP BY vm."supplierKey"`;
    for (const r of rows) {
      statsByShop.set(r.key, { withGtin: Number(r.with_gtin), inStock: Number(r.in_stock) });
    }
  } catch {
    /* stats stay at 0 if the query fails */
  }

  const shopsOut = await Promise.all(
    shops.map(async (shop) => {
      const stat = statsByShop.get(shop.key) || { withGtin: 0, inStock: 0 };
      const withGtin = stat.withGtin;
      const inStock = stat.inStock;
      const lastRun = lastRunByShop.get(shop.key) || null;
      return {
        key: shop.key,
        code: shop.code,
        name: shop.name,
        baseUrl: shop.baseUrl,
        currency: shop.currency,
        gated: shop.gated,
        withGtin,
        inStock,
        running: lastRun?.status === "running",
        lastRun: lastRun
          ? {
              status: lastRun.status,
              startedAt: lastRun.started_at,
              finishedAt: lastRun.finished_at,
              productsListed: lastRun.products_listed,
              variantsUpserted: lastRun.variants_upserted,
              withGtin: lastRun.with_gtin,
              errors: lastRun.errors,
              message: lastRun.message,
            }
          : null,
      };
    })
  );

  const totals = shopsOut.reduce(
    (acc, s) => {
      acc.withGtin += s.withGtin;
      acc.inStock += s.inStock;
      if (s.running) acc.running += 1;
      if (!s.gated) acc.inFeed += 1;
      return acc;
    },
    { shops: shopsOut.length, withGtin: 0, inStock: 0, running: 0, inFeed: 0 }
  );

  return NextResponse.json({
    ok: true,
    configured: true,
    totals,
    shops: shopsOut,
    generatedAt: new Date().toISOString(),
  });
}
