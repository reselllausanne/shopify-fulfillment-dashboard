#!/usr/bin/env npx tsx
/**
 * Idempotent KicksDB → Shopify hero image backfill (targeted).
 *
 * Simprosys image_link = Shopify featuredMedia (media position 0).
 *
 * Default: --only-needs-repair (scan until --limit repair candidates found).
 * Never uploads an unverified (<500px / unknown) candidate.
 * --wait refetches Shopify and verifies featured media (not just job.done).
 *
 * Usage:
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=20
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=20 --handle=air-jordan-1
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=20 --apply --confirm=REPLACE_KICKDB_HERO --wait
 */
import "dotenv/config";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/app/lib/prisma";
import {
  isKickdbThumbnailUrl,
  KICKDB_GOOGLE_MIN_PX,
  resolveCanonicalKickdbImageVerified,
  verifyKickdbImageUrl,
} from "@/galaxus/kickdb/imageResolver";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  chooseHeroRepair,
  GOOGLE_IMAGE_MIN_PX,
  isGoogleReadyImage,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";
import {
  evaluatePostWriteVerification,
  urlMatchLoose,
} from "@/scripts/lib/kicksdbShopifyPostWrite";

const APPLY_CONFIRM = "REPLACE_KICKDB_HERO";
const DEFAULT_LIMIT = 100;
const MEDIA_LIMIT = 20;
/** Scan multiplier when hunting repair candidates (bounded). */
const SCAN_CAP_MULTIPLIER = 40;
const SCAN_CAP_MIN = 200;

type ProgressStatus =
  | "dry_run"
  | "skipped_valid"
  | "refused_unverified"
  | "repaired_verified"
  | "FAILED_POST_WRITE_VERIFICATION"
  | "failed"
  | "skipped";

type ProgressRecord = {
  at: string;
  action: "reorder" | "upload_reorder" | "skip";
  productId: string;
  handle: string | null;
  kickdbProductId: string;
  status: ProgressStatus;
  reason?: string;
  oldHeroUrl?: string | null;
  oldHeroWidth?: number | null;
  oldHeroHeight?: number | null;
  candidateUrl?: string | null;
  candidateLongEdge?: number | null;
  candidateSource?: string | null;
  newHeroUrl?: string | null;
  newHeroWidth?: number | null;
  newHeroHeight?: number | null;
  jobId?: string | null;
  error?: string;
};

