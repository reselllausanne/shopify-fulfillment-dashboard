import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";

const prisma = new PrismaClient();
const out = path.join(__dirname, "..", "data", "galaxus_gtin_index.csv");

function esc(v: unknown): string {
  const s = v == null ? "" : String(v);
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

async function main() {
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const lines = [
    "gtin,source,title,brand,sell_price_chf,units_sold,revenue_chf,last_sale,our_offer",
  ];

  const sales = await prisma.$queryRawUnsafe<any[]>(`
    SELECT gol."gtin" AS gtin,
           SUM(gol.quantity)::int AS units,
           SUM(COALESCE(gol."lineNetAmount", gol."priceLineAmount", 0))::float AS revenue,
           MAX(go."orderDate") AS last_sale,
           MAX(gol."productTitle") AS title
    FROM "GalaxusOrderLine" gol
    JOIN "GalaxusOrder" go ON go.id = gol."orderId"
    WHERE gol."gtin" IS NOT NULL AND gol."gtin" <> ''
    GROUP BY gol."gtin"
  `);

  const listingRows = await prisma.channelListingState.findMany({
    where: { channel: "GALAXUS", gtin: { not: null } },
    select: { gtin: true },
  });
  const listingSet = new Set(listingRows.map((r) => String(r.gtin)));

  const seen = new Set<string>();
  for (const r of sales) {
    const g = String(r.gtin);
    seen.add(g);
    lines.push(
      [
        esc(g),
        "order_history",
        esc(r.title || ""),
        "",
        "",
        esc(r.units),
        esc(r.revenue),
        esc(r.last_sale ? new Date(r.last_sale).toISOString() : ""),
        listingSet.has(g) ? "yes" : "no",
      ].join(",")
    );
  }

  // Distinct GTINs from SupplierVariant (identity for Galaxus association)
  const variants = await prisma.$queryRawUnsafe<any[]>(`
    SELECT DISTINCT ON (gtin)
      gtin,
      "supplierBrand" AS brand,
      "supplierProductName" AS title,
      price::float AS price
    FROM "SupplierVariant"
    WHERE gtin IS NOT NULL AND gtin <> ''
    ORDER BY gtin, "updatedAt" DESC
  `);

  let n = 0;
  for (const r of variants) {
    const g = String(r.gtin);
    if (seen.has(g)) continue;
    seen.add(g);
    lines.push(
      [
        esc(g),
        listingSet.has(g) ? "channel_listing" : "supplier_variant",
        esc(r.title || ""),
        esc(r.brand || ""),
        esc(r.price ?? ""),
        "0",
        "0",
        "",
        listingSet.has(g) ? "yes" : "no",
      ].join(",")
    );
    n += 1;
    if (n >= 500000) break;
  }

  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(
    JSON.stringify({
      salesGtins: sales.length,
      listingGtins: listingSet.size,
      totalIndex: seen.size,
      out,
    })
  );
}

main()
  .catch((e) => {
    console.error(String(e));
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
