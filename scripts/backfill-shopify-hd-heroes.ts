#!/usr/bin/env npx tsx
import "dotenv/config";

import { appendFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  chooseHeroRepair,
  GOOGLE_IMAGE_MIN_PX,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";

const APPLY_CONFIRM = "REORDER_EXISTING_HD_HERO";
const ROLLBACK_CONFIRM = "RESTORE_ORIGINAL_HERO";
const PAGE_SIZE = 50;
const MEDIA_LIMIT = 20;

type ProductNode = {
  id: string;
  title: string;
  handle: string;
  vendor: string;
  media: { nodes: ProductMediaImage[] };
};

type ProductPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ProductNode[];
  };
};

type ProgressRecord = {
  at: string;
  action: "reorder" | "rollback";
  productId: string;
  handle: string;
  title: string;
  vendor: string;
  oldHeroId: string;
  oldHeroUrl: string;
  newHeroId: string;
  newHeroUrl: string;
  jobId: string | null;
  status: "submitted" | "complete" | "failed";
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

async function loadCompletedProductIds(progressPath: string): Promise<Set<string>> {
  try {
    const raw = await readFile(progressPath, "utf8");
    const ids = raw
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        try {
          const row = JSON.parse(line) as ProgressRecord;
          return row.action === "reorder" && row.status !== "failed" ? [row.productId] : [];
        } catch {
          return [];
        }
      });
    return new Set(ids);
  } catch {
    return new Set();
  }
}

