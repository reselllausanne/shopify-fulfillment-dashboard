#!/usr/bin/env npx tsx
/**
 * Dual-source STX keep-current (KickDB → SupplierVariant DB + Shopify prices).
 *
 * Guarantees (Shopify-synced catalog only):
 *   - Drain products older than MAX_AGE_HOURS (default 120 = 5 days),
 *     including PENDING_GTIN / One Size / TCG (no GTIN path).
 *   - Oldest-first queue — no alphabet cursor wrap, no re-walk of fresh rows.
 *   - Checkpoint on disk (`.data/…`) → survives VPS deploy / container recreate.
 *
 * SSE = hot path. This worker = completeness net. Runs until stale empty, then
 * idles (poll). Does NOT loop around the whole catalog after catch-up.
 *
 * Env:
 *   STX_KEEP_CURRENT_MAX_AGE_HOURS     default 120 (5d)
 *   STX_KEEP_CURRENT_BATCH_PRODUCTS    default 100
 *   STX_KEEP_CURRENT_CONCURRENCY       default 6
 *   STX_KEEP_CURRENT_TICK_MS           default 500 (pause only between busy batches)
 *   STX_KEEP_CURRENT_IDLE_MS           default 30000 (pause when queue empty)
 *   STX_KEEP_CURRENT_INITIAL_DELAY_MS  default 15000
 *   STX_KEEP_CURRENT_CHECKPOINT_PATH   default .data/stx-shopify-keep-current.json
 */
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { prisma, prismaDirect } from "../../app/lib/prisma";
import { refreshStxProductsByKickdbProductIds } from "../../galaxus/jobs/stxSync";
import { runPlannedShopifyStxPriceSyncForSupplierVariantIds } from "../../shopify/stx/shopifyStxPriceSyncPlan";

const MAX_AGE_HOURS = Math.max(
  1,
  Number(process.env.STX_KEEP_CURRENT_MAX_AGE_HOURS ?? 120)
);
const BATCH_PRODUCTS = Math.max(
  1,
  Number(process.env.STX_KEEP_CURRENT_BATCH_PRODUCTS ?? 100)
);
const CONCURRENCY = Math.max(
  1,
  Number(process.env.STX_KEEP_CURRENT_CONCURRENCY ?? 6)
);
const TICK_MS = Math.max(
  0,
  Number(process.env.STX_KEEP_CURRENT_TICK_MS ?? 500)
);
const IDLE_MS = Math.max(
  1_000,
  Number(process.env.STX_KEEP_CURRENT_IDLE_MS ?? 30_000)
);
const INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.STX_KEEP_CURRENT_INITIAL_DELAY_MS ?? 15_000)
);
const CHECKPOINT_PATH = resolve(
  process.cwd(),
  process.env.STX_KEEP_CURRENT_CHECKPOINT_PATH ??
    ".data/stx-shopify-keep-current.json"
);

type Checkpoint = {
  /** Last product id touched (debug only — queue is age-ordered, not cursor-walk). */
  lastProductId: string;
  updatedAt: string;
  stats: {
    productsTouched: number;
    shopifySynced: number;
    shopifyFailed: number;
    cycles: number;
  };
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultCheckpoint(): Checkpoint {
  return {
    lastProductId: "",
    updatedAt: new Date().toISOString(),
    stats: { productsTouched: 0, shopifySynced: 0, shopifyFailed: 0, cycles: 0 },
  };
}

function loadCheckpoint(): Checkpoint {
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint> & {
      /** legacy fields from cursor/weekly versions */
      cursor?: string;
      stats?: Partial<Checkpoint["stats"]>;
    };
    const base = defaultCheckpoint();
    return {
      ...base,
      lastProductId: String(parsed.lastProductId ?? parsed.cursor ?? ""),
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
    };
  } catch {
    return defaultCheckpoint();
  }
}

