#!/usr/bin/env npx tsx
/**
 * Dual-source STX keep-current (KickDB → SupplierVariant DB + Shopify prices).
 *
 * Guarantees (Shopify-synced catalog only):
 *   - Drain products older than MAX_AGE_HOURS (default 120 = 5 days).
 *   - Two lanes per tick:
 *       FULL  = KickDB lastFetchedAt stale → refresh KickDB + push Shopify prices
 *       PRICE = KickDB fresh but CLS Shopify lastSyncedAt stale → price push only
 *   - Oldest-first — no alphabet cursor wrap, no re-walk of fresh rows.
 *   - Checkpoint on disk (`.data/…`) → survives VPS deploy / container recreate.
 *
 * SSE = hot path. This worker = completeness net (≤5d). Idles when both queues empty.
 *
 * Env:
 *   STX_KEEP_CURRENT_MAX_AGE_HOURS     default 120 (5d)
 *   STX_KEEP_CURRENT_BATCH_PRODUCTS    default 150
 *   STX_KEEP_CURRENT_CONCURRENCY       default 8
 *   STX_KEEP_CURRENT_TICK_MS           default 200
 *   STX_KEEP_CURRENT_IDLE_MS           default 30000
 *   STX_KEEP_CURRENT_INITIAL_DELAY_MS  default 15000
 *   STX_KEEP_CURRENT_CHECKPOINT_PATH   default .data/stx-shopify-keep-current.json
 *   STX_KEEP_CURRENT_PRICE_ONLY        default "1" (set "0" to disable price-only lane)
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
  Number(process.env.STX_KEEP_CURRENT_BATCH_PRODUCTS ?? 150)
);
const CONCURRENCY = Math.max(
  1,
  Number(process.env.STX_KEEP_CURRENT_CONCURRENCY ?? 8)
);
const TICK_MS = Math.max(
  0,
  Number(process.env.STX_KEEP_CURRENT_TICK_MS ?? 200)
);
const IDLE_MS = Math.max(
  1_000,
  Number(process.env.STX_KEEP_CURRENT_IDLE_MS ?? 30_000)
);
const INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.STX_KEEP_CURRENT_INITIAL_DELAY_MS ?? 15_000)
);
const PRICE_ONLY_ENABLED = !["0", "false", "no"].includes(
  String(process.env.STX_KEEP_CURRENT_PRICE_ONLY ?? "1").toLowerCase()
);
const CHECKPOINT_PATH = resolve(
  process.cwd(),
  process.env.STX_KEEP_CURRENT_CHECKPOINT_PATH ??
    ".data/stx-shopify-keep-current.json"
);

type Checkpoint = {
  lastProductId: string;
  updatedAt: string;
  stats: {
    productsTouched: number;
    shopifySynced: number;
    shopifyFailed: number;
    cycles: number;
    fullRefresh: number;
    priceOnly: number;
  };
};

type Lane = "full" | "price_only";

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function defaultCheckpoint(): Checkpoint {
  return {
    lastProductId: "",
    updatedAt: new Date().toISOString(),
    stats: {
      productsTouched: 0,
      shopifySynced: 0,
      shopifyFailed: 0,
      cycles: 0,
      fullRefresh: 0,
      priceOnly: 0,
    },
  };
}

function loadCheckpoint(): Checkpoint {
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint> & {
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
 * FULL lane: KickDB fetch older than MAX_AGE (or never). Oldest first.
 */