async function reorderMedia(
  productId: string,
  mediaId: string
): Promise<{ jobId: string | null }> {
  const result = await shopifyGraphQL<{
    productReorderMedia: {
      job: { id: string } | null;
      mediaUserErrors: Array<{ field: string[] | null; message: string }>;
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
  if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  const errors = result.data?.productReorderMedia?.mediaUserErrors ?? [];
  if (errors.length) throw new Error(errors.map((error) => error.message).join("; "));
  return { jobId: result.data?.productReorderMedia?.job?.id ?? null };
}

async function waitForJob(jobId: string): Promise<"complete" | "failed"> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const result = await shopifyGraphQL<{
      job: { done: boolean; id: string } | null;
    }>(
      `query MediaReorderJob($id: ID!) {
        job(id: $id) { id done }
      }`,
      { id: jobId },
      { estimatedQueryCost: 2 }
    );
    if (result.errors?.length) throw new Error(result.errors.map((error) => error.message).join("; "));
    if (!result.data?.job) return "failed";
    if (result.data.job.done) return "complete";
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return "failed";
}

async function rollback(progressPath: string, confirm: string | undefined): Promise<void> {
  if (confirm !== ROLLBACK_CONFIRM) {
    throw new Error(`Rollback requires --confirm=${ROLLBACK_CONFIRM}`);
  }
  const rows = (await readFile(progressPath, "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProgressRecord)
    .filter((row) => row.action === "reorder" && row.status !== "failed")
    .reverse();
  for (const row of rows) {
    try {
      const { jobId } = await reorderMedia(row.productId, row.oldHeroId);
      const record: ProgressRecord = {
        ...row,
        at: new Date().toISOString(),
        action: "rollback",
        jobId,
        status: "submitted",
      };
      await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      console.info(JSON.stringify({ event: "rollback.submitted", handle: row.handle, jobId }));
    } catch (error) {
      console.error(JSON.stringify({ event: "rollback.failed", handle: row.handle, error: String(error) }));
    }
  }
}

async function main(): Promise<void> {
  const apply = hasFlag("apply");
  const wait = hasFlag("wait");
  const limit = intFlag("limit", Number.MAX_SAFE_INTEGER);
  const confirm = stringFlag("confirm");
  const brand = stringFlag("brand")?.trim();
  const handle = stringFlag("handle")?.trim();
  const startAfter = stringFlag("after") || null;
  const progressPath = path.resolve(
    stringFlag("progress") ?? "tmp/shopify-hd-hero-backfill-progress.jsonl"
  );
  await mkdir(path.dirname(progressPath), { recursive: true });

  if (hasFlag("rollback")) {
    await rollback(progressPath, confirm);
    return;
  }
  if (apply && confirm !== APPLY_CONFIRM) {
    throw new Error(`Apply requires --confirm=${APPLY_CONFIRM}`);
  }

  const completed = apply ? await loadCompletedProductIds(progressPath) : new Set<string>();
  const query = [
    "status:active",
    brand ? `vendor:${JSON.stringify(brand)}` : "",
    handle ? `handle:${handle}` : "",
  ]
    .filter(Boolean)
    .join(" AND ");
  let cursor: string | null = startAfter;
  let scanned = 0;
  let candidates = 0;
  let submitted = 0;
  let failed = 0;
  const skipped = { hero_valid: 0, no_images: 0, no_valid_replacement: 0, resumed: 0 };
  const examples: Array<Record<string, unknown>> = [];

  while (scanned < limit) {
    const page: Awaited<ReturnType<typeof shopifyGraphQL<ProductPage>>> =
      await shopifyGraphQL<ProductPage>(
        `query ActiveProductMedia($first: Int!, $after: String, $query: String!) {
          products(first: $first, after: $after, query: $query, sortKey: ID) {
            pageInfo { hasNextPage endCursor }
            nodes {
              id title handle vendor
              media(first: ${MEDIA_LIMIT}) {
                nodes {
                  ... on MediaImage {
                    id
                    image { url width height }
                  }
                }
              }
            }
          }
        }`,
        { first: PAGE_SIZE, after: cursor, query },
        { estimatedQueryCost: 110 }
      );
    if (page.errors?.length) throw new Error(page.errors.map((error) => error.message).join("; "));

    for (const product of page.data.products.nodes) {
      if (scanned >= limit) break;
      scanned += 1;
      if (completed.has(product.id)) {
        skipped.resumed += 1;
        continue;
      }
      const decision = chooseHeroRepair(product.media.nodes, GOOGLE_IMAGE_MIN_PX);
      if (decision.action === "skip") {
        skipped[decision.reason] += 1;
        continue;
      }
      candidates += 1;
      const baseRecord = {
        at: new Date().toISOString(),
        action: "reorder" as const,
        productId: product.id,
        handle: product.handle,
        title: product.title,
        vendor: product.vendor,
        oldHeroId: decision.oldHero.id,
        oldHeroUrl: decision.oldHero.image!.url,
        newHeroId: decision.newHero.id,
        newHeroUrl: decision.newHero.image!.url,
      };
      if (examples.length < 50) examples.push(baseRecord);
      if (!apply) continue;

      try {
        const { jobId } = await reorderMedia(product.id, decision.newHero.id);
        const status = wait && jobId ? await waitForJob(jobId) : "submitted";
        const record: ProgressRecord = { ...baseRecord, jobId, status };
        await appendFile(progressPath, `${JSON.stringify(record)}\n`);
        submitted += 1;
      } catch (error) {
        failed += 1;
        const record: ProgressRecord = {
          ...baseRecord,
          jobId: null,
          status: "failed",
          error: error instanceof Error ? error.message : String(error),
        };
        await appendFile(progressPath, `${JSON.stringify(record)}\n`);
      }
    }

    cursor = page.data.products.pageInfo.endCursor;
    console.info(
      JSON.stringify({ event: "progress", scanned, candidates, submitted, failed, skipped, cursor })
    );
    if (!page.data.products.pageInfo.hasNextPage || !cursor) break;
  }

  const report = {
    generatedAt: new Date().toISOString(),
    apply,
    wait,
    brand: brand ?? null,
    handle: handle ?? null,
    minimumPx: GOOGLE_IMAGE_MIN_PX,
    mediaLimitPerProduct: MEDIA_LIMIT,
    scanned,
    candidates,
    submitted,
    failed,
    skipped,
    resumeCursor: cursor,
    progressPath,
    examples,
    guarantees: [
      "No product, variant, price, inventory, URL, or media is deleted.",
      "Only an already-attached image at least 500x500 is moved to media position 0.",
      "Rollback restores the former hero media to position 0.",
    ],
  };
  const reportPath = path.resolve("tmp/shopify-hd-hero-backfill-report.json");
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.info(JSON.stringify({ event: "summary", ...report, examples: undefined, reportPath }));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
