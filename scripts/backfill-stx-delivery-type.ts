/**
 * Backfill SupplierVariant.deliveryType for existing STX rows.
 *
 * Problem: pre-2026-07-22 imports coerced every non-express price row to
 *   deliveryType="express_standard" via the forceImport fallback (import path
 *   only knew two enum values). Result: DB thinks non-express variants are
 *   express, so marketplace dropship publishes them at qty>0.
 *
 * Fix: walk every stx_ SupplierVariant with a KickDBVariant + parent
 * KickDBProduct.rawJson, re-run selectStxOfferForImport, and update
 * deliveryType/price/stock where the recomputed selection differs. Also flips
 * express-coerced rows back to "standard" when no express row exists.
 *
 * Chunked/streaming: pages KickDBProduct by createdAt ASC (bounded memory) and
 * processes all stx_ variants belonging to that page's products in one batch.
 * A 163k-row load blew Node's heap in the previous single-query version.
 *
 * Idempotent: safe to re-run. Dry-run by default; pass --write to persist.
 *
 * Usage:
 *   npx tsx scripts/backfill-stx-delivery-type.ts                     # dry-run
 *   npx tsx scripts/backfill-stx-delivery-type.ts --write             # apply
 *   npx tsx scripts/backfill-stx-delivery-type.ts --write --page 500  # tune
 *   npx tsx scripts/backfill-stx-delivery-type.ts --write --resume-after <iso>
 */

import { prisma } from "@/app/lib/prisma";
import { selectStxOfferForImport } from "@/galaxus/stx/offerSelection";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";

type Args = {
  write: boolean;
  pageSize: number;
  resumeAfter: Date | null;
  limitProducts: number | null;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = {
    write: false,
    pageSize: 500,
    resumeAfter: null,
    limitProducts: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--page") args.pageSize = Number(argv[++i]);
    else if (a === "--resume-after") args.resumeAfter = new Date(argv[++i]);
    else if (a === "--limit-products") args.limitProducts = Number(argv[++i]);
  }
  return args;
}

type ProductPage = {
  id: string;
  createdAt: Date;
  rawJson: any;
};

async function loadProductPage(
  after: Date,
  pageSize: number
): Promise<ProductPage[]> {
  return prisma.$queryRaw<ProductPage[]>`
    SELECT p."id", p."createdAt", p."rawJson"
    FROM "public"."KickDBProduct" p
    WHERE p."rawJson" IS NOT NULL
      AND p."createdAt" > ${after}
    ORDER BY p."createdAt" ASC
    LIMIT ${pageSize}
  `;
}

type StxRow = {
  supplierVariantId: string;
  deliveryType: string | null;
  price: any;
  stock: number;
  kickdbVariantId: string;
};

async function loadStxRowsForVariantIds(
  variantExternalIds: string[]
): Promise<StxRow[]> {
  if (variantExternalIds.length === 0) return [];
  const supplierIds = variantExternalIds.map((v) => `stx_${v}`);
  return prisma.$queryRaw<StxRow[]>`
    SELECT sv."supplierVariantId",
           sv."deliveryType",
           sv."price",
           sv."stock",
           SUBSTRING(sv."supplierVariantId" FROM 5) AS "kickdbVariantId"
    FROM "public"."SupplierVariant" sv
    WHERE sv."supplierVariantId" = ANY(${supplierIds}::text[])
  `;
}

