#!/usr/bin/env npx tsx
/**
 * Galaxus EDI inbound worker (off-web).
 *
 * Schedules (Europe/Zurich):
 *   - every 5 min: direct_delivery ORDP (+ CANP)
 *   - daily 12:05: warehouse_delivery ORDP (+ CANP, + unspecified)
 *
 * Resilience:
 *   - compose `restart: unless-stopped`
 *   - tick try/catch — process never exits on SFTP/DB errors
 *   - pg advisory lock `galaxus:ops:edi-in` (same as ops tick)
 *   - last-run persisted in GalaxusJobDefinition → catch-up after downtime
 *   - filtered poll leaves the other delivery type on SFTP
 *
 * Requires NODE_OPTIONS=--require ./scripts/workers/stubServerOnly.cjs
 * (compose sets this) so `server-only` imports under tsx do not throw.
 *
 * Env:
 *   GALAXUS_EDI_WORKER_LOOP_MS              default 15000
 *   GALAXUS_EDI_DIRECT_INTERVAL_MS          default 300000 (5 min)
 *   GALAXUS_EDI_WAREHOUSE_HOUR              default 12
 *   GALAXUS_EDI_WAREHOUSE_MINUTE            default 5
 *   GALAXUS_EDI_DIRECT_SFTP_TIMEOUT_MS      default 120000
 *   GALAXUS_EDI_WAREHOUSE_SFTP_TIMEOUT_MS   default 600000
 *   GALAXUS_EDI_WORKER_INITIAL_DELAY_MS     default 5000
 */
import { prisma } from "@/app/lib/prisma";
import { withAdvisoryLock } from "@/galaxus/jobs/advisoryLock";
import { runEdiInPipeline } from "@/galaxus/ops/orderPipeline";

const LOOP_MS = Number(process.env.GALAXUS_EDI_WORKER_LOOP_MS ?? 15_000);
const DIRECT_INTERVAL_MS = Number(process.env.GALAXUS_EDI_DIRECT_INTERVAL_MS ?? 5 * 60_000);
const WAREHOUSE_HOUR = Number(process.env.GALAXUS_EDI_WAREHOUSE_HOUR ?? 12);
const WAREHOUSE_MINUTE = Number(process.env.GALAXUS_EDI_WAREHOUSE_MINUTE ?? 5);
const DIRECT_TIMEOUT_MS = Number(process.env.GALAXUS_EDI_DIRECT_SFTP_TIMEOUT_MS ?? 120_000);
const WAREHOUSE_TIMEOUT_MS = Number(process.env.GALAXUS_EDI_WAREHOUSE_SFTP_TIMEOUT_MS ?? 600_000);
const INITIAL_DELAY_MS = Number(process.env.GALAXUS_EDI_WORKER_INITIAL_DELAY_MS ?? 5_000);

const LOCK_NAME = "galaxus:ops:edi-in";
const DIRECT_STATE_KEY = "edi-in-direct-worker";
const WAREHOUSE_STATE_KEY = "edi-in-warehouse-worker";
const TZ = "Europe/Zurich";

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getZurichClock(now = new Date()): { date: string; minutesSinceMidnight: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "0";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  let hour = Number(get("hour"));
  if (hour === 24) hour = 0;
  const minute = Number(get("minute"));
  return { date, minutesSinceMidnight: hour * 60 + minute };
}

async function getLastRunAt(jobKey: string): Promise<Date | null> {
  const row = await (prisma as any).galaxusJobDefinition.findUnique({
    where: { jobKey },
    select: { lastRunAt: true },
  });
  return row?.lastRunAt ? new Date(row.lastRunAt) : null;
}

async function markRun(jobKey: string, at: Date) {
  await (prisma as any).galaxusJobDefinition.upsert({
    where: { jobKey },
    create: {
      jobKey,
      intervalMs: jobKey === DIRECT_STATE_KEY ? DIRECT_INTERVAL_MS : 24 * 60 * 60_000,
      enabled: true,
      lastRunAt: at,
      nextRunAt: null,
    },
    update: {
      lastRunAt: at,
      enabled: true,
    },
  });
}

