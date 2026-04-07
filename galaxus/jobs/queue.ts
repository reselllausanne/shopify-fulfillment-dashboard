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
  const rows = await prisma.$queryRaw<Array<QueueJob>>(Prisma.sql`
    WITH running_groups AS (
      SELECT "groupKey"
      FROM "public"."GalaxusJobQueue"
      WHERE "status" = 'RUNNING'
        AND "groupKey" IS NOT NULL
      GROUP BY "groupKey"
      HAVING COUNT(*) >= ${groupLimit}
    ),
    next AS (
      SELECT "id"
      FROM "public"."GalaxusJobQueue"
      WHERE "status" = 'PENDING'
        AND "jobType" = ${jobType}
        AND "attempts" < "maxAttempts"
        AND (
          ${groupLimit} = 0
          OR "groupKey" IS NULL
          OR "groupKey" NOT IN (SELECT "groupKey" FROM running_groups)
        )
      ORDER BY "priority" DESC, "createdAt" ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "public"."GalaxusJobQueue" AS q
    SET
      "status" = 'RUNNING',
      "lockedAt" = NOW(),
      "lockedBy" = ${workerId},
      "attempts" = q."attempts" + 1,
      "startedAt" = COALESCE(q."startedAt", NOW()),
      "updatedAt" = NOW()
    FROM next
    WHERE q."id" = next."id"
    RETURNING
      q."id",
      q."jobType",
      q."status",
      q."groupKey",
      q."payloadJson",
      q."resultJson",
      q."attempts",
      q."maxAttempts",
      q."createdAt";
  `);
  return rows?.[0] ?? null;
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
