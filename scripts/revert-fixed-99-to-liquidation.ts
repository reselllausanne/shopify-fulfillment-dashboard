/**
 * Revert accidental restock fixed-price=99 CHF → proper liquidation 50%.
 *
 * Context: operator left fixed-price toggle at 99 during mass scan. Those
 * variants got `restock:fixed-price compareAt=199` + sell 99 instead of
 * StockX-based soldes (compareAt = calcShopifySellPrice, sale = 50%).
 *
 * Narrow filter: SupplierVariant manualLock + manualNote contains
 * `restock:fixed-price` + manualPrice ≈ 99. Misses physical ~99 rows that
 * never got that note. Prefer the broader script:
 *   scripts/revert-all-99-physical-to-liquidation.ts
 *
 * Keeps intentional manual 99s:
 *   - adidas Forum Low The Grinch (2023) — GTIN 4067886722040
 *   - adidas Campus 00s Bright Blue Dark Marine — GTIN 4066755739479
 *
 * Usage:
 *   npx tsx scripts/revert-fixed-99-to-liquidation.ts            # dry-run
 *   npx tsx scripts/revert-fixed-99-to-liquidation.ts --execute  # live
 */
import { prisma } from "../app/lib/prisma";
import { gtinCandidates, gtinEquals } from "../shopify/restock/gtinNormalize";
import { applyLiquidationSaleDisplay } from "../shopify/restock/liquidationPricing";
import { resolvePhysicalRestockPricing } from "../shopify/restock/physicalRestockPricing";
import { findShopifyVariantByGtin } from "../shopify/restock/shopifyRestockInventory";
import { isRestockFixedPriceNote } from "../shopify/restock/operatorRestockPrice";

const EXECUTE = process.argv.includes("--execute");

/** Intentional fixed 99 — do not touch. */
const EXCLUDE_GTINS = ["4067886722040", "4066755739479", "04066755739479"];

const PHYSICAL_LOCATION_IDS = [
  "gid://shopify/Location/111267971458", // Bussigny
  "gid://shopify/Location/111267217794", // Antica
  "gid://shopify/Location/111267250562", // Lab
  "gid://shopify/Location/111272100226", // Cold Bien
];

function isExcluded(gtin: string): boolean {
  return EXCLUDE_GTINS.some((ex) => gtinEquals(gtin, ex));
}

function saleFromCompareAt(compareAt: number): number {
  return Math.floor(compareAt * 0.5 * 2) / 2;
}

type Candidate = {
  gtin: string;
  name: string | null;
  manualPrice: number;
  manualNote: string | null;
  manualUpdatedAt: Date | null;
  physicalQty: number;
  locationNames: string[];
};

async function loadCandidates(): Promise<Candidate[]> {
  const rows = await prisma.supplierVariant.findMany({
    where: {
      manualLock: true,
      manualPrice: { gte: 98.5, lte: 99.5 },
      manualNote: { contains: "restock:fixed-price" },
    },
    select: {
      gtin: true,
      supplierProductName: true,
      manualPrice: true,
      manualNote: true,
      manualUpdatedAt: true,
    },
    orderBy: { manualUpdatedAt: "desc" },
  });

  const out: Candidate[] = [];
  for (const row of rows) {
    const gtin = String(row.gtin ?? "").trim();
    if (!gtin) continue;
    if (!isRestockFixedPriceNote(row.manualNote)) continue;

    const cands = gtinCandidates(gtin);
    const stock = await prisma.shopifyVariantLocationStock.findMany({
      where: {
        gtin: { in: cands.length ? cands : [gtin] },
        locationId: { in: PHYSICAL_LOCATION_IDS },
        sourceType: "physical",
        available: { gt: 0 },
      },
      select: { available: true, locationName: true },
    });
    const physicalQty = stock.reduce((s, r) => s + Number(r.available ?? 0), 0);
    const locationNames = [...new Set(stock.map((r) => r.locationName).filter(Boolean))];

    out.push({
      gtin,
      name: row.supplierProductName,
      manualPrice: Number(row.manualPrice),
      manualNote: row.manualNote,
      manualUpdatedAt: row.manualUpdatedAt,
      physicalQty,
      locationNames: locationNames as string[],
    });
  }
  return out;
}

