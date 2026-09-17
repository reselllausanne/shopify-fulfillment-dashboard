#!/usr/bin/env npx tsx
/**
 * Repair STX SupplierVariant rows historically broken by express≥ratio×standard
 * cap demotion (incl. standard+stock=0 that the express-only backfill skipped).
 *
 * Selects ALL STX with both buys and expressBuy ≥ ratio × standardBuy
 * (any deliveryType, any stock). Reloads KickDBProduct.rawJson via KickDBVariant,
 * then repairStxCapLaneFromSource.
 *
 *   npx tsx scripts/repair-stx-express-cap-lanes.ts
 *   npx tsx scripts/repair-stx-express-cap-lanes.ts --dry-run --limit 50
 *   npx tsx scripts/repair-stx-express-cap-lanes.ts --apply --page 200
 */
import { prisma } from "@/app/lib/prisma";
import {
  isStxCapRepairActionable,
  repairStxCapLaneFromSource,
  toStxCapRepairApplyFields,
  type StxCapRepairBucket,
  type StxCapRepairDecision,
} from "@/galaxus/stx/repairExpressCapLane";
import { readStxExpressOverStandardMaxRatio } from "@/galaxus/stx/variantPriceLanes";

function hasFlag(name: string): boolean {
  return process.argv.includes(name);
}

function readArg(name: string): string | null {
  const idx = process.argv.indexOf(name);
  if (idx < 0) return null;
  return process.argv[idx + 1] ?? null;
}

type CapRow = {
  supplierVariantId: string;
  providerKey: string | null;
  deliveryType: string | null;
  stock: number;
  price: number | null;
  expressBuyPrice: number | null;
  standardBuyPrice: number | null;
  supplierProductName: string | null;
  kickdbVariantExtId: string | null;
  rawJson: unknown | null;
  productName: string | null;
};

function extractSourcePrices(
  rawJson: unknown,
  kickdbVariantExtId: string | null
): { prices: unknown | null; productPayload: unknown } {
  if (rawJson == null || !kickdbVariantExtId) {
    return { prices: null, productPayload: rawJson ?? null };
  }
  const raw = rawJson as { variants?: unknown[] };
  const variants = Array.isArray(raw?.variants) ? raw.variants : [];
  for (const v of variants) {
    const id = String((v as { id?: unknown })?.id ?? "");
    if (id === kickdbVariantExtId) {
      return {
        prices: (v as { prices?: unknown })?.prices ?? null,
        productPayload: rawJson,
      };
    }
  }
  return { prices: null, productPayload: rawJson };
}

async function loadPage(input: {
  ratio: number;
  pageSize: number;
  afterId: string;
}): Promise<CapRow[]> {
  return prisma.$queryRawUnsafe<CapRow[]>(
    `
    SELECT
      sv."supplierVariantId",
      sv."providerKey",
      sv."deliveryType",
      sv.stock::int AS stock,
      sv.price::float8 AS price,
      sv."expressBuyPrice"::float8 AS "expressBuyPrice",
      sv."standardBuyPrice"::float8 AS "standardBuyPrice",
      sv."supplierProductName",
      COALESCE(kv."kickdbVariantId", SUBSTRING(sv."supplierVariantId" FROM 5)) AS "kickdbVariantExtId",
      kp."rawJson",
      kp.name AS "productName"
    FROM "SupplierVariant" sv
    LEFT JOIN "KickDBVariant" kv
      ON kv."kickdbVariantId" = SUBSTRING(sv."supplierVariantId" FROM 5)
    LEFT JOIN "KickDBProduct" kp
      ON kp.id = kv."productId"
    WHERE sv."supplierVariantId" LIKE 'stx\\_%'
      AND sv."expressBuyPrice" IS NOT NULL
      AND sv."standardBuyPrice" IS NOT NULL
      AND sv."standardBuyPrice"::numeric > 0
      AND sv."expressBuyPrice"::numeric >= $1 * sv."standardBuyPrice"::numeric
      AND sv."supplierVariantId" > $2
    ORDER BY sv."supplierVariantId" ASC
    LIMIT $3
    `,
    input.ratio,
    input.afterId,
    input.pageSize
  );
}

