import { createReadStream, createWriteStream } from "fs";
import { mkdir, rename, rm } from "fs/promises";
import { createInterface } from "readline";
import { join } from "path";

/**
 * Local disk cache for Galaxus stock/offer feed snapshot rows.
 *
 * Why: every feed push used to pull the FULL GalaxusFeed{Stock,Offer}Snapshot tables
 * (~1.6M rows × ~300B ≈ 0.5GB per scope) from Supabase just to re-serialize the same
 * CSV — at ~100 pushes/day that was ~90GB/day of DB egress (the Supabase bill).
 * The tables only change via (a) full rebuild (meta.rebuiltAt changes) and (b)
 * per-key patches (upserts bump `updatedAt`, deletes shrink the row count). So the
 * feed worker keeps the rows on disk (shared `.data` volume) and per push pulls only
 * rows newer than the cache watermark; deletes reconcile via a key-only pull and any
 * drift falls back to a full reload. Fail-safe: any cache error → full DB pull.
 *
 * File format (single file, atomic tmp+rename): line 1 is the meta JSON, every
 * following line is `[providerKey, rowJson]`.
 */

export type SnapshotRow = Record<string, string>;

export type SnapshotLocalCache = {
  /** ISO of GalaxusFeedSnapshotMeta.rebuiltAt the cache was built against. */
  rebuiltAt: string;
  /** Max row `updatedAt` (epoch ms) seen — incremental pull watermark. */
  maxUpdatedAtMs: number;
  rows: Map<string, SnapshotRow>;
};

function cacheDir(): string {
  return (
    String(process.env.GALAXUS_FEED_SNAPSHOT_CACHE_DIR ?? "").trim() ||
    ".data/galaxus-feed-cache"
  );
}

function cacheFilePath(scope: "stock" | "offer"): string {
  return join(cacheDir(), `${scope}-snapshot.jsonl`);
}

export async function readSnapshotLocalCache(
  scope: "stock" | "offer"
): Promise<SnapshotLocalCache | null> {
  const filePath = cacheFilePath(scope);
  let meta: { rebuiltAt?: unknown; maxUpdatedAtMs?: unknown; rowCount?: unknown } | null = null;
  const rows = new Map<string, SnapshotRow>();

  const stream = createReadStream(filePath, { encoding: "utf8" });
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  try {
    for await (const line of lines) {
      if (!line) continue;
      if (meta === null) {
        meta = JSON.parse(line);
        continue;
      }
      const [providerKey, rowJson] = JSON.parse(line) as [string, SnapshotRow];
      if (providerKey) rows.set(providerKey, rowJson);
    }
  } catch (err: any) {
    // Missing file is the normal cold-start case; anything else is a corrupt cache.
    if (err?.code === "ENOENT") return null;
    throw err;
  } finally {
    lines.close();
    stream.destroy();
  }

  const rebuiltAt = String(meta?.rebuiltAt ?? "").trim();
  const maxUpdatedAtMs = Number(meta?.maxUpdatedAtMs ?? NaN);
  const rowCount = Number(meta?.rowCount ?? NaN);
  if (!rebuiltAt || !Number.isFinite(maxUpdatedAtMs)) return null;
  // Truncated write (crash mid-stream) — treat as no cache.
  if (Number.isFinite(rowCount) && rowCount !== rows.size) return null;

  return { rebuiltAt, maxUpdatedAtMs, rows };
}

export async function writeSnapshotLocalCache(
  scope: "stock" | "offer",
  cache: SnapshotLocalCache
): Promise<void> {
  await mkdir(cacheDir(), { recursive: true });
  const filePath = cacheFilePath(scope);
  const tmpPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;

  const ws = createWriteStream(tmpPath, { encoding: "utf8" });
  const write = (chunk: string): Promise<void> =>
    new Promise((resolve, reject) => {
      ws.write(chunk, (err) => (err ? reject(err) : resolve()));
    });

  try {
    await write(
      `${JSON.stringify({
        rebuiltAt: cache.rebuiltAt,
        maxUpdatedAtMs: cache.maxUpdatedAtMs,
        rowCount: cache.rows.size,
      })}\n`
    );
    // Batch lines so we do not issue 1.6M tiny writes.
    const BATCH = 5000;
    let buffer: string[] = [];
    for (const [providerKey, rowJson] of cache.rows) {
      buffer.push(JSON.stringify([providerKey, rowJson]));
      if (buffer.length >= BATCH) {
        await write(buffer.join("\n") + "\n");
        buffer = [];
      }
    }
    if (buffer.length > 0) await write(buffer.join("\n") + "\n");
    await new Promise<void>((resolve, reject) => {
      ws.end((err?: Error | null) => (err ? reject(err) : resolve()));
    });
    await rename(tmpPath, filePath);
  } catch (err) {
    ws.destroy();
    await rm(tmpPath, { force: true }).catch(() => undefined);
    throw err;
  }
}

/** Remove the cache file (e.g. after irrecoverable drift) so next load starts cold. */
export async function clearSnapshotLocalCache(scope: "stock" | "offer"): Promise<void> {
  await rm(cacheFilePath(scope), { force: true }).catch(() => undefined);
}