function isDirectDue(lastRunAt: Date | null, now: Date): boolean {
  if (!lastRunAt) return true;
  return now.getTime() - lastRunAt.getTime() >= DIRECT_INTERVAL_MS;
}

function isWarehouseDue(lastRunAt: Date | null, now: Date): boolean {
  const { date, minutesSinceMidnight } = getZurichClock(now);
  const threshold = WAREHOUSE_HOUR * 60 + WAREHOUSE_MINUTE;
  if (minutesSinceMidnight < threshold) return false;
  if (!lastRunAt) return true;
  const lastDate = getZurichClock(lastRunAt).date;
  return lastDate !== date;
}

async function tick() {
  const now = new Date();
  const [lastDirect, lastWarehouse] = await Promise.all([
    getLastRunAt(DIRECT_STATE_KEY),
    getLastRunAt(WAREHOUSE_STATE_KEY),
  ]);

  const wantWarehouse = isWarehouseDue(lastWarehouse, now);
  const wantDirect = isDirectDue(lastDirect, now);
  if (!wantWarehouse && !wantDirect) return;

  // One lock for the whole tick so warehouse→direct does not race unlock.
  const locked = await withAdvisoryLock(LOCK_NAME, async () => {
    if (wantWarehouse) {
      const startedAt = new Date().toISOString();
      const pipeline = await runEdiInPipeline({
        deliveryMode: "warehouse",
        timeoutMs: WAREHOUSE_TIMEOUT_MS,
      });
      console.info("[WORKER][GALAXUS_EDI] warehouse", {
        startedAt,
        filesProcessed: pipeline.filesProcessed,
        ordersIngested: pipeline.ordersIngested,
        ordrSent: pipeline.ordrSent,
        ordrFailed: pipeline.ordrFailed,
        errors: pipeline.errors.slice(0, 5),
      });
      await markRun(WAREHOUSE_STATE_KEY, now);
    }
    if (wantDirect) {
      const startedAt = new Date().toISOString();
      const pipeline = await runEdiInPipeline({
        deliveryMode: "direct",
        timeoutMs: DIRECT_TIMEOUT_MS,
      });
      console.info("[WORKER][GALAXUS_EDI] direct", {
        startedAt,
        filesProcessed: pipeline.filesProcessed,
        ordersIngested: pipeline.ordersIngested,
        ordrSent: pipeline.ordrSent,
        ordrFailed: pipeline.ordrFailed,
        errors: pipeline.errors.slice(0, 5),
      });
      await markRun(DIRECT_STATE_KEY, now);
    }
  });

  if (!locked.locked) {
    console.info("[WORKER][GALAXUS_EDI] tick skipped — advisory lock held");
  }
}

async function main() {
  const zurich = getZurichClock();
  console.info("[WORKER][GALAXUS_EDI] starting", {
    loopMs: LOOP_MS,
    directIntervalMs: DIRECT_INTERVAL_MS,
    warehouseAt: `${String(WAREHOUSE_HOUR).padStart(2, "0")}:${String(WAREHOUSE_MINUTE).padStart(2, "0")} ${TZ}`,
    zurichNow: `${zurich.date} +${zurich.minutesSinceMidnight}m`,
    directTimeoutMs: DIRECT_TIMEOUT_MS,
    warehouseTimeoutMs: WAREHOUSE_TIMEOUT_MS,
  });

  await sleep(INITIAL_DELAY_MS);

  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      await tick();
    } catch (err: unknown) {
      console.error(
        "[WORKER][GALAXUS_EDI] tick failed",
        err instanceof Error ? err.message : err
      );
    }
    await sleep(LOOP_MS);
  }
}

main().catch((error) => {
  console.error("[WORKER][GALAXUS_EDI] fatal", error);
  process.exitCode = 1;
});
