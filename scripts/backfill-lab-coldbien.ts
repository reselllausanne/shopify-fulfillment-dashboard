/**
 * One-shot backfill for THE LAB CONCEPT STORE + COLD BIEN.
 *
 * Fast path: page location inventoryLevels (delayMs=80), upsert qty>0 only,
 * then convergeVariant per GTIN for liquidation pricing + Galaxus flags.
 *
 * Usage:
 *   npx tsx scripts/backfill-lab-coldbien.ts            # both
 *   npx tsx scripts/backfill-lab-coldbien.ts lab        # only LAB
 *   npx tsx scripts/backfill-lab-coldbien.ts coldbien   # only COLD BIEN
 */
import { prisma } from "../app/lib/prisma";
import { shopifyGraphQL } from "../lib/shopifyAdmin";
import { LOCATIONS, type LocationConfig } from "../shopify/inventory/locationConfig";
import { upsertLocationStockRow } from "../shopify/inventory/locationMirror";
import { convergeVariant } from "../shopify/inventory/convergence";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";

const LEVELS_QUERY = /* GraphQL */ `
query BackfillLocLevels($loc: ID!, $cur: String, $n: Int!) {
  location(id: $loc) {
    id
    name
    inventoryLevels(first: $n, after: $cur) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          quantities(names: ["available"]) { name quantity }
          item {
            id
            sku
            variant { id sku barcode }
          }
        }
      }
    }
  }
}
`;

type StockRow = {
  shopifyVariantId: string;
  inventoryItemId: string;
  sku: string | null;
  gtin: string | null;
  available: number;
};

function pickLocations(arg: string | undefined): LocationConfig[] {
  const lab = LOCATIONS.find((l) => /lab/i.test(l.name));
  const bien = LOCATIONS.find((l) => /cold\s*bien/i.test(l.name));
  if (!lab) throw new Error("THE LAB CONCEPT STORE not found in LOCATIONS");
  if (!bien) throw new Error("COLD BIEN not found in LOCATIONS");
  const which = String(arg ?? "").toLowerCase();
  if (which === "lab") return [lab];
  if (which === "coldbien" || which === "bien") return [bien];
  return [lab, bien];
}

async function syncLocationFast(location: LocationConfig): Promise<{
  locationName: string;
  stocked: number;
  pages: number;
  gtins: string[];
}> {
  const rows: StockRow[] = [];
  let cursor: string | null = null;
  let pages = 0;
  const maxPages = 6000;
  let throttleRetries = 0;

  while (pages < maxPages) {
    const { data, errors } = await shopifyGraphQL<{
      location: {
        inventoryLevels: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{
            node: {
              quantities: Array<{ name: string; quantity: number }> | null;
              item: {
                id: string;
                sku: string | null;
                variant: { id: string; sku: string | null; barcode: string | null } | null;
              } | null;
            };
          }>;
        };
      } | null;
    }>(LEVELS_QUERY, { loc: location.id, cur: cursor, n: 100 });

    const throttled = errors?.some(
      (e) =>
        e?.extensions?.code === "THROTTLED" ||
        /throttl/i.test(e?.message ?? "")
    );
    if (throttled) {
      throttleRetries += 1;
      if (throttleRetries > 15) {
        throw new Error(`${location.name}: throttled repeatedly; giving up`);
      }
      const waitMs = Math.min(2000 * throttleRetries, 15000);
      console.log(`  ${location.name}: throttled, retry in ${waitMs}ms (${throttleRetries}/15)`);
      await new Promise((r) => setTimeout(r, waitMs));
      continue;
    }
    throttleRetries = 0;

    if (errors?.length) throw new Error(`${location.name}: ${errors.map((e) => e.message).join("; ")}`);

    for (const edge of data?.location?.inventoryLevels?.edges ?? []) {
      const node = edge.node;
      const variant = node.item?.variant;
      if (!variant?.id || !node.item?.id) continue;
      const available = node.quantities?.find((q) => q.name === "available")?.quantity ?? 0;
      if (available <= 0) continue;
      rows.push({
        shopifyVariantId: variant.id,
        inventoryItemId: node.item.id,
        sku: variant.sku ?? node.item.sku ?? null,
        gtin: variant.barcode ?? null,
        available,
      });
    }

    pages += 1;
    const pageInfo = data?.location?.inventoryLevels?.pageInfo;
    if (pageInfo?.hasNextPage && pageInfo.endCursor) {
      cursor = pageInfo.endCursor;
      if (pages % 20 === 0) {
        console.log(`  ${location.name}: page ${pages}, stocked so far ${rows.length}`);
      }
      await new Promise((r) => setTimeout(r, 700));
    } else {
      break;
    }
  }

  const now = new Date();
  for (const row of rows) {
    await upsertLocationStockRow(location, row, now);
  }

  const gtins = Array.from(new Set(rows.map((r) => r.gtin).filter(Boolean))) as string[];
  return { locationName: location.name, stocked: rows.length, pages, gtins };
}

async function main() {
  const targetLocations = pickLocations(process.argv[2]);
  console.log(
    "Backfilling:",
    targetLocations.map((l) => `${l.name} (${l.id})`).join(", ")
  );

  const t0 = Date.now();
  const allGtins = new Set<string>();
  for (const loc of targetLocations) {
    console.log(`Syncing ${loc.name}...`);
    const res = await syncLocationFast(loc);
    console.log(`  done: ${res.stocked} stocked rows, ${res.pages} pages, ${res.gtins.length} GTINs`);
    for (const g of res.gtins) allGtins.add(g);
  }

  const gtinList = Array.from(allGtins);
  console.log(`\nGTINs to converge: ${gtinList.length}`);
  console.log(gtinList.join(", "));

  let ok = 0;
  let changed = 0;
  let errors = 0;

  for (const [i, gtin] of gtinList.entries()) {
    try {
      const { match } = await findShopifyVariantByGtin(gtin);
      if (match) {
        const liq = await applyLiquidationSaleDisplay({
          gtin,
          variant: match,
          slug: match.productHandle,
          sizeEu: match.variantTitle,
        });
        if (liq.applied) {
          console.log(
            `[${i + 1}/${gtinList.length}] ${gtin} liquidation price=${liq.salePrice?.toFixed(2)} compareAt=${liq.referencePrice?.toFixed(2)}`
          );
        } else if (liq.warnings.length) {
          console.log(`[${i + 1}/${gtinList.length}] ${gtin} liquidation skip: ${liq.warnings.join(" | ")}`);
        }
        await new Promise((r) => setTimeout(r, 400));
      }

      const res = await convergeVariant(gtin, { postPhysicalRestock: true });
      ok += 1;
      if (res.changed) changed += 1;
      console.log(
        `[${i + 1}/${gtinList.length}] ${gtin} desired=${res.desired} changed=${res.changed}`,
        res.changes.length ? `\n  changes: ${res.changes.join(" | ")}` : "",
        res.warnings.length ? `\n  warnings: ${res.warnings.join(" | ")}` : "",
        res.error ? `\n  error: ${res.error}` : ""
      );
    } catch (err: any) {
      errors += 1;
      console.error(`[${i + 1}/${gtinList.length}] ${gtin} FAILED:`, err?.message ?? err);
    }
  }

  console.log("\nSummary");
  console.log("  locations :", targetLocations.map((l) => l.name).join(", "));
  console.log("  gtins     :", gtinList.length);
  console.log("  converged :", ok);
  console.log("  changed   :", changed);
  console.log("  errors    :", errors);
  console.log("  total ms  :", Date.now() - t0);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
