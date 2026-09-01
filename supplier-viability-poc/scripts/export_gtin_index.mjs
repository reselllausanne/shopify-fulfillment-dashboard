import { PrismaClient } from "@prisma/client";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(__dirname, "..", "data", "galaxus_gtin_index.csv");
const prisma = new PrismaClient();

function esc(v) {
  const s = v == null ? "" : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

async function main() {
  const lines = ["gtin,source,title,brand,sell_price_chf,units_sold,revenue_chf,last_sale,our_offer"];
  const seen = new Set();

  let sales = [];
  try {
    sales = await prisma.$queryRawUnsafe(`
      SELECT gol.gtin AS gtin,
             SUM(gol.quantity)::int AS units,
             SUM(COALESCE(gol."lineNetAmount", gol."priceLineAmount", 0))::float AS revenue,
             MAX(go."orderDate") AS last_sale,
             MAX(gol."productName") AS title
      FROM "GalaxusOrderLine" gol
      JOIN "GalaxusOrder" go ON go.id = gol."orderId"
      WHERE gol.gtin IS NOT NULL AND gol.gtin <> ''
      GROUP BY gol.gtin
    `);
  } catch (e) {
    console.error("sales_query_failed", String(e).slice(0, 200));
  }

  const listingSet = new Set();
  try {
    const listings = await prisma.channelListingState.findMany({
      where: { channel: "GALAXUS", gtin: { not: null } },
      select: { gtin: true },
    });
    for (const l of listings) if (l.gtin) listingSet.add(String(l.gtin));
  } catch (e) {
    console.error("listing_query_failed", String(e).slice(0, 200));
  }

  for (const r of sales) {
    const g = String(r.gtin);
    seen.add(g);
    lines.push([
      esc(g), "order_history", esc(r.title || ""), "", "",
      esc(r.units), esc(r.revenue),
      esc(r.last_sale ? new Date(r.last_sale).toISOString() : ""),
      listingSet.has(g) ? "yes" : "no",
    ].join(","));
  }

  let variants = [];
  try {
    variants = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT ON (gtin)
        gtin,
        "supplierBrand" AS brand,
        "supplierProductName" AS title,
        price::float AS price
      FROM "SupplierVariant"
      WHERE gtin IS NOT NULL AND gtin <> ''
      ORDER BY gtin, "updatedAt" DESC
      LIMIT 500000
    `);
  } catch (e) {
    console.error("variant_query_failed", String(e).slice(0, 200));
  }

  for (const r of variants) {
    const g = String(r.gtin);
    if (seen.has(g)) continue;
    seen.add(g);
    lines.push([
      esc(g),
      listingSet.has(g) ? "channel_listing" : "supplier_variant",
      esc(r.title || ""),
      esc(r.brand || ""),
      esc(r.price ?? ""),
      "0", "0", "",
      listingSet.has(g) ? "yes" : "no",
    ].join(","));
  }

  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, lines.join("\n") + "\n");
  console.log(JSON.stringify({ sales: sales.length, listings: listingSet.size, total: seen.size, out }));
}

main().catch((e) => { console.error(String(e)); process.exit(1); }).finally(() => prisma.$disconnect());
