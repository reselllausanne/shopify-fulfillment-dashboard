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
 * Idempotent: safe to re-run. Dry-run by default; pass --write to persist.
 *
 * Usage:
 *   npx tsx scripts/backfill-stx-delivery-type.ts             # dry-run
 *   npx tsx scripts/backfill-stx-delivery-type.ts --write     # apply
 *   npx tsx scripts/backfill-stx-delivery-type.ts --write --limit 5000
 */

import { prisma } from "@/app/lib/prisma";
import { selectStxOfferForImport } from "@/galaxus/stx/offerSelection";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";

type Args = {
  write: boolean;
  limit: number | null;
  batchSize: number;
};

function parseArgs(): Args {
  const argv = process.argv.slice(2);
  const args: Args = { write: false, limit: null, batchSize: 500 };
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (a === "--write") args.write = true;
    else if (a === "--limit") args.limit = Number(argv[++i]);
    else if (a === "--batch") args.batchSize = Number(argv[++i]);
  }
  return args;
}

type Row = {
  supplierVariantId: string;
  storedDeliveryType: string | null;
  storedPrice: number;
  storedStock: number;
  storedSuggested: number | null;
  kickdbVariantExternalId: string;
  productSlug: string | null;
  productHandle: string | null;
  productName: string | null;
  rawVariant: any;
  rawProduct: any;
};

async function loadRows(limit: number | null): Promise<Row[]> {
  const cap = limit && Number.isFinite(limit) ? limit : 1_000_000;
  // stx_ supplierVariantId encodes the KickDB variant external id after the
  // underscore. Join to the raw payload via KickDBVariant -> KickDBProduct.
  const rows = await prisma.$queryRaw<
    Array<{
      supplierVariantId: string;
      deliveryType: string | null;
      price: any;
      stock: number;
      suggestedRetailPriceInclVat: any;
      kickdbVariantId: string;
      rawJson: any;
    }>
  >`
    SELECT
      sv."supplierVariantId",
      sv."deliveryType",
      sv."price",
      sv."stock",
      sv."suggestedRetailPriceInclVat",
      kv."kickdbVariantId",
      kp."rawJson"
    FROM "public"."SupplierVariant" sv
    JOIN "public"."KickDBVariant"  kv ON kv."kickdbVariantId" = SUBSTRING(sv."supplierVariantId" FROM 5)
    JOIN "public"."KickDBProduct"  kp ON kp."id" = kv."productId"
    WHERE sv."supplierVariantId" LIKE 'stx\_%' ESCAPE '\'
      AND kp."rawJson" IS NOT NULL
    LIMIT ${cap}
  `;

  const out: Row[] = [];
  for (const r of rows) {
    const raw = r.rawJson as any;
    if (!raw) continue;
    const variants = Array.isArray(raw?.variants) ? raw.variants : [];
    const match = variants.find((v: any) => String(v?.id ?? "") === r.kickdbVariantId);
    if (!match) continue;
    out.push({
      supplierVariantId: r.supplierVariantId,
      storedDeliveryType: r.deliveryType,
      storedPrice: Number(r.price ?? 0),
      storedStock: Number(r.stock ?? 0),
      storedSuggested:
        r.suggestedRetailPriceInclVat != null ? Number(r.suggestedRetailPriceInclVat) : null,
      kickdbVariantExternalId: r.kickdbVariantId,
      productSlug: (raw?.slug ?? raw?.url_key ?? raw?.urlKey ?? null) as string | null,
      productHandle: (raw?.slug ?? raw?.url_key ?? raw?.urlKey ?? null) as string | null,
      productName: (raw?.title ?? raw?.name ?? null) as string | null,
      rawVariant: match,
      rawProduct: raw,
    });
  }
  return out;
}

