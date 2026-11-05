/**
 * Retry wrapper for transient Postgres/Prisma failures during long-running
 * Galaxus jobs (master/specs snapshot rebuild runs ~5h; a single dropped
 * connection or statement timeout must not restart the whole job).
 *
 * Retries only page/chunk-level reads and idempotent writes (createMany with
 * skipDuplicates, meta upserts). Non-transient errors rethrow immediately.
 */

const TRANSIENT_PRISMA_CODES = new Set([
  "P1001", // can't reach database server
  "P1002", // server reached but timed out
  "P1008", // operations timed out
  "P1017", // server has closed the connection
  "P2024", // connection pool timeout
]);

/** Postgres SQLSTATEs surfaced via P2010 (raw query failed). */
const TRANSIENT_PG_CODES = new Set([
  "57014", // canceling statement due to statement timeout
  "57P01", // admin_shutdown
  "57P02", // crash_shutdown
  "57P03", // cannot_connect_now
  "08006", // connection_failure
  "08003", // connection_does_not_exist
]);

const TRANSIENT_MESSAGE_RE =
  /connection (reset|closed|terminated)|server has closed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EPIPE|socket hang up|statement timeout/i;

export function isTransientDbError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const anyErr = err as { code?: unknown; meta?: { code?: unknown }; message?: unknown };
  const code = String(anyErr.code ?? "");
  if (TRANSIENT_PRISMA_CODES.has(code)) return true;
  if (code === "P2010" && TRANSIENT_PG_CODES.has(String(anyErr.meta?.code ?? ""))) return true;
  return TRANSIENT_MESSAGE_RE.test(String(anyErr.message ?? ""));
}

const DEFAULT_ATTEMPTS = 5;
const BACKOFF_MS = [5_000, 15_000, 30_000, 60_000, 120_000];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withTransientDbRetry<T>(
  label: string,
  fn: () => Promise<T>,
  opts?: { attempts?: number }
): Promise<T> {
  const attempts = Math.max(1, opts?.attempts ?? DEFAULT_ATTEMPTS);
  let lastErr: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!isTransientDbError(err) || attempt === attempts) throw err;
      const waitMs = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      console.warn("[GALAXUS][DB][RETRY] transient failure — retrying", {
        label,
        attempt,
        attempts,
        waitMs,
        error: String((err as Error)?.message ?? err).slice(0, 200),
      });
      await sleep(waitMs);
    }
  }
  throw lastErr;
}
