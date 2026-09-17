#!/usr/bin/env npx tsx
/**
 * Idempotent KicksDB → Shopify hero image backfill.
 *
 * Simprosys image_link = Shopify featuredMedia (media position 0).
 * For each synced KickDB product:
 *   1. If hero already ≥500×500 → skip
 *   2. Else if gallery already has HD → reorder only
 *   3. Else if canonical KickDB HD URL exists → productCreateMedia + reorder to 0
 *   4. Else → skip (never overwrite a good Shopify image with nothing)
 *
 * Does NOT change price, stock, GTIN, title, or product IDs.
 * Does NOT auto-scan the full catalog — require an explicit --limit.
 *
 * Usage (dry-run default):
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=100
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=100 --apply --confirm=REPLACE_KICKDB_HERO
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=100 --apply --confirm=REPLACE_KICKDB_HERO --wait
 *
 * Resume: progress JSONL skips already-processed product IDs.
 *   --progress=tmp/kicksdb-image-backfill-progress.jsonl
 */
import "dotenv/config";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/app/lib/prisma";
import { resolveCanonicalKickdbImage } from "@/galaxus/kickdb/imageResolver";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  chooseHeroRepair,
  GOOGLE_IMAGE_MIN_PX,
  isGoogleReadyImage,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";

const APPLY_CONFIRM = "REPLACE_KICKDB_HERO";
const DEFAULT_LIMIT = 100;
const MEDIA_LIMIT = 20;