async function main() {
  const args = parseArgs();
  console.log(
    `[backfill-stx-delivery-type] mode=${args.write ? "WRITE" : "DRY-RUN"} limit=${args.limit ?? "all"} batch=${args.batchSize}`
  );

  const startedAt = Date.now();
  const rows = await loadRows(args.limit);
  console.log(`[backfill-stx-delivery-type] loaded ${rows.length} rows in ${Date.now() - startedAt}ms`);

  const counters = {
    inspected: 0,
    noSelection: 0,
    unchanged: 0,
    coercedToStandard: 0,
    typeCorrected: 0,
    priceDrift: 0,
    stockDrift: 0,
    updated: 0,
    errors: 0,
  };

  const updates: Array<{
    supplierVariantId: string;
    data: {
      deliveryType: string;
      price: number;
      stock: number;
      suggestedRetailPriceInclVat: number | null;
    };
    reason: string;
  }> = [];

  for (const row of rows) {
    counters.inspected += 1;
    let selected: ReturnType<typeof selectStxOfferForImport> | null = null;
    try {
      selected = selectStxOfferForImport(row.rawVariant?.prices, { forceImport: true });
    } catch (err) {
      counters.errors += 1;
      continue;
    }
    if (!selected) {
      counters.noSelection += 1;
      continue;
    }

    const shipping = resolveStxShippingCHF(row.rawProduct);
    const recomputedPrice = estimatedStockxBuyChfFromList(selected.price, shipping);
    const priceMatches = Math.abs((row.storedPrice ?? 0) - recomputedPrice) < 0.005;
    const stockMatches = row.storedStock === selected.asks;
    const typeMatches = row.storedDeliveryType === selected.deliveryType;

    const isTypeCorrectionToStandard =
      !typeMatches && selected.deliveryType === "standard";

    if (typeMatches && priceMatches && stockMatches) {
      counters.unchanged += 1;
      continue;
    }
    if (!typeMatches) counters.typeCorrected += 1;
    if (isTypeCorrectionToStandard) counters.coercedToStandard += 1;
    if (!priceMatches) counters.priceDrift += 1;
    if (!stockMatches) counters.stockDrift += 1;

    const reasons: string[] = [];
    if (!typeMatches) {
      reasons.push(`type ${row.storedDeliveryType ?? "null"}->${selected.deliveryType}`);
    }
    if (!priceMatches) {
      reasons.push(`price ${row.storedPrice.toFixed(2)}->${recomputedPrice.toFixed(2)}`);
    }
    if (!stockMatches) {
      reasons.push(`stock ${row.storedStock}->${selected.asks}`);
    }

    updates.push({
      supplierVariantId: row.supplierVariantId,
      data: {
        deliveryType: selected.deliveryType,
        price: recomputedPrice,
        stock: selected.asks,
        suggestedRetailPriceInclVat: row.storedSuggested,
      },
      reason: reasons.join("; "),
    });
  }

  console.log(
    `[backfill-stx-delivery-type] planned ${updates.length} updates. counters=${JSON.stringify(counters)}`
  );

  if (updates.length > 0) {
    console.log("[backfill-stx-delivery-type] sample:");
    for (const u of updates.slice(0, 10)) {
      console.log(`  ${u.supplierVariantId}: ${u.reason}`);
    }
  }

  if (!args.write) {
    console.log("[backfill-stx-delivery-type] dry-run — no writes. Pass --write to apply.");
    process.exit(0);
  }

  const batchSize = Math.max(50, args.batchSize);
  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    await Promise.all(
      batch.map(async (u) => {
        try {
          await prisma.supplierVariant.update({
            where: { supplierVariantId: u.supplierVariantId },
            data: {
              deliveryType: u.data.deliveryType,
              price: u.data.price,
              stock: u.data.stock,
            },
          });
          counters.updated += 1;
        } catch (err: any) {
          counters.errors += 1;
          console.error(`[backfill-stx-delivery-type] update failed ${u.supplierVariantId}: ${err?.message ?? err}`);
        }
      })
    );
    console.log(`[backfill-stx-delivery-type] wrote ${Math.min(i + batchSize, updates.length)}/${updates.length}`);
  }

  console.log(
    `[backfill-stx-delivery-type] done ${Date.now() - startedAt}ms counters=${JSON.stringify(counters)}`
  );
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[backfill-stx-delivery-type] fatal", err);
  await prisma.$disconnect().catch(() => {});
  process.exit(1);
});