type ShopifyProductView = {
  handle: string;
  featuredMediaId: string | null;
  featuredUrl: string | null;
  featuredWidth: number | null;
  featuredHeight: number | null;
  media: ProductMediaImage[];
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

function boolFlag(name: string, defaultValue: boolean): boolean {
  if (hasFlag(name)) return true;
  if (hasFlag(`no-${name}`)) return false;
  const raw = stringFlag(name);
  if (raw == null) return defaultValue;
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  throw new Error(`Invalid --${name}=${raw}`);
}

function toProductGid(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Product/${trimmed}`;
}

function legacyProductId(gid: string): string {
  const m = gid.match(/Product\/(\d+)/);
  return m?.[1] ?? gid;
}

function looksLikeStockxThumbUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const lower = url.toLowerCase();
  if (!(lower.includes("stockx") || lower.includes("goat.com") || lower.includes("kick"))) {
    return isKickdbThumbnailUrl(url);
  }
  return isKickdbThumbnailUrl(url) || /[?&]w=1\d{2}\b/.test(lower) || /[?&]h=1\d{2}\b/.test(lower);
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
          if (row.status === "repaired_verified") return row.productId ? [row.productId] : [];
          return [];
        } catch {
          return [];
        }
      });
    return new Set(ids);
  } catch {
    return new Set();
  }
}

async function fetchProductView(productGid: string): Promise<ShopifyProductView | null> {
  const result = await shopifyGraphQL<{
    product: {
      handle: string;
      featuredMedia: { id: string | null } | null;
      media: { nodes: ProductMediaImage[] };
    } | null;
  }>(
    `query KickdbBackfillMedia($id: ID!) {
      product(id: $id) {
        handle
        featuredMedia { id }
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
    { estimatedQueryCost: 15 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const product = result.data?.product;
  if (!product) return null;
  const media = product.media.nodes.filter((m) => m?.image?.url);
  const featuredId = product.featuredMedia?.id ?? media[0]?.id ?? null;
  const featured = media.find((m) => m.id === featuredId) ?? media[0] ?? null;
  return {
    handle: product.handle,
    featuredMediaId: featuredId,
    featuredUrl: featured?.image?.url ?? null,
    featuredWidth: featured?.image?.width ?? null,
    featuredHeight: featured?.image?.height ?? null,
    media,
  };
}

function needsRepair(view: ShopifyProductView): { needs: boolean; reason: string } {
  if (!view.featuredUrl || view.media.length === 0) {
    return { needs: true, reason: "no_featured_media" };
  }
  const hero: ProductMediaImage = {
    id: view.featuredMediaId ?? "hero",
    image: {
      url: view.featuredUrl,
      width: view.featuredWidth,
      height: view.featuredHeight,
    },
  };
  if (!isGoogleReadyImage(hero, GOOGLE_IMAGE_MIN_PX)) {
    return { needs: true, reason: "featured_below_500" };
  }
  if (looksLikeStockxThumbUrl(view.featuredUrl)) {
    return { needs: true, reason: "featured_stockx_thumbnail" };
  }
  return { needs: false, reason: "hero_valid" };
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

async function verifyPostWrite(params: {
  productId: string;
  expectedMediaId: string;
  expectedSourceUrl: string | null;
  mode: "upload_reorder" | "reorder";
}): Promise<
  | { ok: true; view: ShopifyProductView }
  | {
      ok: false;
      reason: string;
      view: ShopifyProductView | null;
      expectedSourceUrl: string | null;
      actualFeaturedUrl: string | null;
      expectedMediaId: string;
      actualFeaturedMediaId: string | null;
      width: number | null;
      height: number | null;
    }
> {
  // Shopify media processing can lag briefly after create/reorder.
  let view: ShopifyProductView | null = null;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 500 : 1000));
    view = await fetchProductView(params.productId);
    if (!view) {
      return {
        ok: false,
        reason: "product_missing_after_write",
        view: null,
        expectedSourceUrl: params.expectedSourceUrl,
        actualFeaturedUrl: null,
        expectedMediaId: params.expectedMediaId,
        actualFeaturedMediaId: null,
        width: null,
        height: null,
      };
    }
    if (view.featuredMediaId === params.expectedMediaId) break;
  }
  if (!view) {
    return {
      ok: false,
      reason: "product_missing_after_write",
      view: null,
      expectedSourceUrl: params.expectedSourceUrl,
      actualFeaturedUrl: null,
      expectedMediaId: params.expectedMediaId,
      actualFeaturedMediaId: null,
      width: null,
      height: null,
    };
  }

  const evaluated = evaluatePostWriteVerification(view, {
    expectedMediaId: params.expectedMediaId,
    expectedSourceUrl: params.expectedSourceUrl,
    mode: params.mode,
  });
  if (!evaluated.ok) {
    console.error(
      JSON.stringify({
        event: "post_write.failed",
        reason: evaluated.reason,
        expectedSourceUrl: evaluated.expectedSourceUrl,
        actualFeaturedUrl: evaluated.actualFeaturedUrl,
        expectedMediaId: evaluated.expectedMediaId,
        actualFeaturedMediaId: evaluated.actualFeaturedMediaId,
        width: evaluated.width,
        height: evaluated.height,
        urlMatch: urlMatchLoose(evaluated.actualFeaturedUrl, evaluated.expectedSourceUrl),
      })
    );
    return { ok: false, view, ...evaluated };
  }
  return { ok: true, view };
}

async function main() {
  const apply = hasFlag("apply");
  const wait = hasFlag("wait");
  const onlyNeedsRepair = boolFlag("only-needs-repair", true);
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
    throw new Error("Refusing unbounded run — pass --limit=N");
  }

  const completed = apply ? await loadCompletedProductIds(progressPath) : new Set<string>();
  const scanCap = Math.max(limit * SCAN_CAP_MULTIPLIER, SCAN_CAP_MIN);

  const pool = await prisma.$queryRaw<
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
    LIMIT ${onlyNeedsRepair && !handleFilter ? scanCap : limit}
  `;

  const counters = {
    scanned: 0,
    resumed: 0,
    skippedValid: 0,
    refusedUnverified: 0,
    repairedVerified: 0,
    failedPostWrite: 0,
    failed: 0,
    dryRunRepairable: 0,
  };
  const examples: ProgressRecord[] = [];
  let repairSlots = 0;

  for (const row of pool) {
    if (repairSlots >= limit && onlyNeedsRepair) break;
    counters.scanned += 1;
    const productId = toProductGid(row.shopifyProductId);
    if (completed.has(productId)) {
      counters.resumed += 1;
      continue;
    }

    let view: ShopifyProductView | null;
    try {
      view = await fetchProductView(productId);
    } catch (error) {
      counters.failed += 1;
      const record: ProgressRecord = {
        at: new Date().toISOString(),
        action: "skip",
        productId,
        handle: row.shopifyHandle,
        kickdbProductId: row.kickdbProductId,
        status: "failed",
        error: String(error),
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      continue;
    }
    if (!view) {
      counters.failed += 1;
      continue;
    }

    const repair = needsRepair(view);
    if (!repair.needs) {
      counters.skippedValid += 1;
      if (!onlyNeedsRepair) {
        // still count toward limit when scanning all
        repairSlots += 1;
      }
      continue;
    }

    repairSlots += 1;

    const expected = await resolveCanonicalKickdbImageVerified(row.rawJson ?? { image: row.imageUrl }, {
      logContext: { kickdbProductId: row.kickdbProductId, mode: "backfill" },
      maxProbes: 3,
    });

    const reorderDecision = chooseHeroRepair(
      view.media,
      view.featuredMediaId,
      GOOGLE_IMAGE_MIN_PX
    );
    let action: ProgressRecord["action"] = "skip";
    let mediaIdToPromote: string | null = null;
    let candidateUrl: string | null = null;
    let candidateLongEdge: number | null = null;
    let candidateSource: string | null = null;

    if (reorderDecision.action === "reorder") {
      action = "reorder";
      mediaIdToPromote = reorderDecision.newHero.id;
      candidateUrl = reorderDecision.newHero.image?.url ?? null;
      candidateLongEdge = Math.max(
        Number(reorderDecision.newHero.image?.width ?? 0),
        Number(reorderDecision.newHero.image?.height ?? 0)
      );
      candidateSource = "shopify_gallery";
    } else if (expected.url) {
      const verified = await verifyKickdbImageUrl(expected.url, { minPx: KICKDB_GOOGLE_MIN_PX });
      if (!verified.ok) {
        counters.refusedUnverified += 1;
        const record: ProgressRecord = {
          at: new Date().toISOString(),
          action: "skip",
          productId,
          handle: view.handle,
          kickdbProductId: row.kickdbProductId,
          status: "refused_unverified",
          reason: verified.reason || "IMAGE_DIMENSIONS_UNVERIFIED",
          oldHeroUrl: view.featuredUrl,
          oldHeroWidth: view.featuredWidth,
          oldHeroHeight: view.featuredHeight,
          candidateUrl: verified.url,
          candidateLongEdge: verified.longEdge,
          candidateSource: verified.source,
        };
        await appendFile(progressPath, `${JSON.stringify(record)}\n`);
        if (examples.length < 40) examples.push(record);
        console.info(
          JSON.stringify({
            event: "decision",
            handle: view.handle,
            shopify: `${view.featuredWidth ?? "?"}x${view.featuredHeight ?? "?"}`,
            candidate: verified.url,
            candidateEdge: verified.longEdge,
            decision: "refused_unverified",
            reason: verified.reason,
          })
        );
        continue;
      }
      action = "upload_reorder";
      candidateUrl = verified.url;
      candidateLongEdge = verified.longEdge;
      candidateSource = verified.source;
    } else {
      counters.refusedUnverified += 1;
      const record: ProgressRecord = {
        at: new Date().toISOString(),
        action: "skip",
        productId,
        handle: view.handle,
        kickdbProductId: row.kickdbProductId,
        status: "refused_unverified",
        reason: expected.reason || "IMAGE_DIMENSIONS_UNVERIFIED",
        oldHeroUrl: view.featuredUrl,
        oldHeroWidth: view.featuredWidth,
        oldHeroHeight: view.featuredHeight,
        candidateUrl: null,
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      if (examples.length < 40) examples.push(record);
      console.info(
        JSON.stringify({
          event: "decision",
          handle: view.handle,
          shopify: `${view.featuredWidth ?? "?"}x${view.featuredHeight ?? "?"}`,
          decision: "refused_unverified",
          reason: expected.reason,
        })
      );
      continue;
    }

    const base: ProgressRecord = {
      at: new Date().toISOString(),
      action,
      productId,
      handle: view.handle,
      kickdbProductId: row.kickdbProductId,
      status: apply ? "failed" : "dry_run",
      reason: repair.reason,
      oldHeroUrl: view.featuredUrl,
      oldHeroWidth: view.featuredWidth,
      oldHeroHeight: view.featuredHeight,
      candidateUrl,
      candidateLongEdge,
      candidateSource,
      newHeroUrl: candidateUrl,
    };

    console.info(
      JSON.stringify({
        event: "decision",
        handle: view.handle,
        productId: legacyProductId(productId),
        shopifyImage: view.featuredUrl,
        shopifyDims: `${view.featuredWidth ?? "?"}x${view.featuredHeight ?? "?"}`,
        kickdbCandidate: candidateUrl,
        candidateLongEdge,
        candidateSource,
        action,
        decision: apply ? "apply" : "dry_run",
      })
    );

    if (!apply) {
      counters.dryRunRepairable += 1;
      base.status = "dry_run";
      await appendFile(progressPath, `${JSON.stringify(base)}\n`);
      if (examples.length < 40) examples.push(base);
      continue;
    }

    try {
      let promoteId = mediaIdToPromote;
      if (action === "upload_reorder") {
        if (!candidateUrl) throw new Error("missing candidate url");
        promoteId = await createMediaFromUrl(productId, candidateUrl);
      }
      if (!promoteId) throw new Error("missing media id to promote");
      const { jobId } = await reorderMedia(productId, promoteId);
      if (wait && jobId) await waitForJob(jobId);

      if (!wait) {
        // Without --wait we refuse to claim repaired — only submitted pending verify.
        const record: ProgressRecord = {
          ...base,
          jobId,
          status: "FAILED_POST_WRITE_VERIFICATION",
          reason: "wait_required_for_verification",
          error: "Pass --wait to verify featuredMedia after mutation",
        };
        counters.failedPostWrite += 1;
        await appendFile(progressPath, `${JSON.stringify(record)}\n`);
        if (examples.length < 40) examples.push(record);
        continue;
      }

      const verified = await verifyPostWrite({
        productId,
        expectedMediaId: promoteId,
        expectedSourceUrl: candidateUrl,
        mode: action === "upload_reorder" ? "upload_reorder" : "reorder",
      });
      if (!verified.ok) {
        counters.failedPostWrite += 1;
        const record: ProgressRecord = {
          ...base,
          jobId,
          status: "FAILED_POST_WRITE_VERIFICATION",
          reason: verified.reason,
          newHeroUrl: verified.actualFeaturedUrl ?? verified.view?.featuredUrl ?? null,
          newHeroWidth: verified.width ?? verified.view?.featuredWidth ?? null,
          newHeroHeight: verified.height ?? verified.view?.featuredHeight ?? null,
          error: [
            verified.reason,
            `expectedMediaId=${verified.expectedMediaId}`,
            `actualFeaturedMediaId=${verified.actualFeaturedMediaId ?? "null"}`,
            `expectedSourceUrl=${verified.expectedSourceUrl ?? "null"}`,
            `actualFeaturedUrl=${verified.actualFeaturedUrl ?? "null"}`,
            `dims=${verified.width ?? "?"}x${verified.height ?? "?"}`,
          ].join(" | "),
        };
        await appendFile(progressPath, `${JSON.stringify(record)}\n`);
        if (examples.length < 40) examples.push(record);
        continue;
      }

      counters.repairedVerified += 1;
      const record: ProgressRecord = {
        ...base,
        jobId,
        status: "repaired_verified",
        newHeroUrl: verified.view.featuredUrl,
        newHeroWidth: verified.view.featuredWidth,
        newHeroHeight: verified.view.featuredHeight,
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      if (examples.length < 40) examples.push(record);
    } catch (error) {
      counters.failed += 1;
      const record: ProgressRecord = {
        ...base,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      if (examples.length < 40) examples.push(record);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    wait,
    onlyNeedsRepair,
    limit,
    handle: handleFilter,
    brand: brandFilter,
    minPx: KICKDB_GOOGLE_MIN_PX,
    scanned: counters.scanned,
    resumed: counters.resumed,
    skippedValid: counters.skippedValid,
    refusedUnverified: counters.refusedUnverified,
    repairedVerified: counters.repairedVerified,
    failedPostWrite: counters.failedPostWrite,
    failed: counters.failed,
    dryRunRepairable: counters.dryRunRepairable,
    progressPath,
    examples,
    buckets: {
      "skipped-valid": counters.skippedValid,
      "repaired-verified": counters.repairedVerified,
      "refused-unverified": counters.refusedUnverified,
      failed: counters.failed + counters.failedPostWrite,
      "dry-run-repairable": counters.dryRunRepairable,
    },
    guarantees: [
      "No price/stock/GTIN/title/ID changes.",
      "Valid ≥500×500 heroes are left untouched.",
      "Unknown/unverified candidate → refused (never wipe Shopify media).",
      "--wait refetches featuredMedia and requires ≥500px before counting repaired.",
      "Default --only-needs-repair hunts broken heroes (not last-N synced).",
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
