import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_STX_FIXED_BOX_AND_SHIPPING_CHF,
  galaxusStxLockedDenom,
} from "@/galaxus/exports/pricing";
import { patchFeedSnapshotsForProviderKeys } from "@/galaxus/exports/feedSnapshot";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipelineCore";

/**
 * Durable safety net for STX feed snapshots.
 *
 * The debounced patch in `stxRefreshFeedPush.ts` is in-memory only: a restart/deploy, an HTTP
 * error or a "snapshot not ready" no-op silently leaves GalaxusFeedOfferSnapshot /
 * GalaxusFeedStockSnapshot rows stale (1833 STX offers were found under the locked floor, some
 * below cost). This job derives the truth from the DB instead of memory:
 *
 *   Offer: snap PurchasePrice disagrees with locked formula(SV.price) while in stock
 *   (no updatedAt gate — ask spikes must reprice even if SV was already "fresh").
 *   Stock: SV changed AFTER snap and DB stock is 0 while snap still advertises qty.
 *   Then patch keys via live export + queue stock-price push.
 */

export type StxReconcileConfig = {
  /** Max keys patched per run. */
  maxKeys: number;
  /** Relative tolerance on the offer price (fraction of expected). */
  relTolerance: number;
  /** Absolute tolerance on the offer price, CHF. */
  absToleranceChf: number;
  /** HTTP patch chunk size. */
  chunkSize: number;
  /** Per-query statement timeout, seconds. */
  queryTimeoutSec: number;
};

export function stxReconcileConfigFromEnv(env: NodeJS.ProcessEnv = process.env): StxReconcileConfig {
  const num = (key: string, fallback: number, min: number) => {
    const v = Number(env[key]);
    return Number.isFinite(v) && v >= min ? v : fallback;
  };
  return {
    maxKeys: Math.floor(num("GALAXUS_STX_RECONCILE_MAX_KEYS", 5000, 1)),
    relTolerance: num("GALAXUS_STX_RECONCILE_REL_TOLERANCE", 0.02, 0),
    absToleranceChf: num("GALAXUS_STX_RECONCILE_ABS_TOLERANCE_CHF", 0.5, 0),
    chunkSize: Math.floor(num("GALAXUS_STX_PATCH_CHUNK", 200, 1)),
    queryTimeoutSec: Math.floor(num("GALAXUS_STX_RECONCILE_QUERY_TIMEOUT_SEC", 240, 10)),
  };
}

/** Pure mirror of the SQL predicate (kept for tests / docs). */
export function isStxOfferPriceMismatch(
  snapshotPriceChf: number,
  dbPriceChf: number,
  cfg: Pick<StxReconcileConfig, "relTolerance" | "absToleranceChf">
): boolean {
  const denom = galaxusStxLockedDenom();
  if (!(denom > 0) || !(dbPriceChf > 0) || !Number.isFinite(snapshotPriceChf)) return false;
  const expected = Math.ceil(((dbPriceChf + GALAXUS_STX_FIXED_BOX_AND_SHIPPING_CHF) / denom) * 100) / 100;
  return Math.abs(snapshotPriceChf - expected) > Math.max(cfg.absToleranceChf, cfg.relTolerance * expected);
}

export function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type KeyRow = { providerKey: string };

