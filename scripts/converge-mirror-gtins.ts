/**
 * Converge GTINs already in mirror for given location(s) — skip Shopify pagination.
 * Usage: npx tsx scripts/converge-mirror-gtins.ts lab|coldbien|both
 */
import { prisma } from "../app/lib/prisma";
import { LOCATIONS } from "../shopify/inventory/locationConfig";
import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";

function locIds(arg: string | undefined): string[] {
  const lab = LOCATIONS.find((l) => /lab/i.test(l.name))!.id;
  const bien = LOCATIONS.find((l) => /cold\s*bien/i.test(l.name))!.id;
  const which = String(arg ?? "both").toLowerCase();
  if (which === "lab") return [lab];
  if (which === "coldbien" || which === "bien") return [bien];
  return [lab, bien];
}

async function main() {
  const ids = locIds(process.argv[2]);
  const rows = await prisma.$queryRaw<Array<{ gtin: string; locationName: string }>>`
    SELECT DISTINCT s."gtin", s."locationName"
    FROM "public"."ShopifyVariantLocationStock" s
    WHERE s."locationId" = ANY(${ids}::text[])
      AND s."gtin" IS NOT NULL AND s."gtin" <> ''
      AND s."available" > 0
    ORDER BY s."locationName", s."gtin"`;
  const gtins = [...new Set(rows.map((r) => r.gtin))];
  console.log(`Converging ${gtins.length} GTINs from mirror (${rows[0]?.locationName ?? ""} + ...)`);

  let ok = 0;
  let changed = 0;
  let errors = 0;
  for (const [i, gtin] of gtins.entries()) {
    try {
      await new Promise((r) => setTimeout(r, 500));
      const { match } = await findShopifyVariantByGtin(gtin);
      if (match) {
        await applyLiquidationSaleDisplay({
          gtin,
          variant: match,
          slug: match.productHandle,
          sizeEu: match.variantTitle,
        });
      }
      const res = await convergeVariant(gtin, { postPhysicalRestock: true });
      ok += 1;
      if (res.changed) changed += 1;
      if (res.changed || res.error || res.warnings.some((w) => !/Throttled/.test(w))) {
        console.log(`[${i + 1}/${gtins.length}] ${gtin} ${res.desired} changed=${res.changed}`, res.error ?? "");
      }
    } catch (err: any) {
      errors += 1;
      console.error(`[${i + 1}/${gtins.length}] ${gtin} FAIL`, err?.message ?? err);
    }
  }
  console.log({ ok, changed, errors, total: gtins.length });
}

main().finally(() => prisma.$disconnect());
