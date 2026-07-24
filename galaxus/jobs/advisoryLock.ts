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

/**
 * Transaction-scoped advisory lock — REQUIRED under pgbouncer transaction pooling.
 *
 * `withAdvisoryLock` uses a *session* advisory lock (`pg_try_advisory_lock`) released by a *separate*
 * `pg_advisory_unlock` query. With pgbouncer in transaction mode each statement can land on a
 * different backend, so the unlock frequently runs on the wrong connection and the lock LEAKS on the
 * original backend until it idles out (minutes) — this is what silently starved the nightly
 * `push-master-specs` step.
 *
 * `pg_try_advisory_xact_lock` is held on the single connection pinned to the interactive transaction
 * and auto-released at COMMIT/ROLLBACK. Only use this for SHORT critical sections (the lock is held
 * for the whole transaction) — do NOT wrap heavy multi-minute work in it.
 */
export async function withAdvisoryXactLock<T>(
  lockName: string,
  handler: () => Promise<T>,
  options?: { timeoutMs?: number; maxWaitMs?: number }
): Promise<{ locked: true; result: T } | { locked: false; skipped: "locked" }> {
  return prisma.$transaction(
    async (tx) => {
      const rows = await tx.$queryRaw<Array<{ locked: boolean }>>(
        Prisma.sql`SELECT pg_try_advisory_xact_lock(hashtext(${lockName})) AS locked`
      );
      const locked = Boolean(rows?.[0]?.locked);
      if (!locked) return { locked: false, skipped: "locked" as const };
      const result = await handler();
      return { locked: true, result };
    },
    { timeout: options?.timeoutMs ?? 20000, maxWait: options?.maxWaitMs ?? 5000 }
  );
}

