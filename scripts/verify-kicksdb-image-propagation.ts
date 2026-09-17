#!/usr/bin/env npx tsx
/**
 * Read-only verification: Shopify featured media ↔ Google Merchant imageLink
 * for **all active Merchant offers** of each Shopify product.
 *
 * Simprosys pushes Shopify featuredMedia → Merchant Center image_link on every
 * variant offer (`shopify_ch_<productId>_<variantId>`). Checking a single offer
 * is NOT product validation — this script verifies every current offer row.
 *
 * Usage:
 *   npx tsx scripts/verify-kicksdb-image-propagation.ts --limit=20
 *   npx tsx scripts/verify-kicksdb-image-propagation.ts --from-progress=tmp/kicksdb-image-backfill-progress.jsonl --limit=20
 *   npx tsx scripts/verify-kicksdb-image-propagation.ts --handle=air-jordan-1-retro-high
 *
 * Product statuses:
 *   SHOPIFY_CORRECT_GOOGLE_CORRECT  — every verifiable active offer matches
 *   SHOPIFY_CORRECT_GOOGLE_PARTIAL  — some offers correct, others pending/mismatch/failed
 *   SHOPIFY_CORRECT_GOOGLE_PENDING  — all looked-up offers pending (no imageLink yet / 404)
 *   SHOPIFY_CORRECT_GOOGLE_MISMATCH — all looked-up offers mismatch (none correct)
 *   SHOPIFY_INVALID
 *   GOOGLE_LOOKUP_FAILED            — zero offers found in ads_shopping_product_current
 */