type ProgressRecord = {
  at: string;
  action: "reorder" | "upload_reorder" | "skip";
  productId: string;
  handle: string | null;
  kickdbProductId: string;
  status: "submitted" | "complete" | "failed" | "dry_run" | "skipped";
  reason?: string;
  oldHeroUrl?: string | null;
  newHeroUrl?: string | null;
  jobId?: string | null;
  error?: string;
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

function hasFlag(name: string): boolean {
  return process.argv.slice(2).includes(`--${name}`);
}

function toProductGid(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Product/${trimmed}`;
}

async function loadCompletedProductIds(progressPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(progressPath, "utf8");
    const ids = raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as ProgressRecord;
          if (row.status === "failed" || row.status === "skipped" || row.status === "dry_run") {
            return [];
          }
          return row.productId ? [row.productId] : [];
        } catch {
          return [];
        }
      });
    return new Set(ids);
  } catch {
    return new Set();
  }
}

async function fetchProductMedia(productGid: string): Promise<{
  handle: string;
  media: ProductMediaImage[];
} | null> {
  const result = await shopifyGraphQL<{
    product: { handle: string; media: { nodes: ProductMediaImage[] } } | null;
  }>(
    `query KickdbBackfillMedia($id: ID!) {
      product(id: $id) {
        handle
        media(first: ${MEDIA_LIMIT}) {
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
    { estimatedQueryCost: 12 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const product = result.data?.product;
  if (!product) return null;
  return { handle: product.handle, media: product.media.nodes };
}

async function reorderMedia(productId: string, mediaId: string): Promise<{ jobId: string | null }> {
  const result = await shopifyGraphQL<{
    productReorderMedia: {
      job: { id: string } | null;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    `mutation ReorderProductMedia($id: ID!, $moves: [MoveInput!]!) {
      productReorderMedia(id: $id, moves: $moves) {
        job { id }
        mediaUserErrors { field message }
      }
    }`,
    { id: productId, moves: [{ id: mediaId, newPosition: "0" }] },
    { estimatedQueryCost: 10 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const errors = result.data?.productReorderMedia?.mediaUserErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  return { jobId: result.data?.productReorderMedia?.job?.id ?? null };
}

async function createMediaFromUrl(productId: string, url: string): Promise<string> {
  const result = await shopifyGraphQL<{
    productCreateMedia: {
      media: Array<{ id: string | null; status: string } | null>;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    `mutation CreateKickdbHero($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id status }
        mediaUserErrors { field message }
      }
    }`,
    {
      productId,
      media: [{ originalSource: url, mediaContentType: "IMAGE" }],
    },
    { estimatedQueryCost: 15 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const errors = result.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  const mediaId = result.data?.productCreateMedia?.media?.find((m) => m?.id)?.id;
  if (!mediaId) throw new Error("productCreateMedia returned no media id");
  return mediaId;
}

async function waitForJob(jobId: string): Promise<"complete" | "failed"> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await shopifyGraphQL<{ job: { done: boolean } | null }>(
      `query MediaReorderJob($id: ID!) { job(id: $id) { id done } }`,
      { id: jobId },
      { estimatedQueryCost: 2 }
    );
    if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
    if (!result.data?.job) return "failed";
    if (result.data.job.done) return "complete";
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "failed";
}

async function main() {
  const apply = hasFlag("apply");
  const wait = hasFlag("wait");
  const limit = intFlag("limit", DEFAULT_LIMIT);
  const confirm = stringFlag("confirm");
  const handleFilter = stringFlag("handle")?.trim() || null;
  const brandFilter = stringFlag("brand")?.trim() || null;
  const progressPath = path.resolve(
    stringFlag("progress") ?? "tmp/kicksdb-image-backfill-progress.jsonl"
  );
  await mkdir(path.dirname(progressPath), { recursive: true });

  if (apply && confirm !== APPLY_CONFIRM) {
    throw new Error(`Apply requires --confirm=${APPLY_CONFIRM}`);
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("Refusing unbounded run — pass --limit=N (start with 100)");
  }

  const completed = apply ? await loadCompletedProductIds(progressPath) : new Set<string>();

  const candidates = await prisma.$queryRaw<
    Array<{
      kickdbProductId: string;
      shopifyProductId: string;
      shopifyHandle: string | null;
      imageUrl: string | null;
      rawJson: unknown;
    }>
  >`
    SELECT
      p."kickdbProductId",
      s."shopifyProductId",
      s."shopifyHandle",
      p."imageUrl",
      p."rawJson"
    FROM "public"."ShopifySyncState" s
    INNER JOIN "public"."KickDBProduct" p
      ON p."kickdbProductId" = s."kickdbProductId"
    WHERE s."syncStatus" = 'synced'
      AND s."shopifyProductId" IS NOT NULL
      AND BTRIM(s."shopifyProductId") <> ''
      AND p."notFound" = false
      AND (${handleFilter}::text IS NULL OR s."shopifyHandle" = ${handleFilter})
      AND (${brandFilter}::text IS NULL OR p."brand" ILIKE ${brandFilter})
    ORDER BY s."shopifySyncedAt" DESC NULLS LAST, s."updatedAt" DESC
    LIMIT ${limit}
  `;

  let scanned = 0;
  let skippedValid = 0;
  let skippedNoFix = 0;
  let resumed = 0;
  let candidatesFix = 0;
  let submitted = 0;
  let failed = 0;
  const examples: ProgressRecord[] = [];

  for (const row of candidates) {
    scanned += 1;
    const productId = toProductGid(row.shopifyProductId);
    if (completed.has(productId)) {
      resumed += 1;
      continue;
    }

    const expected = resolveCanonicalKickdbImage(row.rawJson ?? { image: row.imageUrl }, {
      logContext: { kickdbProductId: row.kickdbProductId, mode: "backfill" },
    });

    let shopify: Awaited<ReturnType<typeof fetchProductMedia>>;
    try {
      shopify = await fetchProductMedia(productId);
    } catch (error) {
      failed += 1;
      const record: ProgressRecord = {
        at: new Date().toISOString(),
        action: "skip",
        productId,
        handle: row.shopifyHandle,
        kickdbProductId: row.kickdbProductId,
        status: "failed",
        error: String(error),
      };
      if (apply) await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      continue;
    }
    if (!shopify) {
      skippedNoFix += 1;
      continue;
    }

    const hero = shopify.media.find((m) => m.image?.url);
    if (hero && isGoogleReadyImage(hero, GOOGLE_IMAGE_MIN_PX)) {
      skippedValid += 1;
      continue;
    }

    const reorderDecision = chooseHeroRepair(shopify.media, GOOGLE_IMAGE_MIN_PX);
    let action: ProgressRecord["action"] = "skip";
    let newHeroUrl: string | null = expected.url;
    let mediaIdToPromote: string | null = null;

    if (reorderDecision.action === "reorder") {
      action = "reorder";
      mediaIdToPromote = reorderDecision.newHero.id;
      newHeroUrl = reorderDecision.newHero.image?.url ?? null;
    } else if (expected.url) {
      action = "upload_reorder";
      newHeroUrl = expected.url;
    } else {
      skippedNoFix += 1;
      const record: ProgressRecord = {
        at: new Date().toISOString(),
        action: "skip",
        productId,
        handle: shopify.handle,
        kickdbProductId: row.kickdbProductId,
        status: "skipped",
        reason: "no_valid_replacement",
        oldHeroUrl: hero?.image?.url ?? null,
      };
      if (apply) await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      if (examples.length < 30) examples.push(record);
      continue;
    }

    candidatesFix += 1;
    const base: ProgressRecord = {
      at: new Date().toISOString(),
      action,
      productId,
      handle: shopify.handle,
      kickdbProductId: row.kickdbProductId,
      status: apply ? "submitted" : "dry_run",
      oldHeroUrl: hero?.image?.url ?? null,
      newHeroUrl,
    };
    if (examples.length < 30) examples.push(base);

    if (!apply) continue;

    try {
      let promoteId = mediaIdToPromote;
      if (action === "upload_reorder") {
        if (!expected.url) throw new Error("missing expected url");
        promoteId = await createMediaFromUrl(productId, expected.url);
      }
      if (!promoteId) throw new Error("missing media id to promote");
      const { jobId } = await reorderMedia(productId, promoteId);
      const status = wait && jobId ? await waitForJob(jobId) : "submitted";
      const record: ProgressRecord = { ...base, jobId, status };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      submitted += 1;
    } catch (error) {
      failed += 1;
      const record: ProgressRecord = {
        ...base,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    wait,
    limit,
    handle: handleFilter,
    brand: brandFilter,
    scanned,
    resumed,
    skippedValid,
    skippedNoFix,
    candidatesFix,
    submitted,
    failed,
    progressPath,
    examples,
    guarantees: [
      "No price/stock/GTIN/title/ID changes.",
      "Valid ≥500×500 heroes are left untouched.",
      "No compliant KickDB image → skip (never wipe Shopify media).",
      "Idempotent via progress JSONL; bounded by --limit (default 100).",
    ],
    launchPlan: [
      "1) Dry-run 100: npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=100",
      "2) Review tmp report / examples",
      "3) Apply 100: npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=100 --apply --confirm=REPLACE_KICKDB_HERO --wait",
      "4) Audit: npx tsx scripts/audit-kicksdb-shopify-images.ts --limit=100",
      "5) Only then raise --limit in batches (never unbounded)",
    ],
  };
  const reportPath = path.resolve("tmp/kicksdb-image-backfill-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ event: "summary", ...report, examples: undefined, reportPath }));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
