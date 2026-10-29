#!/usr/bin/env npx tsx
/**
 * Dual-source STX keep-current (KickDB → SupplierVariant DB + Shopify prices).
 *
 * Guarantees (Shopify-synced catalog only):
 *   - Every product refreshed within MAX_AGE_HOURS (default 120 = 5 days),
 *     including PENDING_GTIN / One Size / TCG (no GTIN path).
 *   - Weekly full website walk (ISO week flip) so nothing is permanently skipped.
 *   - Checkpoint on disk (`.data/…`) → survives VPS deploy / container recreate.
 *
 * SSE remains the hot path. This worker is the completeness net: no permanent
 * product cap — only per-tick batch size for KickDB/Shopify rate limits.
 *
 * Env:
 *   STX_KEEP_CURRENT_MAX_AGE_HOURS     default 120 (5d)
 *   STX_KEEP_CURRENT_BATCH_PRODUCTS    default 20
 *   STX_KEEP_CURRENT_CONCURRENCY       default 2
 *   STX_KEEP_CURRENT_TICK_MS           default 5000 (pause when queue empty / between batches)
 *   STX_KEEP_CURRENT_INITIAL_DELAY_MS  default 90000
 *   STX_KEEP_CURRENT_CHECKPOINT_PATH   default .data/stx-shopify-keep-current.json
 *   STX_KEEP_CURRENT_WEEKLY_FULL       default 1 (ISO-week full website walk)
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
  Number(process.env.STX_KEEP_CURRENT_BATCH_PRODUCTS ?? 20)
);
const CONCURRENCY = Math.max(
  1,
  Number(process.env.STX_KEEP_CURRENT_CONCURRENCY ?? 2)
);
const TICK_MS = Math.max(
  500,
  Number(process.env.STX_KEEP_CURRENT_TICK_MS ?? 5_000)
);
const INITIAL_DELAY_MS = Math.max(
  0,
  Number(process.env.STX_KEEP_CURRENT_INITIAL_DELAY_MS ?? 90_000)
);
const WEEKLY_FULL = !["0", "false", "no"].includes(
  String(process.env.STX_KEEP_CURRENT_WEEKLY_FULL ?? "1").toLowerCase()
);
const CHECKPOINT_PATH = resolve(
  process.cwd(),
  process.env.STX_KEEP_CURRENT_CHECKPOINT_PATH ??
    ".data/stx-shopify-keep-current.json"
);

type Mode = "stale" | "weekly";

type Checkpoint = {
  mode: Mode;
  /** Lexicographic resume key (kickdbProductId). Empty = start of list. */
  cursor: string;
  /** ISO week key when weekly mode started / last completed, e.g. 2026-W44. */
  weekKey: string;
  weeklyCompletedWeekKey: string | null;
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