async function queryKeys(
  timeoutSec: number,
  build: () => Prisma.Sql
): Promise<string[]> {
  const rows = await prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '${Math.floor(timeoutSec)}s'`);
      return tx.$queryRaw<KeyRow[]>(build());
    },
    { timeout: (timeoutSec + 30) * 1000, maxWait: 30_000 }
  );
  return rows.map((r) => r.providerKey);
}

/**
 * Offer snapshot price != locked formula(DB price).
 * Do NOT require sv.updatedAt > snap.updatedAt: after an ask spike the SV can stay
 * untouched for days while Galaxus keeps re-uploading the old snap price (Magia
 * EU 36.5 stuck at 86.46 from Nov 11 while buy rose to 267).
 */
export async function findStaleStxOfferKeys(cfg: StxReconcileConfig): Promise<string[]> {
  const denom = galaxusStxLockedDenom();
  const fixed = GALAXUS_STX_FIXED_BOX_AND_SHIPPING_CHF;
  return queryKeys(
    cfg.queryTimeoutSec,
    () => Prisma.sql`
      SELECT s."providerKey" AS "providerKey"
      FROM "GalaxusFeedOfferSnapshot" s
      JOIN "SupplierVariant" sv ON sv."providerKey" = s."providerKey"
      WHERE s."providerKey" LIKE 'STX\_%'
        AND sv."manualLock" IS DISTINCT FROM true
        AND sv.price > 0
        AND sv.stock > 0
        AND abs(
              (s."rowJson"->>'PurchasePriceExclVat_CHF')::numeric
              - ceil((sv.price + ${fixed}::numeric) / ${denom}::numeric * 100) / 100
            ) > greatest(
              ${cfg.absToleranceChf}::numeric,
              ${cfg.relTolerance}::numeric * ceil((sv.price + ${fixed}::numeric) / ${denom}::numeric * 100) / 100
            )
      ORDER BY (
        ceil((sv.price + ${fixed}::numeric) / ${denom}::numeric * 100) / 100
        - (s."rowJson"->>'PurchasePriceExclVat_CHF')::numeric
      ) DESC
      LIMIT ${cfg.maxKeys}`
  );
}

/** Stock snapshot still advertises stock but DB says 0 (changed after the snapshot row). */
export async function findStaleStxStockKeys(cfg: StxReconcileConfig): Promise<string[]> {
  return queryKeys(
    cfg.queryTimeoutSec,
    () => Prisma.sql`
      SELECT s."providerKey" AS "providerKey"
      FROM "GalaxusFeedStockSnapshot" s
      JOIN "SupplierVariant" sv ON sv."providerKey" = s."providerKey"
      WHERE s."providerKey" LIKE 'STX\_%'
        AND sv."updatedAt" > s."updatedAt"
        AND sv.stock <= 0
        AND coalesce((s."rowJson"->>'QuantityOnStock')::numeric, 0) > 0
      LIMIT ${cfg.maxKeys}`
  );
}

export type StxReconcileResult = {
  staleOffer: number;
  staleStock: number;
  candidates: number;
  patched: number;
  pushQueued: boolean;
  durationMs: number;
};

let lastPushAtMs = 0;
const MIN_PUSH_GAP_MS = Number(process.env.GALAXUS_STX_RECONCILE_MIN_PUSH_GAP_MS ?? 20 * 60_000);

export async function runStxSnapshotReconcile(
  origin: string,
  cfg: StxReconcileConfig = stxReconcileConfigFromEnv()
): Promise<StxReconcileResult> {
  const started = Date.now();
  const [offerKeys, stockKeys] = await Promise.all([
    findStaleStxOfferKeys(cfg),
    findStaleStxStockKeys(cfg),
  ]);
  const keys = Array.from(new Set([...offerKeys, ...stockKeys])).slice(0, cfg.maxKeys);

  let patched = 0;
  for (const part of chunk(keys, cfg.chunkSize)) {
    try {
      const res = await patchFeedSnapshotsForProviderKeys({
        origin,
        providerKeys: part,
        // Never let a thin-ask/export blip remove a still-in-DB offer from the file.
        deleteStale: false,
      });
      patched += res.patched;
    } catch (err) {
      console.error("[stx-reconcile] patch chunk failed", {
        size: part.length,
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  let pushQueued = false;
  if (patched > 0 && Date.now() - lastPushAtMs >= MIN_PUSH_GAP_MS) {
    try {
      await startFeedPushAsync({ origin, scope: "stock-price", triggerSource: "stx-refresh" });
      lastPushAtMs = Date.now();
      pushQueued = true;
    } catch (err) {
      console.error("[stx-reconcile] push failed", err instanceof Error ? err.message : String(err));
    }
  }

  const result: StxReconcileResult = {
    staleOffer: offerKeys.length,
    staleStock: stockKeys.length,
    candidates: keys.length,
    patched,
    pushQueued,
    durationMs: Date.now() - started,
  };
  if (keys.length > 0 && patched === 0) {
    console.warn("[stx-reconcile] stale keys found but nothing patched (empty snap tables or patch failed)", result);
  } else if (keys.length > 0) {
    console.warn("[stx-reconcile] repaired stale STX snapshot rows", result);
  } else {
    console.info("[stx-reconcile] ok, no stale STX snapshot rows", result);
  }
  return result;
}

/** Self-rescheduling loop; never throws, never overlaps. */
export function startStxSnapshotReconcileLoop(origin: string): void {
  if (process.env.GALAXUS_STX_RECONCILE === "0") {
    console.info("[stx-reconcile] disabled (GALAXUS_STX_RECONCILE=0)");
    return;
  }
  const intervalMs = Math.max(
    Number(process.env.GALAXUS_STX_RECONCILE_INTERVAL_MS ?? 60 * 60_000) || 0,
    5 * 60_000
  );
  const initialDelayMs = Number(process.env.GALAXUS_STX_RECONCILE_INITIAL_DELAY_MS ?? 10 * 60_000);
  const tick = async () => {
    try {
      await runStxSnapshotReconcile(origin);
    } catch (err) {
      console.error("[stx-reconcile] run failed", err instanceof Error ? err.message : String(err));
    } finally {
      setTimeout(() => void tick(), intervalMs).unref?.();
    }
  };
  console.info("[stx-reconcile] loop start", { intervalMs, initialDelayMs });
  setTimeout(() => void tick(), initialDelayMs).unref?.();
}
