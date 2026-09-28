#!/usr/bin/env npx tsx
/**
 * Idempotent KicksDB → Shopify hero image backfill (targeted).
 *
 * Simprosys image_link = Shopify featuredMedia (media position 0).
 *
 * Default: --only-needs-repair (scan until --limit repair candidates found).
 * Never uploads an unverified (<500px / unknown) candidate.
 * Uploads are re-encoded to real WebP bytes (not a .webp name over JPEG),
 * copy the previous featured alt, then delete leftover <500px media.
 * --wait refetches Shopify and verifies featured media (not just job.done).
 *
 * Usage:
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=20
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=5000 --concurrency=4
 *   npx tsx scripts/backfill-kicksdb-shopify-images.ts --limit=5000 --concurrency=4 --apply --confirm=REPLACE_KICKDB_HERO --wait
 * Resume: same command. Already repaired_verified product IDs in the progress file are skipped.
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
import { setShopifyGraphQLConcurrency, shopifyGraphQL } from "@/lib/shopifyAdmin";
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
import { buildImageAlt, encodeHeroWebp, smallMediaIdsToDelete } from "@/scripts/lib/kickdbHeroWebp";

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
  featuredAlt: string | null;
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

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|network|P1017|closed the connection|Timed out fetching a new connection|status 503|status 502|status 429/i.test(
    message
  );
}

async function withTransientRetry<T>(
  label: string,
  fn: () => Promise<T>,
  attempts = 4
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) throw error;
      const waitMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
      console.warn(
        JSON.stringify({
          event: "transient_retry",
          label,
          attempt,
          waitMs,
          error: error instanceof Error ? error.message : String(error),
        })
      );
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
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

async function loadKickdbImageSource(
  kickdbProductId: string
): Promise<{ imageUrl: string | null; rawJson: unknown }> {
  const query = () => prisma.$queryRaw<Array<{ imageUrl: string | null; rawJson: unknown }>>`
    SELECT p."imageUrl", p."rawJson"
    FROM "public"."KickDBProduct" p
    WHERE p."kickdbProductId" = ${kickdbProductId}
    LIMIT 1
  `;
  let rows: Array<{ imageUrl: string | null; rawJson: unknown }>;
  try {
    rows = await query();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/closed the connection|P1017|kind: Closed/i.test(message)) throw error;
    await new Promise((resolve) => setTimeout(resolve, 750));
    rows = await query();
  }
  return rows[0] ?? { imageUrl: null, rawJson: null };
}

async function fetchProductView(productGid: string): Promise<ShopifyProductView | null> {
  const result = await shopifyGraphQL<{
    product: {
      handle: string;
      featuredMedia: { id: string | null } | null;
      media: {
        nodes: Array<{
          id: string;
          alt: string | null;
          image: { url: string; width: number | null; height: number | null; altText: string | null } | null;
        }>;
      };
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
              alt
              image { url width height altText }
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
  const media = product.media.nodes
    .filter((m) => m?.image?.url)
    .map((m) => ({
      id: m.id,
      image: m.image
        ? { url: m.image.url, width: m.image.width, height: m.image.height }
        : null,
    }));
  const featuredId = product.featuredMedia?.id ?? media[0]?.id ?? null;
  const featuredNode = product.media.nodes.find((m) => m.id === featuredId) ?? product.media.nodes[0] ?? null;
  const featured = media.find((m) => m.id === featuredId) ?? media[0] ?? null;
  return {
    handle: product.handle,
    featuredMediaId: featuredId,
    featuredUrl: featured?.image?.url ?? null,
    featuredWidth: featured?.image?.width ?? null,
    featuredHeight: featured?.image?.height ?? null,
    featuredAlt: featuredNode?.alt?.trim() || featuredNode?.image?.altText?.trim() || null,
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

async function downloadCandidate(url: string): Promise<Buffer> {
  return withTransientRetry(`download:${url.slice(0, 80)}`, async () => {
    const headers: Record<string, string> = {
      "User-Agent": "Mozilla/5.0 (compatible; ResellImageProbe/1.0)",
      Accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
    };
    if (url.includes("stockx") || url.includes("goat.com")) headers.Referer = "https://stockx.com/";
    const response = await fetch(url, { redirect: "follow", headers });
    if (!response.ok) throw new Error(`candidate_download_${response.status}`);
    const buf = Buffer.from(await response.arrayBuffer());
    if (buf.byteLength < 32) throw new Error("candidate_download_empty");
    if (buf.byteLength > 12_000_000) throw new Error("candidate_download_too_large");
    return buf;
  });
}

function webpFilename(handle: string | null): string {
  const base = (handle || "hero")
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 80);
  return `${base || "hero"}.webp`;
}

/** Download candidate, re-encode to real WebP, staged-upload, attach with previous alt. */
async function createWebpMedia(params: {
  productId: string;
  sourceUrl: string;
  alt: string | null;
  handle: string | null;
}): Promise<string> {
  const raw = await downloadCandidate(params.sourceUrl);
  const encoded = await encodeHeroWebp(raw);
  const filename = webpFilename(params.handle);
  const mime = "image/webp";

  const staged = await shopifyGraphQL<{
    stagedUploadsCreate: {
      stagedTargets: Array<{
        url: string;
        resourceUrl: string;
        parameters: Array<{ name: string; value: string }>;
      }>;
      userErrors: Array<{ message: string }>;
    };
  }>(
    `mutation KickdbStagedWebp($input: [StagedUploadInput!]!) {
      stagedUploadsCreate(input: $input) {
        stagedTargets { url resourceUrl parameters { name value } }
        userErrors { field message }
      }
    }`,
    {
      input: [
        {
          resource: "IMAGE",
          filename,
          mimeType: mime,
          httpMethod: "POST",
          fileSize: String(encoded.bytes),
        },
      ],
    },
    { estimatedQueryCost: 10 }
  );
  if (staged.errors?.length) throw new Error(staged.errors.map((e) => e.message).join("; "));
  const stagedErrors = staged.data?.stagedUploadsCreate?.userErrors ?? [];
  if (stagedErrors.length) throw new Error(stagedErrors.map((e) => e.message).join("; "));
  const target = staged.data?.stagedUploadsCreate?.stagedTargets?.[0];
  if (!target?.url || !target.resourceUrl) throw new Error("staged_upload_missing_target");

  const form = new FormData();
  for (const parameter of target.parameters) form.append(parameter.name, parameter.value);
  form.append("file", new Blob([new Uint8Array(encoded.buffer)], { type: mime }), filename);
  const uploaded = await fetch(target.url, { method: "POST", body: form });
  if (!uploaded.ok) {
    throw new Error(`staged_upload_http_${uploaded.status}`);
  }

  const created = await shopifyGraphQL<{
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
      productId: params.productId,
      media: [
        {
          originalSource: target.resourceUrl,
          mediaContentType: "IMAGE",
          alt: params.alt,
        },
      ],
    },
    { estimatedQueryCost: 15 }
  );
  if (created.errors?.length) throw new Error(created.errors.map((e) => e.message).join("; "));
  const errors = created.data?.productCreateMedia?.mediaUserErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
  const mediaId = created.data?.productCreateMedia?.media?.find((m) => m?.id)?.id;
  if (!mediaId) throw new Error("productCreateMedia returned no media id");
  return mediaId;
}

