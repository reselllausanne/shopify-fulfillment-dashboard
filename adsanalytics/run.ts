import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { AdsConfigError } from "@/adsanalytics/config";
import { toJsonSafe } from "@/adsanalytics/json";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_CONFIG_MISSING = 2;

export type RunStatus = "running" | "succeeded" | "failed";

export function log(event: string, payload: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "ads-analytics",
      event,
      ...(toJsonSafe(payload) as Record<string, unknown>),
    })
  );
}

export function logError(event: string, payload: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "ads-analytics",
      level: "error",
      event,
      ...(toJsonSafe(payload) as Record<string, unknown>),
    })
  );
}

export type SyncRun = {
  id: string;
  command: string;
  /** Merged into stats_json on every write, so progress survives a crash. */
  setStats: (stats: Record<string, unknown>) => Promise<void>;
};

async function createRun(command: string, params: Record<string, unknown>): Promise<string> {
  const id = randomUUID();
  await prisma.adsSyncRun.create({
    data: {
      id,
      command,
      status: "running",
      paramsJson: toJsonSafe(params) as object,
    },
  });
  return id;
}

async function closeRun(
  id: string,
  status: RunStatus,
  stats: Record<string, unknown>,
  error: string | null
): Promise<void> {
  await prisma.adsSyncRun.update({
    where: { id },
    data: {
      status,
      statsJson: toJsonSafe(stats) as object,
      error,
      finishedAt: new Date(),
    },
  });
}

/**
 * Wrap a command in an `ads_sync_runs` row and translate its outcome into a
 * process exit code. Commands that do not touch the DB (probe) can opt out with
 * `persist: false`.
 */
export async function withSyncRun(
  command: string,
  params: Record<string, unknown>,
  handler: (run: SyncRun) => Promise<Record<string, unknown> | void>,
  options: { persist?: boolean } = {}
): Promise<number> {
  const persist = options.persist !== false;
  const stats: Record<string, unknown> = {};
  let runId: string | null = null;

  const setStats = async (patch: Record<string, unknown>): Promise<void> => {
    Object.assign(stats, patch);
    if (!runId) return;
    await prisma.adsSyncRun.update({
      where: { id: runId },
      data: { statsJson: toJsonSafe(stats) as object },
    });
  };

  try {
    if (persist) runId = await createRun(command, params);
    log("run.start", { command, runId, params });

    const result = await handler({ id: runId ?? "(not persisted)", command, setStats });
    if (result) Object.assign(stats, result);

    if (runId) await closeRun(runId, "succeeded", stats, null);
    log("run.succeeded", { command, runId, stats });
    return EXIT_OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (runId) await closeRun(runId, "failed", stats, message.slice(0, 4000));

    if (err instanceof AdsConfigError) {
      logError("run.config_missing", { command, runId, missing: err.missing, message });
      return EXIT_CONFIG_MISSING;
    }

    logError("run.failed", {
      command,
      runId,
      message,
      stack: err instanceof Error ? err.stack?.split("\n").slice(0, 5).join("\n") : undefined,
    });
    return EXIT_FAILED;
  }
}