import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/app/lib/prisma";
import { EXPLORER_DEFAULT_MERCHANT_ID } from "@/adsanalytics/explorer/core";
import {
  getProcessedProduct,
  MerchantApiError,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  GOOGLE_IMAGE_MIN_PX,
  isGoogleReadyImage,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";
import {
  aggregateOfferStatuses,
  type OfferCheckStatus,
  type ProductPropagationStatus,
} from "@/scripts/lib/kicksdbImagePropagation";

type OfferRow = {
  offerId: string;
  contentLanguage: string;
  feedLabel: string;
  merchantId: string;
  googleImageLink: string | null;
  status: OfferCheckStatus;
  note?: string;
};

type ProductRow = {
  shopifyProductId: string;
  handle: string | null;
  shopifyFeaturedUrl: string | null;
  shopifyWidth: number | null;
  shopifyHeight: number | null;
  status: ProductPropagationStatus;
  offerCount: number;
  correctCount: number;
  pendingCount: number;
  mismatchCount: number;
  lookupFailedCount: number;
  problemOfferIds: string[];
  offers: OfferRow[];
  note?: string;
};

function stringFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function intFlag(name: string, fallback: number): number {
  const raw = stringFlag(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --${name}=${raw}`);
  return value;
}

function toProductGid(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Product/${trimmed}`;
}

function legacyId(gidOrNumeric: string): string {
  const m = gidOrNumeric.match(/(\d+)$/);
  return m?.[1] ?? gidOrNumeric;
}

function normalizeImageKey(url: string): string {
  try {
    const u = new URL(url);
    const base = (u.pathname.split("/").pop() ?? "").toLowerCase();
    return base.replace(/_[0-9]+x[0-9]+(\.[a-z0-9]+)$/i, "$1").replace(/\.[a-z0-9]+$/, "");
  } catch {
    return url.toLowerCase();
  }
}

function imagesLikelyMatch(shopifyUrl: string, googleUrl: string): boolean {
  if (shopifyUrl === googleUrl) return true;
  const a = normalizeImageKey(shopifyUrl);
  const b = normalizeImageKey(googleUrl);
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

function extractImageLink(product: Record<string, unknown>): string | null {
  const attrs = (product.productAttributes ?? product.attributes) as Record<string, unknown> | undefined;
  if (attrs) {
    for (const key of ["imageLink", "image_link", "image"]) {
      const v = attrs[key];
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  const top = product.imageLink ?? product.image_link;
  if (typeof top === "string" && top.trim()) return top.trim();
  return null;
}

async function fetchShopifyFeatured(productGid: string): Promise<{
  handle: string;
  media: ProductMediaImage | null;
} | null> {
  const result = await shopifyGraphQL<{
    product: {
      handle: string;
      featuredMedia: { id: string } | null;
      media: { nodes: ProductMediaImage[] };
    } | null;
  }>(
    `query VerifyKickdbFeatured($id: ID!) {
      product(id: $id) {
        handle
        featuredMedia { id }
        media(first: 5) {
          nodes {
            ... on MediaImage {
              id
              image { url width height }
            }
          }
        }
      }
    }`,
    { id: productGid },
    { estimatedQueryCost: 10 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const product = result.data?.product;
  if (!product) return null;
  const featuredId = product.featuredMedia?.id;
  const media =
    product.media.nodes.find((m) => m.id === featuredId) ??
    product.media.nodes.find((m) => m.image?.url) ??
    null;
  return { handle: product.handle, media };
}

async function loadTargets(limit: number, handle: string | null, fromProgress: string | null) {
  if (fromProgress) {
    const raw = await readFile(path.resolve(fromProgress), "utf8");
    const ids: string[] = [];
    for (const line of raw.split("\n")) {
      if (!line.trim()) continue;
      try {
        const row = JSON.parse(line) as { status?: string; productId?: string };
        if (row.status === "repaired_verified" && row.productId) ids.push(row.productId);
      } catch {
        /* skip */
      }
    }
    return [...new Set(ids)].slice(0, limit).map((productId) => ({
      shopifyProductId: productId,
      shopifyHandle: null as string | null,
    }));
  }

  return prisma.$queryRaw<Array<{ shopifyProductId: string; shopifyHandle: string | null }>>`
    SELECT s."shopifyProductId", s."shopifyHandle"
    FROM "public"."ShopifySyncState" s
    WHERE s."syncStatus" = 'synced'
      AND s."shopifyProductId" IS NOT NULL
      AND BTRIM(s."shopifyProductId") <> ''
      AND (${handle}::text IS NULL OR s."shopifyHandle" = ${handle})
    ORDER BY s."shopifySyncedAt" DESC NULLS LAST
    LIMIT ${limit}
  `;
}

/** All current Merchant offers for one Shopify product (every variant). */
async function lookupOffers(shopifyProductNumeric: string): Promise<
  Array<{
    offerId: string;
    contentLanguage: string;
    feedLabel: string;
    merchantId: string;
  }>
> {
  const rows = await prisma.$queryRaw<
    Array<{
      offer_id: string;
      language_code: string;
      feed_label: string;
      merchant_id: string;
    }>
  >`
    SELECT DISTINCT ON ("offer_id", "language_code", "feed_label")
      "offer_id",
      "language_code",
      "feed_label",
      "merchant_id"::text
    FROM "public"."ads_shopping_product_current"
    WHERE "is_current" = true
      AND "shopify_product_id" = ${shopifyProductNumeric}::bigint
    ORDER BY "offer_id" ASC, "language_code" ASC, "feed_label" ASC, "updated_at" DESC
  `;
  return rows.map((row) => ({
    offerId: row.offer_id,
    contentLanguage: row.language_code || "de",
    feedLabel: row.feed_label || "CH",
    merchantId: row.merchant_id || EXPLORER_DEFAULT_MERCHANT_ID,
  }));
}

async function checkOneOffer(params: {
  merchantId: string;
  offer: { offerId: string; contentLanguage: string; feedLabel: string };
  shopifyFeaturedUrl: string;
}): Promise<OfferRow> {
  const ref: MerchantProductRef = {
    offerId: params.offer.offerId,
    contentLanguage: params.offer.contentLanguage,
    feedLabel: params.offer.feedLabel,
  };
  try {
    const processed = await getProcessedProduct(params.merchantId, ref);
    const imageLink = extractImageLink(processed);
    if (!imageLink) {
      return {
        offerId: params.offer.offerId,
        contentLanguage: params.offer.contentLanguage,
        feedLabel: params.offer.feedLabel,
        merchantId: params.merchantId,
        googleImageLink: null,
        status: "pending",
        note: "processed_product_has_no_imageLink_yet",
      };
    }
    const match = imagesLikelyMatch(params.shopifyFeaturedUrl, imageLink);
    return {
      offerId: params.offer.offerId,
      contentLanguage: params.offer.contentLanguage,
      feedLabel: params.offer.feedLabel,
      merchantId: params.merchantId,
      googleImageLink: imageLink,
      status: match ? "correct" : "mismatch",
      note: match ? undefined : "cdn_or_asset_mismatch",
    };
  } catch (error) {
    const pending =
      error instanceof MerchantApiError && (error.status === 404 || error.status === 409);
    return {
      offerId: params.offer.offerId,
      contentLanguage: params.offer.contentLanguage,
      feedLabel: params.offer.feedLabel,
      merchantId: params.merchantId,
      googleImageLink: null,
      status: pending ? "pending" : "lookup_failed",
      note: error instanceof Error ? error.message.slice(0, 300) : String(error),
    };
  }
}

async function main() {
  const limit = intFlag("limit", 20);
  const handle = stringFlag("handle")?.trim() || null;
  const fromProgress = stringFlag("from-progress")?.trim() || null;
  const merchantOverride = stringFlag("merchant-id")?.trim() || null;
  const outPath = path.resolve(stringFlag("out") ?? "tmp/kicksdb-image-propagation.jsonl");
  await mkdir(path.dirname(outPath), { recursive: true });

  const targets = await loadTargets(limit, handle, fromProgress);
  const rows: ProductRow[] = [];
  const manualCheckSample: Array<Record<string, unknown>> = [];

  for (const target of targets) {
    const gid = toProductGid(target.shopifyProductId);
    const numeric = legacyId(gid);
    let shopify: Awaited<ReturnType<typeof fetchShopifyFeatured>>;
    try {
      shopify = await fetchShopifyFeatured(gid);
    } catch (error) {
      rows.push({
        shopifyProductId: gid,
        handle: target.shopifyHandle,
        shopifyFeaturedUrl: null,
        shopifyWidth: null,
        shopifyHeight: null,
        status: "SHOPIFY_INVALID",
        offerCount: 0,
        correctCount: 0,
        pendingCount: 0,
        mismatchCount: 0,
        lookupFailedCount: 0,
        problemOfferIds: [],
        offers: [],
        note: String(error),
      });
      continue;
    }

    if (!shopify?.media?.image?.url) {
      rows.push({
        shopifyProductId: gid,
        handle: shopify?.handle ?? target.shopifyHandle,
        shopifyFeaturedUrl: null,
        shopifyWidth: null,
        shopifyHeight: null,
        status: "SHOPIFY_INVALID",
        offerCount: 0,
        correctCount: 0,
        pendingCount: 0,
        mismatchCount: 0,
        lookupFailedCount: 0,
        problemOfferIds: [],
        offers: [],
        note: "missing_featured_media",
      });
      continue;
    }

    const shopifyOk = isGoogleReadyImage(shopify.media, GOOGLE_IMAGE_MIN_PX);
    if (!shopifyOk) {
      rows.push({
        shopifyProductId: gid,
        handle: shopify.handle,
        shopifyFeaturedUrl: shopify.media.image.url,
        shopifyWidth: shopify.media.image.width,
        shopifyHeight: shopify.media.image.height,
        status: "SHOPIFY_INVALID",
        offerCount: 0,
        correctCount: 0,
        pendingCount: 0,
        mismatchCount: 0,
        lookupFailedCount: 0,
        problemOfferIds: [],
        offers: [],
        note: "featured_below_500",
      });
      continue;
    }

    const offers = await lookupOffers(numeric);
    if (offers.length === 0) {
      manualCheckSample.push({
        shopifyProductId: numeric,
        handle: shopify.handle,
        shopifyFeaturedUrl: shopify.media.image.url,
        missing: "all offerIds in ads_shopping_product_current",
        suggestedSimprosysLookup: `shopify_ch_${numeric}_<variantId>`,
        merchantId: merchantOverride ?? EXPLORER_DEFAULT_MERCHANT_ID,
      });
      rows.push({
        shopifyProductId: gid,
        handle: shopify.handle,
        shopifyFeaturedUrl: shopify.media.image.url,
        shopifyWidth: shopify.media.image.width,
        shopifyHeight: shopify.media.image.height,
        status: "GOOGLE_LOOKUP_FAILED",
        offerCount: 0,
        correctCount: 0,
        pendingCount: 0,
        mismatchCount: 0,
        lookupFailedCount: 0,
        problemOfferIds: [],
        offers: [],
        note: "no_active_offers_in_ads_shopping_product_current",
      });
      continue;
    }

    const offerRows: OfferRow[] = [];
    for (const offer of offers) {
      const merchantId = merchantOverride ?? offer.merchantId;
      const checked = await checkOneOffer({
        merchantId,
        offer,
        shopifyFeaturedUrl: shopify.media.image.url,
      });
      offerRows.push(checked);
    }

    const aggregated = aggregateOfferStatuses(offerRows.map((o) => o.status));
    const problemOfferIds = offerRows
      .filter((o) => o.status !== "correct")
      .map((o) => o.offerId)
      .slice(0, 25);

    rows.push({
      shopifyProductId: gid,
      handle: shopify.handle,
      shopifyFeaturedUrl: shopify.media.image.url,
      shopifyWidth: shopify.media.image.width,
      shopifyHeight: shopify.media.image.height,
      status: aggregated.status,
      offerCount: aggregated.offerCount,
      correctCount: aggregated.correctCount,
      pendingCount: aggregated.pendingCount,
      mismatchCount: aggregated.mismatchCount,
      lookupFailedCount: aggregated.lookupFailedCount,
      problemOfferIds,
      offers: offerRows,
      note: `verified_all_active_offers=${aggregated.offerCount}`,
    });

    if (aggregated.status !== "SHOPIFY_CORRECT_GOOGLE_CORRECT") {
      manualCheckSample.push({
        shopifyProductId: numeric,
        handle: shopify.handle,
        status: aggregated.status,
        offerCount: aggregated.offerCount,
        correctCount: aggregated.correctCount,
        pendingCount: aggregated.pendingCount,
        mismatchCount: aggregated.mismatchCount,
        lookupFailedCount: aggregated.lookupFailedCount,
        problemOfferIds: problemOfferIds.slice(0, 10),
        shopifyFeaturedUrl: shopify.media.image.url,
      });
    }
  }

  await writeFile(outPath, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  const summary = {
    generatedAt: new Date().toISOString(),
    limit,
    handle,
    fromProgress,
    outPath,
    scope: "all_active_merchant_offers_per_shopify_product",
    counts: {
      SHOPIFY_CORRECT_GOOGLE_CORRECT: rows.filter((r) => r.status === "SHOPIFY_CORRECT_GOOGLE_CORRECT")
        .length,
      SHOPIFY_CORRECT_GOOGLE_PARTIAL: rows.filter((r) => r.status === "SHOPIFY_CORRECT_GOOGLE_PARTIAL")
        .length,
      SHOPIFY_CORRECT_GOOGLE_PENDING: rows.filter((r) => r.status === "SHOPIFY_CORRECT_GOOGLE_PENDING")
        .length,
      SHOPIFY_CORRECT_GOOGLE_MISMATCH: rows.filter((r) => r.status === "SHOPIFY_CORRECT_GOOGLE_MISMATCH")
        .length,
      SHOPIFY_INVALID: rows.filter((r) => r.status === "SHOPIFY_INVALID").length,
      GOOGLE_LOOKUP_FAILED: rows.filter((r) => r.status === "GOOGLE_LOOKUP_FAILED").length,
    },
    multiOfferExamples: rows
      .filter((r) => r.offerCount > 1)
      .slice(0, 5)
      .map((r) => ({
        handle: r.handle,
        status: r.status,
        offerCount: r.offerCount,
        correctCount: r.correctCount,
        pendingCount: r.pendingCount,
        mismatchCount: r.mismatchCount,
        lookupFailedCount: r.lookupFailedCount,
        problemOfferIds: r.problemOfferIds.slice(0, 8),
        sampleOfferIds: r.offers.slice(0, 5).map((o) => ({
          offerId: o.offerId,
          status: o.status,
        })),
      })),
    manualCheckSample,
    note:
      "Product CORRECT only when every active Merchant offer matches Shopify featured. Partial ≠ full validation. Read-only.",
  };
  const reportPath = path.resolve("tmp/kicksdb-image-propagation-report.json");
  await writeFile(reportPath, JSON.stringify(summary, null, 2));
  console.info(JSON.stringify({ event: "summary", ...summary, reportPath }));
  for (const row of rows.slice(0, 20)) {
    console.info(
      [
        row.status,
        row.handle ?? "",
        `offers=${row.offerCount}`,
        `ok=${row.correctCount}`,
        `pending=${row.pendingCount}`,
        `mismatch=${row.mismatchCount}`,
        `fail=${row.lookupFailedCount}`,
        row.problemOfferIds.slice(0, 3).join(",") || "-",
      ].join("\t")
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
