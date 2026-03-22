import { prisma } from "@/app/lib/prisma";
import type { OpsJobKey } from "./types";

const HOUR_MS = 60 * 60 * 1000;

export const DEFAULT_JOBS: Array<{
  jobKey: OpsJobKey;
  intervalMs: number;
  enabled: boolean;
}> = [
  { jobKey: "partner-stock-sync", intervalMs: 5 * HOUR_MS, enabled: true },
  { jobKey: "stx-refresh", intervalMs: 24 * HOUR_MS, enabled: true },
  { jobKey: "edi-in", intervalMs: 1 * HOUR_MS, enabled: true },
];

export async function ensureJobDefinitions() {
  const prismaAny = prisma as any;
  for (const job of DEFAULT_JOBS) {
    await prismaAny.galaxusJobDefinition.upsert({
      where: { jobKey: job.jobKey },
      create: {
        jobKey: job.jobKey,
        intervalMs: job.intervalMs,
        enabled: job.enabled,
      },
      update: {
        intervalMs: job.intervalMs,
        enabled: job.enabled,
      },
    });
  }
}

export async function listJobDefinitions() {
  await ensureJobDefinitions();
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.findMany({
    orderBy: { jobKey: "asc" },
  });
}

export async function updateJobDefinition(jobKey: OpsJobKey, data: Record<string, unknown>) {
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.update({
    where: { jobKey },
    data,
  });
}