async function main() {
  const args = parseArgs();
  console.log(
    `[backfill-stx-delivery-type] mode=${
      args.write ? "WRITE" : "DRY-RUN"
    } page=${args.pageSize} resumeAfter=${
      args.resumeAfter?.toISOString() ?? "epoch"
    } limitProducts=${args.limitProducts ?? "unlimited"}`
  );

  const startedAt = Date.now();
  const counters = {
    productsScanned: 0,
    stxRowsInspected: 0,
    noSelection: 0,
    unchanged: 0,
    coercedToStandard: 0,
    typeCorrected: 0,
    priceDrift: 0,
    stockDrift: 0,
    updated: 0,
    errors: 0,
  };

  let after = args.resumeAfter ?? new Date(0);
  let productsProcessed = 0;
  let lastLoggedAt = Date.now();

  while (true) {
    if (args.limitProducts && productsProcessed >= args.limitProducts) break;

    const page = await loadProductPage(after, args.pageSize);
    if (page.length === 0) break;

    // Collect stx_ variant external ids from this page's rawJson.
    const variantMap = new Map<
      string,
      { product: any; variant: any }
    >();
    for (const p of page) {
      const raw = p.rawJson as any;
      const variants = Array.isArray(raw?.variants) ? raw.variants : [];
      for (const v of variants) {
        const id = String(v?.id ?? "");
        if (!id) continue;
        variantMap.set(id, { product: raw, variant: v });
      }
    }

    const externalIds = Array.from(variantMap.keys());
    const stxRows = await loadStxRowsForVariantIds(externalIds);

    const updates: Array<{
      supplierVariantId: string;
      deliveryType: string;
      price: number;
      stock: number;
      reason: string;
    }> = [];

    for (const row of stxRows) {
      counters.stxRowsInspected += 1;
      const entry = variantMap.get(row.kickdbVariantId);
      if (!entry) continue;

      let selected: ReturnType<typeof selectStxOfferForImport> | null = null;
      try {
        selected = selectStxOfferForImport(entry.variant?.prices, {
          forceImport: true,
        });
      } catch {
        counters.errors += 1;
        continue;
      }
      if (!selected) {
        counters.noSelection += 1;
        continue;
      }

      const shipping = resolveStxShippingCHF(entry.product);
      const recomputedPrice = estimatedStockxBuyChfFromList(
        selected.price,
        shipping
      );
      const storedPrice = Number(row.price ?? 0);
      const priceMatches = Math.abs(storedPrice - recomputedPrice) < 0.005;
      const stockMatches = Number(row.stock ?? 0) === selected.asks;
      const typeMatches = row.deliveryType === selected.deliveryType;

      if (typeMatches && priceMatches && stockMatches) {
        counters.unchanged += 1;
        continue;
      }
      if (!typeMatches) counters.typeCorrected += 1;
      if (!typeMatches && selected.deliveryType === "standard") {
        counters.coercedToStandard += 1;
      }
      if (!priceMatches) counters.priceDrift += 1;
      if (!stockMatches) counters.stockDrift += 1;

      const reasons: string[] = [];
      if (!typeMatches) {
        reasons.push(
          `type ${row.deliveryType ?? "null"}->${selected.deliveryType}`
        );
      }
      if (!priceMatches) {
        reasons.push(
          `price ${storedPrice.toFixed(2)}->${recomputedPrice.toFixed(2)}`
        );
      }
      if (!stockMatches) {
        reasons.push(`stock ${row.stock}->${selected.asks}`);
      }
      updates.push({
        supplierVariantId: row.supplierVariantId,
        deliveryType: selected.deliveryType,
        price: recomputedPrice,
        stock: selected.asks,
        reason: reasons.join("; "),
      });
    }

    if (args.write && updates.length > 0) {
      await Promise.all(
        updates.map(async (u) => {
          try {
            await prisma.supplierVariant.update({
              where: { supplierVariantId: u.supplierVariantId },
              data: {
                deliveryType: u.deliveryType,
                price: u.price,
                stock: u.stock,
              },
            });
            counters.updated += 1;
          } catch (err: any) {
            counters.errors += 1;
            console.error(
              `[backfill-stx-delivery-type] update failed ${u.supplierVariantId}: ${
                err?.message ?? err
              }`
            );
          }
        })
      );
    }

    counters.productsScanned += page.length;
    productsProcessed += page.length;
    after = page[page.length - 1].createdAt;

    if (Date.now() - lastLoggedAt >= 5000) {
      console.log(
        `[backfill-stx-delivery-type] progress products=${
          counters.productsScanned
        } stx=${counters.stxRowsInspected} updates=${counters.updated} counters=${JSON.stringify(
          counters
        )}`
      );
      lastLoggedAt = Date.now();
    }
  }

  console.log(
    `[backfill-stx-delivery-type] done ${Date.now() - startedAt}ms counters=${JSON.stringify(
      counters
    )}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-stx-delivery-type] fatal", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
