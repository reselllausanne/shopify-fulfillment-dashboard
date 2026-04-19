import { prisma } from "@/app/lib/prisma";
import type { DecathlonOpsJobKey } from "./types";

const HOUR_MS = 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;

export const DEFAULT_DECATHLON_JOBS: Array<{
  jobKey: DecathlonOpsJobKey;
  intervalMs: number;
  enabled: boolean;
}> = [
  { jobKey: "decathlon-stock-sync", intervalMs: 15 * MINUTE_MS, enabled: true },
  { jobKey: "decathlon-price-sync", intervalMs: 1 * HOUR_MS, enabled: true },
  { jobKey: "decathlon-offer-sync", intervalMs: 24 * HOUR_MS, enabled: true },
];

export async function ensureDecathlonJobDefinitions() {
  const prismaAny = prisma as any;
  for (const job of DEFAULT_DECATHLON_JOBS) {
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

export async function listDecathlonJobDefinitions() {
  await ensureDecathlonJobDefinitions();
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.findMany({
    where: { jobKey: { in: DEFAULT_DECATHLON_JOBS.map((job) => job.jobKey) } },
    orderBy: { jobKey: "asc" },
  });
}

export async function updateDecathlonJobDefinition(jobKey: DecathlonOpsJobKey, data: Record<string, unknown>) {
  const prismaAny = prisma as any;
  return prismaAny.galaxusJobDefinition.update({
    where: { jobKey },
    data,
  });
}