function saveCheckpoint(cp: Checkpoint): void {
  mkdirSync(dirname(CHECKPOINT_PATH), { recursive: true });
  const next: Checkpoint = { ...cp, updatedAt: new Date().toISOString() };
  const tmp = `${CHECKPOINT_PATH}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(next, null, 2));
  renameSync(tmp, CHECKPOINT_PATH);
}

async function bumpKickdbLastFetchedAt(ids: string[], at: Date): Promise<void> {
  const clean = Array.from(new Set(ids.map((id) => String(id ?? "").trim()).filter(Boolean)));
  if (clean.length === 0) return;
  await prisma.kickDBProduct.updateMany({
    where: { kickdbProductId: { in: clean } },
    data: { lastFetchedAt: at },
  });
}

async function loadSupplierVariantIdsForKickdbProducts(
  kickdbProductIds: string[]
): Promise<string[]> {
  const ids = Array.from(
    new Set(kickdbProductIds.map((id) => String(id ?? "").trim()).filter(Boolean))
  );
  if (ids.length === 0) return [];
  const rows = await prismaDirect.$queryRawUnsafe<Array<{ supplierVariantId: string }>>(
    `
    SELECT DISTINCT m."supplierVariantId" AS "supplierVariantId"
    FROM "VariantMapping" m
    INNER JOIN "KickDBVariant" kv ON kv.id = m."kickdbVariantId"
    INNER JOIN "KickDBProduct" p ON p.id = kv."productId"
    WHERE p."kickdbProductId" = ANY($1::text[])
      AND m."supplierVariantId" LIKE 'stx_%'
    `,
    ids
  );
  return rows
    .map((r) => String(r.supplierVariantId ?? "").trim())
    .filter((id) => id.startsWith("stx_"));
}

/**
 * Next N Shopify-synced products past MAX_AGE — oldest first.
 * No cursor wrap: after bump they leave the set; when empty → idle.
 */
async function loadOldestStaleBatch(limit: number): Promise<string[]> {
  const n = Math.max(1, Math.floor(limit));
  const ageHours = Math.round(MAX_AGE_HOURS);

  const rows = await prismaDirect.$queryRawUnsafe<Array<{ kickdbProductId: string }>>(
    `
    SELECT p."kickdbProductId" AS "kickdbProductId"
    FROM "ShopifySyncState" sss
    INNER JOIN "KickDBProduct" p
      ON p."kickdbProductId" = sss."kickdbProductId"
    WHERE sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      AND COALESCE(p."notFound", false) = false
      AND (p."lastFetchedAt" IS NULL
           OR p."lastFetchedAt" < NOW() - (${ageHours} * INTERVAL '1 hour'))
    ORDER BY p."lastFetchedAt" ASC NULLS FIRST, p."kickdbProductId" ASC
    LIMIT ${n}
    `
  );

  return rows
    .map((r) => String(r.kickdbProductId ?? "").trim())
    .filter(Boolean);
}

async function runTick(cp: Checkpoint): Promise<{ cp: Checkpoint; didWork: boolean }> {
  const batch = await loadOldestStaleBatch(BATCH_PRODUCTS);

  if (batch.length === 0) {
    saveCheckpoint(cp);
    return { cp, didWork: false };
  }

  const at = new Date();
  console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh start", {
    n: batch.length,
  });
  await refreshStxProductsByKickdbProductIds(batch, {
    concurrency: CONCURRENCY,
    // Galaxus feed stays on stx-refresh / SSE debounce — keep-current must not SFTP every batch.
    skipMarketplaceFeedPush: true,
  });
  await bumpKickdbLastFetchedAt(batch, at);
  console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh done", { n: batch.length });

  let next: Checkpoint = {
    ...cp,
    lastProductId: batch[batch.length - 1]!,
    stats: {
      ...cp.stats,
      productsTouched: cp.stats.productsTouched + batch.length,
      cycles: cp.stats.cycles + 1,
    },
  };
  saveCheckpoint(next);

  let shopifySynced = 0;
  let shopifyFailed = 0;
  try {
    const svIds = await loadSupplierVariantIdsForKickdbProducts(batch);
    console.info("[WORKER][STX_KEEP_CURRENT] shopify plan start", { variants: svIds.length });
    const CHUNK = 80;
    for (let i = 0; i < svIds.length; i += CHUNK) {
      const slice = svIds.slice(i, i + CHUNK);
      const plan = await runPlannedShopifyStxPriceSyncForSupplierVariantIds(slice);
      shopifySynced += plan.shopify.synced;
      shopifyFailed += plan.shopify.failed;
      console.info("[WORKER][STX_KEEP_CURRENT] shopify plan chunk", {
        i: Math.floor(i / CHUNK) + 1,
        of: Math.ceil(svIds.length / CHUNK) || 1,
        needsPush: plan.needsPush,
        synced: plan.shopify.synced,
        failed: plan.shopify.failed,
        unchanged: plan.unchanged,
      });
    }
  } catch (err: unknown) {
    console.error(
      "[WORKER][STX_KEEP_CURRENT] shopify plan failed (KickDB already advanced)",
      err instanceof Error ? err.message : err
    );
  }

  next = {
    ...next,
    stats: {
      ...next.stats,
      shopifySynced: next.stats.shopifySynced + shopifySynced,
      shopifyFailed: next.stats.shopifyFailed + shopifyFailed,
    },
  };
  saveCheckpoint(next);
  console.info("[WORKER][STX_KEEP_CURRENT] batch", {
    n: batch.length,
    lastProductId: next.lastProductId,
    shopifySynced,
    shopifyFailed,
  });
  return { cp: next, didWork: true };
}

async function main(): Promise<void> {
  console.info("[WORKER][STX_KEEP_CURRENT] starting", {
    maxAgeHours: MAX_AGE_HOURS,
    batchProducts: BATCH_PRODUCTS,
    concurrency: CONCURRENCY,
    tickMs: TICK_MS,
    idleMs: IDLE_MS,
    checkpointPath: CHECKPOINT_PATH,
  });
  await sleep(INITIAL_DELAY_MS);

  let cp = loadCheckpoint();
  console.info("[WORKER][STX_KEEP_CURRENT] checkpoint loaded", {
    lastProductId: cp.lastProductId || "(none)",
    stats: cp.stats,
  });

  while (true) {
    let didWork = false;
    try {
      const tick = await runTick(cp);
      cp = tick.cp;
      didWork = tick.didWork;
      if (!didWork) {
        console.info("[WORKER][STX_KEEP_CURRENT] queue empty — idle (no catalog loop)");
      }
    } catch (err: unknown) {
      console.error(
        "[WORKER][STX_KEEP_CURRENT] tick failed",
        err instanceof Error ? err.message : err
      );
      try {
        saveCheckpoint(cp);
      } catch {
        /* ignore */
      }
    }
    await sleep(didWork ? TICK_MS : IDLE_MS);
  }
}

main().catch((err: unknown) => {
  console.error("[WORKER][STX_KEEP_CURRENT] fatal", err);
  process.exitCode = 1;
});