async function main() {
  console.log(`\n=== REVERT FIXED-99 → LIQUIDATION 50% (execute=${EXECUTE}) ===\n`);

  const all = await loadCandidates();
  const excluded = all.filter((c) => isExcluded(c.gtin));
  const targets = all.filter((c) => !isExcluded(c.gtin));

  console.log(`Found at ~99 fixed-price: ${all.length}`);
  console.log(`Excluded (keep 99):       ${excluded.length}`);
  for (const e of excluded) {
    console.log(`  KEEP  ${e.gtin}  ${e.name ?? ""}`);
  }
  console.log(`To reprice:               ${targets.length}\n`);

  const repriced: Array<{
    gtin: string;
    sku: string | null;
    title: string | null;
    currentPrice: number | null;
    currentCompareAt: number | null;
    compareAt: number;
    salePrice: number;
    source: string;
  }> = [];
  const skipped: Array<{ gtin: string; name: string | null; reason: string }> = [];
  const failures: Array<{ gtin: string; error: string }> = [];

  for (const t of targets) {
    if (t.physicalQty <= 0) {
      skipped.push({ gtin: t.gtin, name: t.name, reason: "no physical stock > 0" });
      continue;
    }

    const { match, ambiguous } = await findShopifyVariantByGtin(t.gtin);
    if (!match) {
      skipped.push({ gtin: t.gtin, name: t.name, reason: "no Shopify variant" });
      continue;
    }
    if (ambiguous) {
      skipped.push({ gtin: t.gtin, name: t.name, reason: "ambiguous Shopify match" });
      continue;
    }

    const shopPrice = match.price;
    if (shopPrice == null || Math.abs(shopPrice - 99) > 0.6) {
      skipped.push({
        gtin: t.gtin,
        name: t.name,
        reason: `Shopify price not ~99 (got ${shopPrice})`,
      });
      continue;
    }

    const pricing = await resolvePhysicalRestockPricing(t.gtin, {
      slug: match.productHandle,
      sizeEu: match.variantTitle,
    });
    const compareAt = pricing.compareAt;
    if (compareAt == null || compareAt <= 0) {
      skipped.push({
        gtin: t.gtin,
        name: t.name,
        reason: `no StockX/compareAt (source=${pricing.source})`,
      });
      continue;
    }

    const salePrice = saleFromCompareAt(compareAt);
    if (!salePrice || salePrice <= 0 || salePrice >= compareAt) {
      skipped.push({
        gtin: t.gtin,
        name: t.name,
        reason: `invalid salePrice=${salePrice} compareAt=${compareAt}`,
      });
      continue;
    }

    const row = {
      gtin: t.gtin,
      sku: match.sku,
      title: match.productTitle ?? t.name,
      currentPrice: shopPrice,
      currentCompareAt: match.compareAtPrice,
      compareAt,
      salePrice,
      source: pricing.source,
    };

    console.log(
      [
        t.gtin,
        match.sku ?? "?",
        (match.productTitle ?? t.name ?? "").slice(0, 45),
        `qty=${t.physicalQty}@${t.locationNames.join(",") || "?"}`,
        `${shopPrice}→${salePrice}`,
        `compareAt ${match.compareAtPrice ?? "?"}→${compareAt}`,
        `src=${pricing.source}`,
      ].join(" | ")
    );

    if (!EXECUTE) {
      repriced.push(row);
      continue;
    }

    try {
      const liq = await applyLiquidationSaleDisplay({
        gtin: t.gtin,
        variant: match,
        slug: match.productHandle,
        sizeEu: match.variantTitle,
      });
      if (!liq.applied) {
        skipped.push({
          gtin: t.gtin,
          name: t.name,
          reason: `liq not applied: ${liq.warnings.join("; ") || "unknown"}`,
        });
        continue;
      }
      repriced.push({
        ...row,
        compareAt: liq.referencePrice ?? compareAt,
        salePrice: liq.salePrice ?? salePrice,
      });
      if (liq.warnings.length) {
        console.log(`  warnings: ${liq.warnings.join("; ")}`);
      }
    } catch (err: any) {
      failures.push({ gtin: t.gtin, error: err?.message ?? String(err) });
    }

    // light throttle for Shopify
    await new Promise((r) => setTimeout(r, 250));
  }

  console.log("\n--- SUMMARY ---");
  console.log(`found_at_99:     ${all.length}`);
  console.log(`excluded:        ${excluded.length}`);
  console.log(`${EXECUTE ? "repriced" : "would_reprice"}: ${repriced.length}`);
  console.log(`skipped:         ${skipped.length}`);
  console.log(`failures:        ${failures.length}`);

  if (repriced.length) {
    console.log("\nSample (up to 15):");
    console.log(
      ["GTIN", "SKU", "Title", "Was", "Sale", "CompareAt", "Src"].join("\t")
    );
    for (const r of repriced.slice(0, 15)) {
      console.log(
        [
          r.gtin,
          r.sku ?? "",
          (r.title ?? "").slice(0, 40),
          r.currentPrice,
          r.salePrice,
          r.compareAt,
          r.source,
        ].join("\t")
      );
    }
  }

  if (skipped.length) {
    console.log("\nSkipped:");
    for (const s of skipped) {
      console.log(`  ${s.gtin}  ${(s.name ?? "").slice(0, 40)}  — ${s.reason}`);
    }
  }
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  ${f.gtin}  — ${f.error}`);
  }

  if (!EXECUTE) {
    console.log("\nDry-run only. Pass --execute to apply.\n");
  }
}

main()
  .catch(async (err) => {
    console.error("[revert-fixed-99] fatal", err);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
