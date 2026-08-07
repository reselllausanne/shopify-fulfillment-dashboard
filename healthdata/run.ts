import { randomUUID } from "node:crypto";

import { prisma } from "@/app/lib/prisma";
import { HealthConfigError } from "@/healthdata/config";
import { toJsonSafe } from "@/healthdata/json";

export const EXIT_OK = 0;
export const EXIT_FAILED = 1;
export const EXIT_CONFIG_MISSING = 2;

export type RunStatus = "running" | "succeeded" | "failed";

export function log(event: string, payload: Record<string, unknown> = {}): void {
  console.info(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "health-data",
      event,
      ...(toJsonSafe(payload) as Record<string, unknown>),
    })
  );
}

export function logError(event: string, payload: Record<string, unknown> = {}): void {
  console.error(
    JSON.stringify({
      ts: new Date().toISOString(),
      scope: "health-data",
      level: "error",
      event,
      ...(toJsonSafe(payload) as Record<string, unknown>),
    })
  );
}

export type SyncRunHandle = {
  id: string;
  setStats: (stats: Record<string, unknown>) => Promise<void>;
};

async function createRun(
  provider: string,
  command: string,
  params: Record<string, unknown>,
  accountId: string | null
): Promise<string> {
  const id = randomUUID();
  await prisma.healthIntegrationSyncRun.create({
    data: {
      id,
      provider,
      command,
      status: "running",
      accountId,
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
  await prisma.healthIntegrationSyncRun.update({
    where: { id },
    data: {
      status,
      statsJson: toJsonSafe(stats) as object,
      error,
      finishedAt: new Date(),
    },
  });
}

export async function withSyncRun(
  provider: string,
  command: string,
  params: Record<string, unknown>,
  fn: (run: SyncRunHandle) => Promise<Record<string, unknown>>,
  options?: { accountId?: string | null; persist?: boolean }
): Promise<number> {
  const persist = options?.persist !== false;
  let runId: string | null = null;
  let stats: Record<string, unknown> = {};

  try {
    if (persist) {
      runId = await createRun(provider, command, params, options?.accountId ?? null);
    }
    const handle: SyncRunHandle = {
      id: runId ?? "ephemeral",
      setStats: async (next) => {
        stats = { ...stats, ...next };
        if (runId) {
          await prisma.healthIntegrationSyncRun.update({
            where: { id: runId },
            data: { statsJson: toJsonSafe(stats) as object },
          });
        }
      },
    };
    stats = await fn(handle);
    if (runId) await closeRun(runId, "succeeded", stats, null);
    log("command_ok", { provider, command, stats });
    return EXIT_OK;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof HealthConfigError) {
      logError("config_missing", { missing: err.missing });
      if (runId) await closeRun(runId, "failed", stats, message);
      return EXIT_CONFIG_MISSING;
    }
    logError("command_failed", { provider, command, error: message });
    if (runId) await closeRun(runId, "failed", stats, message);
    return EXIT_FAILED;
  }
}
