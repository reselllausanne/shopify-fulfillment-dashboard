import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";

export async function withAdvisoryLock<T>(
  lockName: string,
  handler: () => Promise<T>
): Promise<{ locked: true; result: T } | { locked: false; skipped: "locked" }> {
  // IMPORTANT:
  // Do NOT wrap the whole handler inside `prisma.$transaction()`.
  // With small connection pools (connection_limit=1), the transaction keeps the single
  // connection busy for the whole duration, and the handler's Prisma queries try to
  // acquire a second connection -> pool timeout.
  //
  // We instead use `pg_try_advisory_lock` and always unlock in a finally block.
  const rows = await prisma.$queryRaw<Array<{ locked: boolean }>>(
    Prisma.sql`SELECT pg_try_advisory_lock(hashtext(${lockName})) AS locked`
  );
  const locked = Boolean(rows?.[0]?.locked);
  if (!locked) return { locked: false, skipped: "locked" as const };

  try {
    const result = await handler();
    return { locked: true, result };
  } finally {
    // Release the advisory lock even if the handler throws.
    await prisma.$queryRaw(Prisma.sql`SELECT pg_advisory_unlock(hashtext(${lockName}))`);
  }
}

