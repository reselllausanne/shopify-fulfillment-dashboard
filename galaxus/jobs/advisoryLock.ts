import { prisma } from "@/app/lib/prisma";
import { Prisma } from "@prisma/client";
import { Client } from "pg";

function resolveAdvisoryLockConnectionString(): string {
  const direct = process.env.DIRECT_URL?.trim();
  if (direct) return direct;
  const pooled = process.env.DATABASE_URL?.trim();
  if (pooled) return pooled;
  throw new Error("DIRECT_URL or DATABASE_URL required for advisory locks");
}

/**
 * Session advisory lock held on a dedicated `pg` connection for the whole handler.
 *
 * Do NOT use Prisma `$queryRaw` for session locks under Supabase/pgbouncer transaction
 * pooling — lock + unlock land on different backends and the lock LEAKS.
 *
 * Prefer DIRECT_URL (session mode, port 5432). Handler should use the normal Prisma
 * pool for business queries so the lock connection stays idle but held.
 */
export async function withAdvisoryLock<T>(
  lockName: string,
  handler: () => Promise<T>
): Promise<{ locked: true; result: T } | { locked: false; skipped: "locked" }> {
  const rawUrl = resolveAdvisoryLockConnectionString();
  // pg treats sslmode=require as verify-full; strip so rejectUnauthorized:false wins.
  const needsSsl = /sslmode=|supabase\.|amazonaws\.|\.pooler\./i.test(rawUrl);
  const connectionString = rawUrl
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/[?&]+$/g, "")
    .replace(/\?&/g, "?");
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 15_000,
    ssl: needsSsl ? { rejectUnauthorized: false } : undefined,
  });
  await client.connect();
  try {
    const rows = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [lockName]
    );
    const locked = Boolean(rows.rows?.[0]?.locked);
    if (!locked) return { locked: false, skipped: "locked" as const };

    try {
      const result = await handler();
      return { locked: true, result };
    } finally {
      await client.query("SELECT pg_advisory_unlock(hashtext($1))", [lockName]).catch(() => undefined);
    }
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Transaction-scoped advisory lock — REQUIRED under pgbouncer transaction pooling
 * when the critical section is SHORT.
 *
 * `pg_try_advisory_xact_lock` is held on the single connection pinned to the interactive
 * transaction and auto-released at COMMIT/ROLLBACK. Do NOT wrap heavy multi-minute work
 * in it — use `withAdvisoryLock` (dedicated session connection) instead.
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
    { timeout: options?.timeoutMs ?? 60000, maxWait: options?.maxWaitMs ?? 10000 }
  );
}