async function main() {
  const apply = hasFlag("--apply");
  const dryRun = !apply;
  const ratio = Number.parseFloat(readArg("--ratio") ?? "") || readStxExpressOverStandardMaxRatio();
  const pageSize = Math.max(1, Number.parseInt(readArg("--page") ?? "200", 10) || 200);
  const limitRaw = readArg("--limit");
  const limit = limitRaw != null ? Math.max(0, Number.parseInt(limitRaw, 10) || 0) : null;

  console.log(
    `[repair-stx-cap] mode=${dryRun ? "dry-run" : "APPLY"} ratio>=${ratio} page=${pageSize}` +
      ` limit=${limit ?? "unlimited"}`
  );

  const counters: Record<StxCapRepairBucket, number> = {
    repaired_standard_to_express: 0,
    repaired_express_to_standard: 0,
    repaired_stock_restored_standard: 0,
    repaired_stock_restored_express: 0,
    unchanged_ok: 0,
    true_oos_source_asks_zero: 0,
    missing_source: 0,
    lane_error_unresolved: 0,
  };
  const samples: Partial<Record<StxCapRepairBucket, string[]>> = {};
  const pushSample = (bucket: StxCapRepairBucket, line: string) => {
    const list = samples[bucket] ?? (samples[bucket] = []);
    if (list.length < 8) list.push(line);
  };

  let afterId = "";
  let scanned = 0;
  let applied = 0;

  while (true) {
    if (limit != null && scanned >= limit) break;
    const take = limit != null ? Math.min(pageSize, limit - scanned) : pageSize;
    const page = await loadPage({ ratio, pageSize: take, afterId });
    if (page.length === 0) break;

    for (const row of page) {
      scanned += 1;
      afterId = row.supplierVariantId;

      const { prices, productPayload } = extractSourcePrices(
        row.rawJson,
        row.kickdbVariantExtId
      );

      const decision: StxCapRepairDecision = repairStxCapLaneFromSource({
        current: {
          supplierVariantId: row.supplierVariantId,
          providerKey: row.providerKey,
          deliveryType: row.deliveryType,
          stock: row.stock,
          price: row.price,
          expressBuyPrice: row.expressBuyPrice,
          standardBuyPrice: row.standardBuyPrice,
        },
        sourcePrices: prices,
        productPayload,
        productName: row.productName ?? row.supplierProductName,
        ratio,
      });

      counters[decision.bucket] += 1;
      pushSample(
        decision.bucket,
        `${row.providerKey ?? row.supplierVariantId} ${decision.detail}` +
          ` expAsks=${decision.sourceExpressAsks ?? "?"} stdAsks=${decision.sourceStandardAsks ?? "?"}`
      );

      if (!dryRun && isStxCapRepairActionable(decision.bucket) && decision.next) {
        const fields = toStxCapRepairApplyFields(decision.next);
        await prisma.supplierVariant.update({
          where: { supplierVariantId: row.supplierVariantId },
          data: {
            price: fields.price,
            stock: fields.stock,
            deliveryType: fields.deliveryType,
            suggestedRetailPriceInclVat: fields.suggestedRetailPriceInclVat,
            standardBuyPrice: fields.standardBuyPrice,
            expressBuyPrice: fields.expressBuyPrice,
            standardSuggestedRetailPriceInclVat: fields.standardSuggestedRetailPriceInclVat,
          },
        });
        applied += 1;
      }
    }

    if (page.length < take) break;
  }

  const actionable =
    counters.repaired_standard_to_express +
    counters.repaired_express_to_standard +
    counters.repaired_stock_restored_standard +
    counters.repaired_stock_restored_express;

  console.log(
    JSON.stringify(
      {
        scanned,
        actionable,
        applied: dryRun ? 0 : applied,
        counters,
        samples,
      },
      null,
      2
    )
  );

  if (dryRun) {
    console.log("[repair-stx-cap] dry-run only — pass --apply to write");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined);
  });