function isoWeekKey(d = new Date()): string {
  // UTC ISO week — stable across VPS restarts / TZ flips.
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function defaultCheckpoint(): Checkpoint {
  return {
    mode: "stale",
    cursor: "",
    weekKey: isoWeekKey(),
    weeklyCompletedWeekKey: null,
    updatedAt: new Date().toISOString(),
    stats: { productsTouched: 0, shopifySynced: 0, shopifyFailed: 0, cycles: 0 },
  };
}

function loadCheckpoint(): Checkpoint {
  try {
    const raw = readFileSync(CHECKPOINT_PATH, "utf8");
    const parsed = JSON.parse(raw) as Partial<Checkpoint>;
    const base = defaultCheckpoint();
    return {
      ...base,
      ...parsed,
      stats: { ...base.stats, ...(parsed.stats ?? {}) },
      mode: parsed.mode === "weekly" ? "weekly" : "stale",
      cursor: String(parsed.cursor ?? ""),
      weekKey: String(parsed.weekKey ?? base.weekKey),
      weeklyCompletedWeekKey:
        parsed.weeklyCompletedWeekKey == null
          ? null
          : String(parsed.weeklyCompletedWeekKey),
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
 * Next page of Shopify-synced KickDB products after `cursor`.
 * stale mode: only products with lastFetchedAt null/older than MAX_AGE.
 * weekly mode: all synced products (age ignored) until cursor walks off the end.
 */
async function loadNextProductBatch(input: {
  mode: Mode;
  cursor: string;
  limit: number;
}): Promise<string[]> {
  const limit = Math.max(1, Math.floor(input.limit));
  const cursor = String(input.cursor ?? "").trim();
  const ageHours = Math.round(MAX_AGE_HOURS);

  const ageClause =
    input.mode === "weekly"
      ? ""
      : `AND (p."lastFetchedAt" IS NULL
            OR p."lastFetchedAt" < NOW() - (${ageHours} * INTERVAL '1 hour'))`;

  const rows = await prismaDirect.$queryRawUnsafe<Array<{ kickdbProductId: string }>>(
    `
    SELECT p."kickdbProductId" AS "kickdbProductId"
    FROM "ShopifySyncState" sss
    INNER JOIN "KickDBProduct" p
      ON p."kickdbProductId" = sss."kickdbProductId"
    WHERE sss."syncStatus" = 'synced'
      AND sss."shopifyProductId" IS NOT NULL
      AND COALESCE(p."notFound", false) = false
      ${ageClause}
      AND ($1::text = '' OR p."kickdbProductId" > $1)
    ORDER BY p."kickdbProductId" ASC
    LIMIT ${limit}
    `,
    cursor
  );

  return rows
    .map((r) => String(r.kickdbProductId ?? "").trim())
    .filter(Boolean);
}

/**
 * Prefer stale (>MAX_AGE) so ≤5d lag holds. Weekly full walk only when stale queue empty
 * for this ISO week (still runs once/week — never permanently skipped).
 */
async function pickNextBatch(cp: Checkpoint): Promise<{
  cp: Checkpoint;
  batch: string[];
  mode: Mode;
}> {
  const week = isoWeekKey();
  let next = { ...cp, weekKey: week };

  // 1) Stale first (cursor walk within stale set).
  const staleBatch = await loadNextProductBatch({
    mode: "stale",
    cursor: next.mode === "stale" ? next.cursor : "",
    limit: BATCH_PRODUCTS,
  });
  if (staleBatch.length > 0) {
    if (next.mode !== "stale") {
      next = { ...next, mode: "stale", cursor: "" };
    }
    return { cp: next, batch: staleBatch, mode: "stale" };
  }

  // Stale empty at this cursor — wrap once; if still empty → weekly or idle.
  if (next.mode === "stale" && next.cursor) {
    const wrap = await loadNextProductBatch({
      mode: "stale",
      cursor: "",
      limit: BATCH_PRODUCTS,
    });
    if (wrap.length > 0) {
      next = { ...next, mode: "stale", cursor: "" };
      return { cp: next, batch: wrap, mode: "stale" };
    }
  }

  // 2) Weekly full website when enabled and not completed this ISO week.
  if (WEEKLY_FULL && next.weeklyCompletedWeekKey !== week) {
    const weeklyCursor =
      next.mode === "weekly" && next.weekKey === week ? next.cursor : "";
    if (next.mode !== "weekly" || next.weekKey !== week || next.cursor !== weeklyCursor) {
      if (weeklyCursor === "") {
        console.info("[WORKER][STX_KEEP_CURRENT] starting weekly full website walk", {
          week,
        });
      }
      next = { ...next, mode: "weekly", weekKey: week, cursor: weeklyCursor };
    }
    const weeklyBatch = await loadNextProductBatch({
      mode: "weekly",
      cursor: next.cursor,
      limit: BATCH_PRODUCTS,
    });
    if (weeklyBatch.length > 0) {
      return { cp: next, batch: weeklyBatch, mode: "weekly" };
    }
    console.info("[WORKER][STX_KEEP_CURRENT] weekly walk complete", {
      week,
      stats: next.stats,
    });
    next = {
      ...next,
      mode: "stale",
      cursor: "",
      weeklyCompletedWeekKey: week,
    };
    saveCheckpoint(next);
    return { cp: next, batch: [], mode: "stale" };
  }

  next = { ...next, mode: "stale", cursor: "" };
  return { cp: next, batch: [], mode: "stale" };
}

async function runTick(cp: Checkpoint): Promise<Checkpoint> {
  const picked = await pickNextBatch(cp);
  let next = picked.cp;
  const batch = picked.batch;

  if (batch.length === 0) {
    saveCheckpoint(next);
    return next;
  }

  const at = new Date();
  console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh start", {
    mode: picked.mode,
    n: batch.length,
  });
  await refreshStxProductsByKickdbProductIds(batch, {
    concurrency: CONCURRENCY,
    // Galaxus feed stays on stx-refresh / SSE debounce — keep-current must not SFTP every batch.
    skipMarketplaceFeedPush: true,
  });
  await bumpKickdbLastFetchedAt(batch, at);
  console.info("[WORKER][STX_KEEP_CURRENT] kickdb refresh done", { n: batch.length });

  // Cursor + age bump committed before Shopify — deploy/hang mid-push still ≤5d progress.
  next = {
    ...next,
    mode: picked.mode,
    cursor: batch[batch.length - 1]!,
    stats: {
      ...next.stats,
      productsTouched: next.stats.productsTouched + batch.length,
      cycles: next.stats.cycles + 1,
    },
  };
  saveCheckpoint(next);

  let shopifySynced = 0;
  let shopifyFailed = 0;
  try {
    const svIds = await loadSupplierVariantIdsForKickdbProducts(batch);
    console.info("[WORKER][STX_KEEP_CURRENT] shopify plan start", { variants: svIds.length });
    const CHUNK = 40;
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
    mode: next.mode,
    n: batch.length,
    cursor: next.cursor,
    shopifySynced,
    shopifyFailed,
    week: next.weekKey,
  });
  return next;
}

async function main(): Promise<void> {
  console.info("[WORKER][STX_KEEP_CURRENT] starting", {
    maxAgeHours: MAX_AGE_HOURS,
    batchProducts: BATCH_PRODUCTS,
    concurrency: CONCURRENCY,
    tickMs: TICK_MS,
    weeklyFull: WEEKLY_FULL,
    checkpointPath: CHECKPOINT_PATH,
  });
  await sleep(INITIAL_DELAY_MS);

  let cp = loadCheckpoint();
  console.info("[WORKER][STX_KEEP_CURRENT] checkpoint loaded", {
    mode: cp.mode,
    cursor: cp.cursor || "(start)",
    weekKey: cp.weekKey,
    weeklyCompletedWeekKey: cp.weeklyCompletedWeekKey,
    stats: cp.stats,
  });

  while (true) {
    try {
      cp = await runTick(cp);
    } catch (err: unknown) {
      console.error(
        "[WORKER][STX_KEEP_CURRENT] tick failed",
        err instanceof Error ? err.message : err
      );
      // Persist whatever we had so a crash mid-batch still resumes near the failure.
      try {
        saveCheckpoint(cp);
      } catch {
        /* ignore */
      }
    }
    await sleep(TICK_MS);
  }
}

main().catch((err: unknown) => {
  console.error("[WORKER][STX_KEEP_CURRENT] fatal", err);
  process.exitCode = 1;
});
