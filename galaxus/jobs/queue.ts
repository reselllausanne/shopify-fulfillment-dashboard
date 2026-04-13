import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export type QueueJob = {
  id: string;
  jobType: string;
  status: string;
  groupKey?: string | null;
  payloadJson: unknown;
  resultJson?: unknown;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  errorMessage?: string | null;
};

export async function enqueueJob<T extends Record<string, unknown>>(
  jobType: string,
  payload: T,
  options?: { priority?: number; maxAttempts?: number; groupKey?: string | null }
): Promise<QueueJob> {
  return (prisma as any).galaxusJobQueue.create({
    data: {
      jobType,
      status: "PENDING",
      groupKey: options?.groupKey ?? null,
      payloadJson: payload,
      priority: options?.priority ?? 0,
      maxAttempts: options?.maxAttempts ?? 5,
    },
  });
}

export async function claimJob(
  jobType: string,
  workerId: string,
  options?: { groupLimit?: number }
): Promise<QueueJob | null> {
  const groupLimit = Math.max(Number(options?.groupLimit ?? 0), 0);
  const staleMs = Math.max(Number(process.env.WORKER_STALE_MS ?? "900000"), 0);
  if (staleMs > 0) {
    await prisma.$executeRaw(Prisma.sql`
      UPDATE "public"."GalaxusJobQueue"
      SET
        "status" = 'PENDING',
        "lockedAt" = NULL,
        "lockedBy" = NULL,
        "updatedAt" = NOW()
      WHERE "status" = 'RUNNING'
        AND "lockedAt" IS NOT NULL
        AND "lockedAt" < NOW() - (${staleMs} * INTERVAL '1 millisecond')
    `);
  }

  const blockedGroups = groupLimit > 0
    ? await prisma.$queryRaw<Array<{ groupKey: string }>>(Prisma.sql`
        SELECT "groupKey"
        FROM "public"."GalaxusJobQueue"
        WHERE "status" = 'RUNNING' AND "groupKey" IS NOT NULL
        GROUP BY "groupKey"
        HAVING COUNT(*) >= ${groupLimit}
      `)
    : [];
  const blockedSet = new Set(blockedGroups.map((r) => r.groupKey));

  const candidates = await prisma.$queryRaw<Array<{ id: string; groupKey: string | null }>>(Prisma.sql`
    SELECT "id", "groupKey"
    FROM "public"."GalaxusJobQueue"
    WHERE "status" = 'PENDING'
      AND "jobType" = ${jobType}
      AND "attempts" < "maxAttempts"
    ORDER BY "priority" DESC, "createdAt" ASC
    LIMIT 20
  `);

  const pick = candidates.find((c) => !c.groupKey || !blockedSet.has(c.groupKey));
  if (!pick) {
    if (candidates.length > 0) {
      console.warn("[queue] candidates found but all blocked by group limit", {
        candidates: candidates.length,
        blocked: [...blockedSet],
      });
    }
    return null;
  }

  const rows = await prisma.$queryRaw<Array<QueueJob>>(Prisma.sql`
    UPDATE "public"."GalaxusJobQueue"
    SET
      "status" = 'RUNNING',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      "attempts" = "attempts" + 1,
      "startedAt" = COALESCE("startedAt", NOW()),
      "updatedAt" = NOW()
    WHERE "id" = ${pick.id}
      AND "status" = 'PENDING'
    RETURNING
      "id",
      "jobType",
      "status",
      "groupKey",
      "payloadJson",
      "resultJson",
      "attempts",
      "maxAttempts",
      "createdAt"
  `);
  return rows?.[0] ?? null;
}

export async function touchJob(id: string, workerId: string): Promise<boolean> {
  const result = await (prisma as any).galaxusJobQueue.updateMany({
    where: { id, status: "RUNNING", lockedBy: workerId },
    data: { lockedAt: new Date(), updatedAt: new Date() },
  });
  return (result?.count ?? 0) > 0;
}

export async function completeJob(id: string, result?: unknown): Promise<void> {
  await (prisma as any).galaxusJobQueue.update({
    where: { id },
    data: {
      status: "COMPLETED",
      finishedAt: new Date(),
      updatedAt: new Date(),
      resultJson: result ?? undefined,
    },
  });
}

export async function failJob(id: string, errorMessage: string | null, retry: boolean): Promise<void> {
  await (prisma as any).galaxusJobQueue.update({
    where: { id },
    data: {
      status: retry ? "PENDING" : "FAILED",
      errorMessage: errorMessage ?? undefined,
      lockedAt: null,
      lockedBy: null,
      updatedAt: new Date(),
      finishedAt: retry ? null : new Date(),
    },
  });
}

export async function getJob(id: string): Promise<QueueJob | null> {
  return (prisma as any).galaxusJobQueue.findUnique({ where: { id } });
}
