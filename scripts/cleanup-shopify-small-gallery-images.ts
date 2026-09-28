#!/usr/bin/env npx tsx
/**
 * Delete leftover <500px gallery images when a Google-ready featured hero already exists.
 * Simprosys/Merchant can still pick the thumb if it remains attached.
 *
 *   npx tsx scripts/cleanup-shopify-small-gallery-images.ts --all-shopify --limit=200000 --apply --confirm=DELETE_SMALL_GALLERY
 *   npx tsx scripts/cleanup-shopify-small-gallery-images.ts --product-ids-file=tmp/merchant-image-too-small-product-ids.json --limit=5000
 *   npx tsx scripts/cleanup-shopify-small-gallery-images.ts --product-ids-file=tmp/ids.json --limit=5000 --apply --confirm=DELETE_SMALL_GALLERY
 */
import "dotenv/config";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { setShopifyGraphQLConcurrency, shopifyGraphQL } from "@/lib/shopifyAdmin";
import { GOOGLE_IMAGE_MIN_PX, isGoogleReadyImage } from "@/scripts/lib/shopifyImageHeroRepair";
import { smallMediaIdsToDelete } from "@/scripts/lib/kickdbHeroWebp";

const APPLY_CONFIRM = "DELETE_SMALL_GALLERY";
const FETCH_FAIL_ABORT = 40;
const PRODUCT_IDS_CACHE = "tmp/shopify-all-product-ids.json";

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

function isTransientNetworkError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|socket hang up|network|P1017|closed the connection|Timed out fetching a new connection|status 503|status 502|status 429|THROTTLED/i.test(
    message
  );
}

async function withTransientRetry<T>(label: string, fn: () => Promise<T>, attempts = 4): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isTransientNetworkError(error) || attempt >= attempts) throw error;
      const waitMs = Math.min(30_000, 500 * 2 ** (attempt - 1));
      console.warn(JSON.stringify({ event: "transient_retry", label, attempt, waitMs, error: String(error) }));
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  throw lastError;
}

type MediaNode = {
  id: string;
  image: { url: string; width: number | null; height: number | null } | null;
};

async function fetchProduct(productGid: string): Promise<{
  handle: string;
  featuredMediaId: string | null;
  media: MediaNode[];
} | null> {
  return withTransientRetry(`fetchProduct:${productGid}`, async () => {
    const result = await shopifyGraphQL<{
      product: {
        handle: string;
        featuredMedia: { id: string | null } | null;
        media: { nodes: Array<{ id: string; image: { url: string; width: number | null; height: number | null } | null }> };
      } | null;
    }>(
      `query CleanupMedia($id: ID!) {
        product(id: $id) {
          handle
          featuredMedia { id }
          media(first: 30) {
            nodes { ... on MediaImage { id image { url width height } } }
          }
        }
      }`,
      { id: productGid },
      { estimatedQueryCost: 12 }
    );
    if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
    const product = result.data?.product;
    if (!product) return null;
    const media = product.media.nodes.filter((m) => m?.image?.url);
    return {
      handle: product.handle,
      featuredMediaId: product.featuredMedia?.id ?? media[0]?.id ?? null,
      media,
    };
  });
}