function isWebpMagic(buf: Buffer): boolean {
  return buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP";
}

async function assertCdnIsWebp(url: string): Promise<void> {
  const head = await fetch(url, { method: "HEAD", redirect: "follow" });
  const headType = (head.headers.get("content-type") ?? "").split(";")[0]?.trim().toLowerCase() ?? "";
  if (head.ok && headType === "image/webp") return;

  const response = await fetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { Range: "bytes=0-15", Accept: "image/webp,image/*,*/*" },
  });
  if (!response.ok && response.status !== 206) throw new Error(`featured_get_${response.status}`);
  const buf = Buffer.from(await response.arrayBuffer());
  if (isWebpMagic(buf)) return;
  const sniffed = (response.headers.get("content-type") ?? headType).split(";")[0]?.trim().toLowerCase() ?? "";
  throw new Error(`featured_not_webp:${sniffed || "missing"}:${buf.subarray(0, 4).toString("hex")}`);
}

async function deleteSmallMedia(productId: string, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  const result = await shopifyGraphQL<{
    productDeleteMedia: {
      deletedMediaIds: string[] | null;
      mediaUserErrors: Array<{ message: string }>;
    };
  }>(
    `mutation DeleteSmallKickdbMedia($productId: ID!, $mediaIds: [ID!]!) {
      productDeleteMedia(productId: $productId, mediaIds: $mediaIds) {
        deletedMediaIds
        mediaUserErrors { field message }
      }
    }`,
    { productId, mediaIds },
    { estimatedQueryCost: 10 }
  );
  if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
  const errors = result.data?.productDeleteMedia?.mediaUserErrors ?? [];
  if (errors.length) throw new Error(errors.map((e) => e.message).join("; "));
}

