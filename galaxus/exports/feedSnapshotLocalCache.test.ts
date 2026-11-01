import { mkdtemp, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearSnapshotLocalCache,
  readSnapshotLocalCache,
  writeSnapshotLocalCache,
  type SnapshotLocalCache,
} from "@/galaxus/exports/feedSnapshotLocalCache";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "feed-snapshot-cache-"));
  process.env.GALAXUS_FEED_SNAPSHOT_CACHE_DIR = dir;
});

afterEach(async () => {
  delete process.env.GALAXUS_FEED_SNAPSHOT_CACHE_DIR;
  await rm(dir, { recursive: true, force: true });
});

function sampleCache(): SnapshotLocalCache {
  return {
    rebuiltAt: "2026-11-01T02:00:00.000Z",
    maxUpdatedAtMs: 1793500000000,
    rows: new Map<string, Record<string, string>>([
      ["STX_123", { ProviderKey: "STX_123", QuantityOnStock: "2" }],
      ["REI_456", { ProviderKey: "REI_456", QuantityOnStock: "0" }],
      // Values with CSV-hostile characters must survive the JSONL round trip.
      ["VEN_789", { ProviderKey: "VEN_789", Note: 'has "quotes", commas\nand newlines' }],
    ]),
  };
}

describe("feedSnapshotLocalCache", () => {
  it("returns null when no cache file exists", async () => {
    expect(await readSnapshotLocalCache("stock")).toBeNull();
  });

  it("round-trips meta and rows", async () => {
    const cache = sampleCache();
    await writeSnapshotLocalCache("stock", cache);
    const read = await readSnapshotLocalCache("stock");
    expect(read).not.toBeNull();
    expect(read!.rebuiltAt).toBe(cache.rebuiltAt);
    expect(read!.maxUpdatedAtMs).toBe(cache.maxUpdatedAtMs);
    expect(read!.rows.size).toBe(3);
    expect(read!.rows.get("VEN_789")).toEqual({
      ProviderKey: "VEN_789",
      Note: 'has "quotes", commas\nand newlines',
    });
  });

  it("keeps stock and offer caches separate", async () => {
    await writeSnapshotLocalCache("stock", sampleCache());
    expect(await readSnapshotLocalCache("offer")).toBeNull();
  });

  it("rejects a truncated cache file (rowCount mismatch)", async () => {
    await writeSnapshotLocalCache("stock", sampleCache());
    const filePath = join(dir, "stock-snapshot.jsonl");
    const content = await readFile(filePath, "utf8");
    const lines = content.split("\n").filter(Boolean);
    // Drop the last row line — simulates a crash mid-write without tmp+rename.
    await writeFile(filePath, lines.slice(0, -1).join("\n") + "\n");
    expect(await readSnapshotLocalCache("stock")).toBeNull();
  });

  it("clearSnapshotLocalCache removes the file", async () => {
    await writeSnapshotLocalCache("offer", sampleCache());
    await clearSnapshotLocalCache("offer");
    expect(await readSnapshotLocalCache("offer")).toBeNull();
  });

  it("overwrites atomically on rewrite", async () => {
    const cache = sampleCache();
    await writeSnapshotLocalCache("stock", cache);
    cache.rows.delete("REI_456");
    cache.maxUpdatedAtMs += 1000;
    await writeSnapshotLocalCache("stock", cache);
    const read = await readSnapshotLocalCache("stock");
    expect(read!.rows.size).toBe(2);
    expect(read!.maxUpdatedAtMs).toBe(cache.maxUpdatedAtMs);
  });
});
