import type { Prisma, PrismaClient } from "@prisma/client";
import { isRetryableTxError } from "./errors";

export type WarehouseDb = PrismaClient;
export type WarehouseTx = Prisma.TransactionClient;
/** Anything that can run a query: the client or an open transaction. */
export type WarehouseConn = WarehouseDb | WarehouseTx;

let cached: WarehouseDb | null = null;

/** Application Prisma client (lazy import so pure helpers and tests never open a connection). */
export async function getWarehouseDb(): Promise<WarehouseDb> {
  if (cached) return cached;
  const mod = await import("@/app/lib/prisma");
  cached = mod.prisma as unknown as WarehouseDb;
  return cached;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Run `fn` in one READ COMMITTED transaction. Deadlocks / serialization failures / pooler
 * hiccups roll back and are retried (the body must only touch the database).
 */
export async function withTx<T>(
  db: WarehouseDb,
  fn: (tx: WarehouseTx) => Promise<T>,
  opts: { retries?: number; timeoutMs?: number } = {}
): Promise<T> {
  const retries = opts.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await db.$transaction(fn, { maxWait: 15_000, timeout: opts.timeoutMs ?? 20_000 });
    } catch (err) {
      lastError = err;
      if (attempt >= retries || !isRetryableTxError(err)) throw err;
      await sleep(15 * (attempt + 1) + Math.floor(Math.random() * 25));
    }
  }
  throw lastError;
}

/** JSON-safe copy (Date → ISO string, BigInt → string) for stored operation results and API payloads. */
export function toPlain<T>(value: T): T {
  return JSON.parse(
    JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v))
  ) as T;
}