async function verifyPostWrite(params: {
  productId: string;
  expectedMediaId: string;
  expectedSourceUrl: string | null;
  mode: "upload_reorder" | "staged_webp" | "reorder";
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
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((r) => setTimeout(r, attempt === 0 ? 150 : 300));
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
  const offsetRaw = stringFlag("offset");
  const sqlOffset = offsetRaw != null ? Math.max(0, Number.parseInt(offsetRaw, 10) || 0) : 0;
  if (offsetRaw != null && (!Number.isFinite(sqlOffset) || sqlOffset < 0)) {
    throw new Error(`Invalid --offset=${offsetRaw}`);
  }
  const progressPath = path.resolve(
    stringFlag("progress") ?? "tmp/kicksdb-image-backfill-progress.jsonl"
  );
  await mkdir(path.dirname(progressPath), { recursive: true });
  let progressWrite: Promise<void> = Promise.resolve();
  const writeProgress = (record: ProgressRecord): Promise<void> => {
    const run = progressWrite.then(() => appendFile(progressPath, `${JSON.stringify(record)}\n`));
    progressWrite = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  if (apply && confirm !== APPLY_CONFIRM) {
    throw new Error(`Apply requires --confirm=${APPLY_CONFIRM}`);
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error("Refusing unbounded run — pass --limit=N");
  }

  const completed = apply ? await loadCompletedProductIds(progressPath) : new Set<string>();
  const scanCap = Math.min(15_000, Math.max(limit * 3, SCAN_CAP_MIN));
  const productIdsFile = stringFlag("product-ids-file")?.trim() || null;

  let pool: Array<{
    kickdbProductId: string;
    shopifyProductId: string;
    shopifyHandle: string | null;
    productName: string | null;
    brand: string | null;
  }> = [];

  if (productIdsFile) {
    const rawIds = JSON.parse(await readFile(path.resolve(productIdsFile), "utf8")) as unknown;
    if (!Array.isArray(rawIds)) throw new Error("--product-ids-file must be a JSON string array");
    const pending = rawIds
      .map((id) => String(id).trim())
      .filter(Boolean)
      .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`))
      .filter((gid) => !completed.has(gid));
    const slice = pending.slice(sqlOffset, sqlOffset + Math.max(limit, scanCap));
    const numericIds = slice.map((gid) => legacyProductId(gid));
    const byNumeric = new Map<string, (typeof pool)[number]>();
    const chunkSize = 500;
    for (let i = 0; i < numericIds.length; i += chunkSize) {
      const chunk = numericIds.slice(i, i + chunkSize);
      const rows = await prisma.$queryRaw<
        Array<{
          kickdbProductId: string;
          shopifyProductId: string;
          shopifyHandle: string | null;
          productName: string | null;
          brand: string | null;
        }>
      >`
        SELECT
          p."kickdbProductId",
          s."shopifyProductId",
          s."shopifyHandle",
          p."name" AS "productName",
          p."brand"
        FROM "public"."ShopifySyncState" s
        INNER JOIN "public"."KickDBProduct" p
          ON p."kickdbProductId" = s."kickdbProductId"
        WHERE s."shopifyProductId" = ANY(${chunk})
           OR regexp_replace(s."shopifyProductId", '^gid://shopify/Product/', '') = ANY(${chunk})
      `;
      for (const row of rows) {
        byNumeric.set(legacyProductId(row.shopifyProductId), row);
      }
    }
    pool = slice.map((gid) => {
      const numeric = legacyProductId(gid);
      return (
        byNumeric.get(numeric) ?? {
          kickdbProductId: `merchant-only:${numeric}`,
          shopifyProductId: gid,
          shopifyHandle: null,
          productName: null,
          brand: null,
        }
      );
    });
    console.info(
      JSON.stringify({
        event: "product_ids_file_loaded",
        file: productIdsFile,
        pending: pending.length,
        offset: sqlOffset,
        pool: pool.length,
        withKickdb: [...byNumeric.keys()].length,
      })
    );
  } else {
    pool = await prisma.$queryRaw<
      Array<{
        kickdbProductId: string;
        shopifyProductId: string;
        shopifyHandle: string | null;
        productName: string | null;
        brand: string | null;
      }>
    >`
      SELECT
        p."kickdbProductId",
        s."shopifyProductId",
        s."shopifyHandle",
        p."name" AS "productName",
        p."brand"
      FROM "public"."ShopifySyncState" s
      INNER JOIN "public"."KickDBProduct" p
        ON p."kickdbProductId" = s."kickdbProductId"
      WHERE s."syncStatus" = 'synced'
        AND s."shopifyProductId" IS NOT NULL
        AND BTRIM(s."shopifyProductId") <> ''
        AND p."notFound" = false
        AND (${handleFilter}::text IS NULL OR s."shopifyHandle" = ${handleFilter})
        AND (${brandFilter}::text IS NULL OR p."brand" ILIKE ${brandFilter})
      ORDER BY s."shopifySyncedAt" ASC NULLS FIRST, s."updatedAt" ASC
      LIMIT ${onlyNeedsRepair && !handleFilter ? scanCap : limit}
      OFFSET ${handleFilter ? 0 : sqlOffset}
    `;
  }

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

  const concurrency = Math.min(12, Math.max(1, intFlag("concurrency", 8)));
  setShopifyGraphQLConcurrency(Math.min(6, concurrency));
  let nextIndex = 0;
  let consecutiveFetchFails = 0;
  const FETCH_FAIL_ABORT = 40;
  let abortedForFetchStorm = false;

  async function worker(): Promise<void> {
    while (true) {
    if (abortedForFetchStorm) return;
    if (repairSlots >= limit && onlyNeedsRepair) return;
    const index = nextIndex;
    nextIndex += 1;
    if (index >= pool.length) return;
    const row = pool[index];
    counters.scanned += 1;
    const productId = toProductGid(row.shopifyProductId);
    if (completed.has(productId)) {
      counters.resumed += 1;
      continue;
    }

    let view: ShopifyProductView | null;
    try {
      view = await withTransientRetry(`productView:${productId}`, () => fetchProductView(productId));
      consecutiveFetchFails = 0;
    } catch (error) {
      counters.failed += 1;
      consecutiveFetchFails += 1;
      // Transient storm: do NOT write failed to progress — resume would skip nothing,
      // but bloating 60k failed lines burns disk and hides real failures.
      if (!isTransientNetworkError(error)) {
        const record: ProgressRecord = {
          at: new Date().toISOString(),
          action: "skip",
          productId,
          handle: row.shopifyHandle,
          kickdbProductId: row.kickdbProductId,
          status: "failed",
          error: String(error),
        };
        await writeProgress(record);
      } else {
        console.warn(
          JSON.stringify({
            event: "fetch_failed_no_progress",
            productId,
            handle: row.shopifyHandle,
            error: String(error),
          })
        );
      }
      if (consecutiveFetchFails >= FETCH_FAIL_ABORT) {
        abortedForFetchStorm = true;
        console.error(
          JSON.stringify({
            event: "abort_fetch_storm",
            consecutiveFetchFails,
            message: "Shopify/network fetch storm — stop before burning full catalog",
          })
        );
        return;
      }
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

    let source: { imageUrl: string | null; rawJson: unknown };
    try {
      if (row.kickdbProductId.startsWith("merchant-only:")) {
        source = { imageUrl: null, rawJson: null };
      } else {
        source = await loadKickdbImageSource(row.kickdbProductId);
      }
    } catch (error) {
      counters.failed += 1;
      const record: ProgressRecord = {
        at: new Date().toISOString(),
        action: "skip",
        productId,
        handle: view.handle,
        kickdbProductId: row.kickdbProductId,
        status: "failed",
        reason: repair.reason,
        error: error instanceof Error ? error.message : String(error),
      };
      await writeProgress(record);
      continue;
    }
    const expected = await resolveCanonicalKickdbImageVerified(source.rawJson ?? { image: source.imageUrl }, {
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
        await writeProgress(record);
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
      await writeProgress(record);
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
      await writeProgress(base);
      if (examples.length < 40) examples.push(base);
      continue;
    }

    try {
      let promoteId = mediaIdToPromote;
      if (action === "upload_reorder") {
        if (!candidateUrl) throw new Error("missing candidate url");
        promoteId = await createWebpMedia({
          productId,
          sourceUrl: candidateUrl,
        alt: view.featuredAlt || buildImageAlt(row.productName || view.handle, row.brand),
          handle: view.handle,
        });
      }
      if (!promoteId) throw new Error("missing media id to promote");
      const { jobId } = await reorderMedia(productId, promoteId);

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
        await writeProgress(record);
        if (examples.length < 40) examples.push(record);
        continue;
      }

      const verified = await verifyPostWrite({
        productId,
        expectedMediaId: promoteId,
        expectedSourceUrl: candidateUrl,
        mode: action === "upload_reorder" ? "staged_webp" : "reorder",
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
        await writeProgress(record);
        if (examples.length < 40) examples.push(record);
        continue;
      }

      if (action === "upload_reorder") {
        if (!verified.view.featuredUrl) throw new Error("featured_url_missing_after_write");
        await assertCdnIsWebp(verified.view.featuredUrl);
      }
      const smallIds = smallMediaIdsToDelete(verified.view.media, promoteId);
      await deleteSmallMedia(productId, smallIds);

      counters.repairedVerified += 1;
      const record: ProgressRecord = {
        ...base,
        jobId,
        status: "repaired_verified",
        newHeroUrl: verified.view.featuredUrl,
        newHeroWidth: verified.view.featuredWidth,
        newHeroHeight: verified.view.featuredHeight,
      };
      await writeProgress(record);
      if (examples.length < 40) examples.push(record);
    } catch (error) {
      counters.failed += 1;
      if (isTransientNetworkError(error)) {
        consecutiveFetchFails += 1;
        console.warn(
          JSON.stringify({
            event: "apply_transient_failed_no_progress",
            productId,
            handle: view.handle,
            error: error instanceof Error ? error.message : String(error),
          })
        );
        if (consecutiveFetchFails >= FETCH_FAIL_ABORT) {
          abortedForFetchStorm = true;
          return;
        }
      } else {
        consecutiveFetchFails = 0;
        const record: ProgressRecord = {
          ...base,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
        await writeProgress(record);
        if (examples.length < 40) examples.push(record);
      }
    }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (abortedForFetchStorm) {
    const reportPath = path.resolve("tmp/kicksdb-image-backfill-report.json");
    await writeFile(
      reportPath,
      JSON.stringify(
        {
          generatedAt: new Date().toISOString(),
          abortedForFetchStorm: true,
          consecutiveFetchFails,
          scanned: counters.scanned,
          repairedVerified: counters.repairedVerified,
          failed: counters.failed,
          progressPath,
        },
        null,
        2
      )
    );
    console.error(JSON.stringify({ event: "summary_aborted", abortedForFetchStorm: true, ...counters }));
    process.exitCode = 2;
    return;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    concurrency,
    apply,
    wait,
    onlyNeedsRepair,
    limit,
    handle: handleFilter,
    brand: brandFilter,
    offset: sqlOffset,
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
