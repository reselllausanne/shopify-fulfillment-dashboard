import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafe = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args) },
}));

import {
  SNAPSHOT_MAX_DIFF_BUCKETS,
  bucketOfKey,
  countByBucket,
  diffBuckets,
  reconcileDeletedKeysByBucket,
} from "@/galaxus/exports/snapshotDeleteReconcile";

beforeEach(() => queryRawUnsafe.mockReset());

describe("bucket helpers", () => {
  it("buckets by 10-char prefix", () => {
    expect(bucketOfKey("ALT_0010343929951")).toBe("ALT_001034");
    expect(countByBucket(["ALT_0010343929951", "ALT_0010343929975", "STX_0000000000001"]).get("ALT_001034")).toBe(2);
  });

  it("diffBuckets reports count changes and one-sided buckets", () => {
    const cache = new Map([["a", 2], ["b", 3], ["c", 1]]);
    const db = new Map([["a", 2], ["b", 2], ["d", 1]]);
    expect(diffBuckets(cache, db).sort()).toEqual(["b", "c", "d"]);
    expect(diffBuckets(db, db)).toEqual([]);
  });
});

describe("reconcileDeletedKeysByBucket", () => {
  const key = (prefix: string, n: number) => `${prefix}${String(n).padStart(7, "0")}`;

  it("removes only keys deleted in the DB, pulling keys of differing buckets only", async () => {
    const rows = new Map<string, unknown>();
    for (let i = 0; i < 3; i++) rows.set(key("AAAAAAAAAA", i), {}); // bucket AAAAAAAAAA: 3 cached
    for (let i = 0; i < 2; i++) rows.set(key("BBBBBBBBBB", i), {}); // bucket BBBBBBBBBB: 2 cached

    // DB deleted one row of bucket A, B unchanged.
    queryRawUnsafe.mockResolvedValueOnce([
      { b: "AAAAAAAAAA", c: 2 },
      { b: "BBBBBBBBBB", c: 2 },
    ]);
    queryRawUnsafe.mockResolvedValueOnce([
      { providerKey: key("AAAAAAAAAA", 0) },
      { providerKey: key("AAAAAAAAAA", 2) },
    ]);

    const res = await reconcileDeletedKeysByBucket("GalaxusFeedStockSnapshot", rows);
    expect(res).toEqual({ removed: 1, bucketsPulled: 1, keysPulled: 2 });
    expect(rows.has(key("AAAAAAAAAA", 1))).toBe(false);
    expect(rows.size).toBe(4);
    expect(rows.has(key("BBBBBBBBBB", 0))).toBe(true); // untouched bucket never pulled
    expect(queryRawUnsafe).toHaveBeenCalledTimes(2);
    expect(queryRawUnsafe.mock.calls[1][1]).toEqual(["AAAAAAAAAA"]); // only the differing bucket
  });

  it("no differing bucket → no key pull", async () => {
    const rows = new Map<string, unknown>([[key("AAAAAAAAAA", 0), {}]]);
    queryRawUnsafe.mockResolvedValueOnce([{ b: "AAAAAAAAAA", c: 1 }]);
    const res = await reconcileDeletedKeysByBucket("GalaxusFeedOfferSnapshot", rows);
    expect(res).toEqual({ removed: 0, bucketsPulled: 0, keysPulled: 0 });
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("too many differing buckets → null (caller does the full key pull), nothing deleted", async () => {
    const rows = new Map<string, unknown>();
    const dbBuckets: Array<{ b: string; c: number }> = [];
    for (let i = 0; i < SNAPSHOT_MAX_DIFF_BUCKETS + 1; i++) {
      const prefix = `P${String(i).padStart(9, "0")}`;
      rows.set(`${prefix}_x`, {});
      dbBuckets.push({ b: prefix, c: 2 });
    }
    queryRawUnsafe.mockResolvedValueOnce(dbBuckets);
    const res = await reconcileDeletedKeysByBucket("GalaxusFeedStockSnapshot", rows);
    expect(res).toBeNull();
    expect(rows.size).toBe(SNAPSHOT_MAX_DIFF_BUCKETS + 1);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown table names (SQL identifier is interpolated)", async () => {
    const res = await reconcileDeletedKeysByBucket("Users; DROP TABLE x" as any, new Map());
    expect(res).toBeNull();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });
});