async function deleteMedia(productId: string, mediaIds: string[]): Promise<void> {
  if (mediaIds.length === 0) return;
  await withTransientRetry(`deleteMedia:${productId}`, async () => {
    const result = await shopifyGraphQL<{
      productDeleteMedia: {
        deletedMediaIds: string[] | null;
        mediaUserErrors: Array<{ message: string }>;
      };
    }>(
      `mutation CleanupDeleteSmall($productId: ID!, $mediaIds: [ID!]!) {
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
  });
}

async function loadDone(progressPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(progressPath, "utf8");
    const ids = raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as { status?: string; productId?: string };
          if (row.status === "cleaned" || row.status === "noop_no_small") {
            return row.productId ? [row.productId] : [];
          }
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

async function listAllShopifyProductGids(max = 500_000): Promise<string[]> {
  const ids: string[] = [];
  let cursor: string | null = null;
  while (ids.length < max) {
    const result: {
      data?: {
        products: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          nodes: Array<{ id: string }>;
        };
      };
      errors?: Array<{ message: string }>;
    } = await shopifyGraphQL(
      `query CleanupListProducts($cursor: String) {
        products(first: 250, after: $cursor) {
          pageInfo { hasNextPage endCursor }
          nodes { id }
        }
      }`,
      { cursor },
      { estimatedQueryCost: 20 }
    );
    if (result.errors?.length) throw new Error(result.errors.map((e) => e.message).join("; "));
    const conn = result.data?.products;
    if (!conn) break;
    for (const node of conn.nodes) {
      if (node?.id) ids.push(node.id);
      if (ids.length >= max) break;
    }
    if (!conn.pageInfo.hasNextPage) break;
    cursor = conn.pageInfo.endCursor;
    if (ids.length % 5000 === 0) {
      console.info(JSON.stringify({ event: "list_progress", listed: ids.length }));
    }
  }
  return ids;
}

async function main() {
  const apply = hasFlag("apply");
  const confirm = stringFlag("confirm");
  const limit = intFlag("limit", 2000);
  const offset = Number.parseInt(stringFlag("offset") ?? "0", 10) || 0;
  const concurrency = Math.min(8, Math.max(1, intFlag("concurrency", 6)));
  const idsFile = stringFlag("product-ids-file")?.trim();
  const allShopify = hasFlag("all-shopify");
  if (!idsFile && !allShopify) throw new Error("Pass --product-ids-file=... or --all-shopify");
  if (apply && confirm !== APPLY_CONFIRM) {
    throw new Error(`Apply requires --confirm=${APPLY_CONFIRM}`);
  }

  const progressPath = path.resolve(
    stringFlag("progress") ?? "tmp/kicksdb-small-gallery-cleanup-progress.jsonl"
  );
  await mkdir(path.dirname(progressPath), { recursive: true });
  let progressWrite: Promise<void> = Promise.resolve();
  const writeProgress = (row: Record<string, unknown>) => {
    const run = progressWrite.then(() => appendFile(progressPath, `${JSON.stringify(row)}\n`));
    progressWrite = run.then(
      () => undefined,
      () => undefined
    );
    return run;
  };

  const done = apply ? await loadDone(progressPath) : new Set<string>();
  let rawIds: string[];
  if (allShopify) {
    const cachePath = path.resolve(PRODUCT_IDS_CACHE);
    const refresh = hasFlag("refresh-ids");
    let usedCache = false;
    if (!refresh) {
      try {
        const cached = JSON.parse(await readFile(cachePath, "utf8")) as string[];
        if (Array.isArray(cached) && cached.length > 1000) {
          rawIds = cached;
          usedCache = true;
          console.info(JSON.stringify({ event: "ids_cache_hit", count: rawIds.length, cachePath }));
        }
      } catch {
        /* list fresh */
      }
    }
    if (!usedCache) {
      console.info(JSON.stringify({ event: "listing_all_shopify_products" }));
      rawIds = await listAllShopifyProductGids();
      await writeFile(cachePath, JSON.stringify(rawIds));
      console.info(JSON.stringify({ event: "listed_all_shopify_products", count: rawIds.length, cachePath }));
    }
  } else {
    rawIds = JSON.parse(await readFile(path.resolve(idsFile!), "utf8")) as string[];
  }
  const pending = rawIds
    .map((id) => String(id).trim())
    .filter(Boolean)
    .map((id) => (id.startsWith("gid://") ? id : `gid://shopify/Product/${id}`))
    .filter((gid) => !done.has(gid))
    .slice(offset, offset + limit);

  setShopifyGraphQLConcurrency(Math.min(6, concurrency));
  console.info(
    JSON.stringify({
      event: "start",
      apply,
      allShopify,
      catalogSize: rawIds.length,
      pending: pending.length,
      alreadyDone: done.size,
      offset,
      limit,
      concurrency,
      minPx: GOOGLE_IMAGE_MIN_PX,
    })
  );

  if (pending.length === 0) {
    const report = {
      generatedAt: new Date().toISOString(),
      apply,
      catalogSize: rawIds.length,
      pending: 0,
      alreadyDone: done.size,
      cleaned: 0,
      noopNoSmall: 0,
      scanned: 0,
      done: true,
    };
    const reportPath = path.resolve("tmp/kicksdb-small-gallery-cleanup-report.json");
    await writeFile(reportPath, JSON.stringify(report, null, 2));
    console.info(JSON.stringify({ event: "summary", ...report, reportPath }));
    return;
  }

  const counters = {
    scanned: 0,
    cleaned: 0,
    noopNoSmall: 0,
    skippedNoHero: 0,
    failed: 0,
    dryRunDeleteable: 0,
    deletedMedia: 0,
  };

  let nextIndex = 0;
  let consecutiveFetchFails = 0;
  let abortedForFetchStorm = false;

  async function worker(): Promise<void> {
    while (true) {
      if (abortedForFetchStorm) return;
      const index = nextIndex;
      nextIndex += 1;
      if (index >= pending.length) return;
      const productId = pending[index];
      counters.scanned += 1;
      try {
        const view = await fetchProduct(productId);
        consecutiveFetchFails = 0;
        if (!view?.featuredMediaId) {
          counters.skippedNoHero += 1;
          continue;
        }
        const featured = view.media.find((m) => m.id === view.featuredMediaId) ?? null;
        const heroOk = featured
          ? isGoogleReadyImage(
              { id: featured.id, image: featured.image },
              GOOGLE_IMAGE_MIN_PX
            )
          : false;
        if (!heroOk) {
          counters.skippedNoHero += 1;
          await writeProgress({
            at: new Date().toISOString(),
            productId,
            handle: view.handle,
            status: "skipped_no_hero",
            reason: "featured_below_500_or_missing",
          });
          continue;
        }
        const smallIds = smallMediaIdsToDelete(view.media, view.featuredMediaId, GOOGLE_IMAGE_MIN_PX);
        if (smallIds.length === 0) {
          counters.noopNoSmall += 1;
          await writeProgress({
            at: new Date().toISOString(),
            productId,
            handle: view.handle,
            status: "noop_no_small",
          });
          continue;
        }
        if (!apply) {
          counters.dryRunDeleteable += 1;
          counters.deletedMedia += smallIds.length;
          await writeProgress({
            at: new Date().toISOString(),
            productId,
            handle: view.handle,
            status: "dry_run",
            deleteCount: smallIds.length,
            deleteIds: smallIds,
          });
          continue;
        }
        await deleteMedia(productId, smallIds);
        consecutiveFetchFails = 0;
        counters.cleaned += 1;
        counters.deletedMedia += smallIds.length;
        await writeProgress({
          at: new Date().toISOString(),
          productId,
          handle: view.handle,
          status: "cleaned",
          deleteCount: smallIds.length,
          deleteIds: smallIds,
        });
        console.info(
          JSON.stringify({
            event: "cleaned",
            handle: view.handle,
            deleted: smallIds.length,
          })
        );
      } catch (error) {
        counters.failed += 1;
        if (isTransientNetworkError(error)) {
          consecutiveFetchFails += 1;
          console.warn(
            JSON.stringify({
              event: "transient_failed_no_progress",
              productId,
              error: String(error),
              consecutiveFetchFails,
            })
          );
          if (consecutiveFetchFails >= FETCH_FAIL_ABORT) {
            abortedForFetchStorm = true;
            console.error(JSON.stringify({ event: "abort_fetch_storm", consecutiveFetchFails }));
            return;
          }
        } else {
          consecutiveFetchFails = 0;
          await writeProgress({
            at: new Date().toISOString(),
            productId,
            status: "failed",
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    abortedForFetchStorm,
    catalogSize: rawIds.length,
    pending: pending.length,
    alreadyDone: done.size,
    ...counters,
    progressPath,
    done: !abortedForFetchStorm && counters.cleaned === 0 && counters.failed === 0 && pending.length > 0
      ? counters.noopNoSmall + counters.skippedNoHero >= counters.scanned
      : pending.length === 0,
  };
  const reportPath = path.resolve("tmp/kicksdb-small-gallery-cleanup-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ event: "summary", ...report, reportPath }));
  if (abortedForFetchStorm) process.exitCode = 2;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
