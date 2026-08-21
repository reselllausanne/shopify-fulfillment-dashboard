/**
 * Bound concurrent KickDB upserts on :3002.
 *
 * Unlimited parallel ingest saturates Postgres: each request then takes
 * minutes–hours, the SSE listener times out at 30s, marks the UUID "done",
 * and ignores that product for 12h while Galaxus keeps the stale buy.
 */
export type UpsertGate = {
  run: <T>(fn: () => Promise<T>) => Promise<{ ok: true; value: T } | { ok: false; busy: true }>;
  snapshot: () => { active: number; waiting: number };
};

export function createUpsertGate(params?: {
  concurrency?: number;
  maxWaiting?: number;
}): UpsertGate {
  const concurrency = Math.max(1, params?.concurrency ?? 2);
  const maxWaiting = Math.max(0, params?.maxWaiting ?? 8);
  let active = 0;
  const waiting: Array<() => void> = [];

  const wakeNext = () => {
    const next = waiting.shift();
    if (next) next();
  };

  return {
    snapshot: () => ({ active, waiting: waiting.length }),
    async run<T>(fn: () => Promise<T>) {
      if (active >= concurrency) {
        if (waiting.length >= maxWaiting) {
          return { ok: false as const, busy: true as const };
        }
        await new Promise<void>((resolve) => waiting.push(resolve));
      }
      active += 1;
      try {
        const value = await fn();
        return { ok: true as const, value };
      } finally {
        active -= 1;
        wakeNext();
      }
    },
  };
}

export const kickdbUpsertGate = createUpsertGate({
  // Skinny price upserts are ~1–3s; allow more parallel once gallery is off hot path.
  concurrency: Number(process.env.KICKDB_UPSERT_CONCURRENCY ?? 4),
  maxWaiting: Number(process.env.KICKDB_UPSERT_MAX_WAITING ?? 16),
});