async function loadOldestStaleKickdbBatch(limit: number): Promise<string[]> {
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

/**
 * PRICE-ONLY lane: KickDB already fresh, but at least one in-stock STX size has
 * Shopify CLS lastSyncedAt older than MAX_AGE (or never synced). Oldest CLS first.
 * Skips KickDB API — only planned Shopify price push.
 */
async function loadOldestStaleShopifyPriceBatch(limit: number): Promise<string[]> {
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
      AND p."lastFetchedAt" IS NOT NULL
      AND p."lastFetchedAt" >= NOW() - (${ageHours} * INTERVAL '1 hour')
      AND EXISTS (
        SELECT 1
        FROM "KickDBVariant" kv
        INNER JOIN "VariantMapping" m ON m."kickdbVariantId" = kv.id
        INNER JOIN "SupplierVariant" sv
          ON sv."supplierVariantId" = m."supplierVariantId"
        LEFT JOIN "ChannelListingState" cls
          ON cls.channel = 'SHOPIFY'
         AND cls."providerKey" = sv."providerKey"
        WHERE kv."productId" = p.id
          AND m."supplierVariantId" LIKE 'stx_%'
          AND COALESCE(sv.stock, 0) > 0
          AND COALESCE(sv."manualLock", false) = false
          AND (
            cls."lastSyncedAt" IS NULL
            OR cls."lastSyncedAt" < NOW() - (${ageHours} * INTERVAL '1 hour')
          )
      )
    ORDER BY (
      SELECT MIN(cls2."lastSyncedAt")
      FROM "KickDBVariant" kv2
      INNER JOIN "VariantMapping" m2 ON m2."kickdbVariantId" = kv2.id
      INNER JOIN "SupplierVariant" sv2
        ON sv2."supplierVariantId" = m2."supplierVariantId"
      LEFT JOIN "ChannelListingState" cls2
        ON cls2.channel = 'SHOPIFY'
       AND cls2."providerKey" = sv2."providerKey"
      WHERE kv2."productId" = p.id
        AND m2."supplierVariantId" LIKE 'stx_%'
        AND COALESCE(sv2.stock, 0) > 0
        AND COALESCE(sv2."manualLock", false) = false
    ) ASC NULLS FIRST,
    p."kickdbProductId" ASC
    LIMIT ${n}
    `
  );

  return rows
    .map((r) => String(r.kickdbProductId ?? "").trim())
    .filter(Boolean);
}

async function pushShopifyForKickdbProducts(
  batch: string[]
): Promise<{ synced: number; failed: number }> {
  let shopifySynced = 0;
  let shopifyFailed = 0;
  const svIds = await loadSupplierVariantIdsForKickdbProducts(batch);
  console.info("[WORKER][STX_KEEP_CURRENT] shopify plan start", {
    variants: svIds.length,
  });
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
  return { synced: shopifySynced, failed: shopifyFailed };
}

async function runTick(cp: Checkpoint): Promise<{ cp: Checkpoint; didWork: boolean }> {
  // Prefer FULL (stale KickDB). Fill remainder of batch with PRICE-ONLY if enabled.
  const full = await loadOldestStaleKickdbBatch(BATCH_PRODUCTS);
  let priceOnly: string[] = [];
  if (PRICE_ONLY_ENABLED && full.length < BATCH_PRODUCTS) {
    const need = BATCH_PRODUCTS - full.length;
    const fullSet = new Set(full);
    priceOnly = (await loadOldestStaleShopifyPriceBatch(need)).filter(
      (id) => !fullSet.has(id)
    );
  }

  if (full.length === 0 && priceOnly.length === 0) {
    saveCheckpoint(cp);
    return { cp, didWork: false };
  }

  let next: Checkpoint = {
    ...cp,
    stats: {
      ...cp.stats,
      cycles: cp.stats.cycles + 1,
    },
  };
  let shopifySynced = 0;
  let shopifyFailed = 0;

  if (full.length > 0) {
    const at = new Date();
    console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh start", {
      lane: "full" as Lane,
      n: full.length,
    });
    await refreshStxProductsByKickdbProductIds(full, {
      concurrency: CONCURRENCY,
      skipMarketplaceFeedPush: true,
    });
    await bumpKickdbLastFetchedAt(full, at);
    console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh done", { n: full.length });

    next = {
      ...next,
      lastProductId: full[full.length - 1]!,
      stats: {
        ...next.stats,
        productsTouched: next.stats.productsTouched + full.length,
        fullRefresh: next.stats.fullRefresh + full.length,
      },
    };
    saveCheckpoint(next);

    try {
      const r = await pushShopifyForKickdbProducts(full);
      shopifySynced += r.synced;
      shopifyFailed += r.failed;
    } catch (err: unknown) {
      console.error(
        "[WORKER][STX_KEEP_CURRENT] shopify plan failed after full refresh",
        err instanceof Error ? err.message : err
      );
    }
  }

  if (priceOnly.length > 0) {
    console.info("[WORKER][STX_KEEP_CURRENT] price-only start", {
      lane: "price_only" as Lane,
      n: priceOnly.length,
    });
    next = {
      ...next,
      lastProductId: priceOnly[priceOnly.length - 1]!,
      stats: {
        ...next.stats,
        productsTouched: next.stats.productsTouched + priceOnly.length,
        priceOnly: next.stats.priceOnly + priceOnly.length,
      },
    };
    saveCheckpoint(next);

    try {
      const r = await pushShopifyForKickdbProducts(priceOnly);
      shopifySynced += r.synced;
      shopifyFailed += r.failed;
    } catch (err: unknown) {
      console.error(
        "[WORKER][STX_KEEP_CURRENT] shopify plan failed (price-only)",
        err instanceof Error ? err.message : err
      );
    }
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
    full: full.length,
    priceOnly: priceOnly.length,
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
    priceOnlyEnabled: PRICE_ONLY_ENABLED,
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
        console.info(
          "[WORKER][STX_KEEP_CURRENT] queues empty (full+price) — idle"
        );
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
