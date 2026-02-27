import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export async function withAdvisoryLock<T>(
  lockName: string,
  handler: () => Promise<T>
): Promise<{ locked: true; result: T } | { locked: false; skipped: "locked" }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS locked`
      );
      const locked = Boolean(rows?.[0]?.locked);
      if (!locked) return { locked: false, skipped: "locked" as const };

      // xact lock is released automatically when this transaction ends.
      const result = await handler();
      return { locked: true, result };
    },
    {
      maxWait: 10_000,
      timeout: 30 * 60 * 1000,
    }
  );
}

