/**
 * Hard-exclude Shopify offers priced >= min CHF from Google Ads spend.
 *
 * Writes Merchant supplemental custom_label_3=ads_excluded (no campaign includes it).
 * Does not unpublish Shopify / does not delete Merchant primary products.
 *
 *   npx tsx scripts/ads-exclude-price-cap.ts --min-price=3000
 *   npx tsx scripts/ads-exclude-price-cap.ts --min-price=3000 --apply
 *   npx tsx scripts/ads-exclude-price-cap.ts --min-price=3000 --apply --limit=200
 */
import "dotenv/config";

import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { EXPLORER_DEFAULT_MERCHANT_ID } from "@/adsanalytics/explorer/core";
import { ADS_EXCLUDED_LABEL } from "@/adsanalytics/explorer/labels";
import {
  insertSupplementalProductLabel,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import { ensureExplorerSupplementalSource } from "@/adsanalytics/explorer/supplementalSource";
import { createLimiter } from "@/adsanalytics/explorer/limiter";

function numFlag(name: string, fallback: number): number {
  const raw = process.argv.find((a) => a.startsWith(`--${name}=`))?.split("=")[1];
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

const APPLY = process.argv.includes("--apply");
const MIN_PRICE = numFlag("min-price", 3000);
const LIMIT = numFlag("limit", 50_000);
const CONCURRENCY = Math.min(16, Math.max(1, Math.floor(numFlag("concurrency", 8))));
const MERCHANT_ID = String(
  process.env.GOOGLE_MERCHANT_ID?.trim() || EXPLORER_DEFAULT_MERCHANT_ID
);

type Row = {
  offer_id: string;
  content_language: string;
  feed_label: string;
  shopify_variant_id: bigint | null;
  price: number;
  status: string;
  availability: string;
};

async function main() {
  console.log(
    `${APPLY ? "APPLY" : "DRY-RUN"} | merchant=${MERCHANT_ID} | min-price=${MIN_PRICE} | limit=${LIMIT} | concurrency=${CONCURRENCY}`
  );

  const rows = await prisma.$queryRaw<Row[]>(Prisma.sql`
    WITH expensive AS (
      SELECT DISTINCT
        NULLIF(regexp_replace(cls."externalVariantId", '[^0-9]', '', 'g'), '')::bigint AS shopify_variant_id,
        cls."lastPushedPrice"::float AS price
      FROM "ChannelListingState" cls
      WHERE cls.channel = 'SHOPIFY'
        AND cls."lastPushedPrice" >= ${MIN_PRICE}
        AND cls."externalVariantId" IS NOT NULL
    )
    SELECT DISTINCT ON (a.offer_id, a.language_code, a.feed_label)
      a.offer_id,
      a.language_code AS content_language,
      a.feed_label,
      a.shopify_variant_id,
      e.price,
      a.status,
      a.availability
    FROM ads_shopping_product_current a
    JOIN expensive e ON e.shopify_variant_id = a.shopify_variant_id
    WHERE a.is_current
      AND a.merchant_id = ${BigInt(MERCHANT_ID)}
      AND COALESCE(a.custom_attr3, '') <> ${ADS_EXCLUDED_LABEL}
    ORDER BY a.offer_id, a.language_code, a.feed_label, e.price DESC
    LIMIT ${LIMIT}
  `);

  const eligibleInStock = rows.filter(
    (r) => r.status === "ELIGIBLE" && r.availability === "IN_STOCK"
  ).length;
  console.log(
    `candidates=${rows.length} | already_labeled skipped | eligible_in_stock≈${eligibleInStock}`
  );
  for (const r of rows.slice(0, 8)) {
    console.log(
      `  sample ${r.offer_id} ${r.content_language}/${r.feed_label} price=${r.price} ${r.status}/${r.availability}`
    );
  }

  if (!APPLY) {
    console.log("Dry-run only. Re-run with --apply to write ads_excluded.");
    return;
  }
  if (rows.length === 0) {
    console.log("Nothing to write.");
    return;
  }

  const { dataSource, sourceCreated, primaryPatches } = await ensureExplorerSupplementalSource(
    MERCHANT_ID
  );
  console.log(
    `supplemental=${dataSource} created=${sourceCreated} primaryPatches=${primaryPatches.filter((p) => p.patched).length}`
  );

  const limit = createLimiter(CONCURRENCY);
  let ok = 0;
  let fail = 0;
  const errors: string[] = [];

  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const product: MerchantProductRef = {
          offerId: row.offer_id,
          contentLanguage: row.content_language,
          feedLabel: row.feed_label,
        };
        try {
          await insertSupplementalProductLabel(
            MERCHANT_ID,
            dataSource,
            product,
            ADS_EXCLUDED_LABEL
          );
          ok += 1;
          if (ok % 100 === 0) console.log(`… wrote ${ok}/${rows.length}`);
        } catch (err) {
          fail += 1;
          const msg = err instanceof Error ? err.message : String(err);
          if (errors.length < 20) errors.push(`${row.offer_id}/${row.content_language}: ${msg}`);
        }
      })
    )
  );

  console.log(`done ok=${ok} fail=${fail}`);
  if (errors.length) {
    console.log("errors (cap 20):");
    for (const e of errors) console.log(`  ${e}`);
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
