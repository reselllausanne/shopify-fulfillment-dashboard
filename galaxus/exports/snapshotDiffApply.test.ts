import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafe = vi.fn();
const executeRawUnsafe = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
  },
}));

import {
  SNAPSHOT_DIFF_CHUNK_SIZE,
  applySnapshotDiff,
  dedupeRowsByProviderKey,
  deleteSnapshotKeys,
  findStaleSnapshotKeys,
  upsertChangedSnapshotRows,
} from "@/galaxus/exports/snapshotDiffApply";

const T0 = new Date("2026-11-11T10:00:00Z");
const key = (prefix: string, n: number) => `${prefix}${String(n).padStart(7, "0")}`;

beforeEach(() => {
  queryRawUnsafe.mockReset();
  executeRawUnsafe.mockReset();
});

describe("dedupeRowsByProviderKey", () => {
  it("first wins, counts duplicates, skips blank keys", () => {
    const { unique, duplicates } = dedupeRowsByProviderKey([
      { ProviderKey: "A", q: "1" },
      { ProviderKey: " A ", q: "2" },
      { ProviderKey: "", q: "3" },
      { ProviderKey: "B", q: "4" },
    ]);
    expect([...unique.keys()]).toEqual(["A", "B"]);
    expect(unique.get("A")?.q).toBe("1");
    expect(duplicates).toBe(1);
  });
});

describe("upsertChangedSnapshotRows", () => {
  it("writes only changed rows and never overwrites rows patched after the export started", async () => {
    executeRawUnsafe.mockResolvedValueOnce(2);
    const n = await upsertChangedSnapshotRows(
      "GalaxusFeedStockSnapshot",
      [
        ["A", { ProviderKey: "A", Q: "1" }],
        ["B", { ProviderKey: "B", Q: "2" }],
      ],
      T0
    );
    expect(n).toBe(2);
    const [sql, keys, values, , guard] = executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("IS DISTINCT FROM");
    expect(sql).toContain(`"GalaxusFeedStockSnapshot"."updatedAt" <= $4::timestamp`);
    expect(keys).toEqual(["A", "B"]);
    expect(JSON.parse(values[1])).toEqual({ ProviderKey: "B", Q: "2" });
    expect(guard).toBe(T0);
  });

  it("rejects tables outside the allowlist", async () => {
    await expect(upsertChangedSnapshotRows("Evil" as any, [["A", {}]], T0)).rejects.toThrow(/not allowed/);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
  });
});

describe("findStaleSnapshotKeys", () => {
  it("pulls keys only for buckets whose count differs and respects the keep set", async () => {
    const keep = new Map<string, unknown>();
    for (let i = 0; i < 3; i++) keep.set(key("AAAAAAAAAA", i), {});
    for (let i = 0; i < 2; i++) keep.set(key("BBBBBBBBBB", i), {});

    queryRawUnsafe
      .mockResolvedValueOnce([
        { b: "AAAAAAAAAA", c: 4 }, // one extra stale key
        { b: "BBBBBBBBBB", c: 2 },
      ])
      .mockResolvedValueOnce([
        { providerKey: key("AAAAAAAAAA", 0) },
        { providerKey: key("AAAAAAAAAA", 1) },
        { providerKey: key("AAAAAAAAAA", 2) },
        { providerKey: key("AAAAAAAAAA", 99) },
      ]);

    const stale = await findStaleSnapshotKeys("GalaxusFeedOfferSnapshot", keep, T0);
    expect(stale).toEqual([key("AAAAAAAAAA", 99)]);
    const [sql, buckets, guard] = queryRawUnsafe.mock.calls[1];
    expect(sql).toContain(`"updatedAt" <= $2::timestamp`);
    expect(buckets).toEqual(["AAAAAAAAAA"]);
    expect(guard).toBe(T0);
  });

  it("pulls nothing when buckets already match", async () => {
    const keep = new Map<string, unknown>([[key("AAAAAAAAAA", 1), {}]]);
    queryRawUnsafe.mockResolvedValueOnce([{ b: "AAAAAAAAAA", c: 1 }]);
    expect(await findStaleSnapshotKeys("GalaxusFeedOfferSnapshot", keep, T0)).toEqual([]);
    expect(queryRawUnsafe).toHaveBeenCalledTimes(1);
  });
});

describe("deleteSnapshotKeys", () => {
  it("deletes in chunks with the updatedAt guard", async () => {
    executeRawUnsafe.mockResolvedValue(2000);
    const keys = Array.from({ length: 2500 }, (_, i) => key("ZZZZZZZZZZ", i));
    await deleteSnapshotKeys("GalaxusFeedOfferSnapshot", keys, T0);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(2);
    expect(executeRawUnsafe.mock.calls[0][0]).toContain(`"updatedAt" <= $2::timestamp`);
  });
});

describe("applySnapshotDiff", () => {
  it("refuses an empty export instead of wiping the table", async () => {
    await expect(
      applySnapshotDiff({ table: "GalaxusFeedStockSnapshot", rows: [], exportStartedAt: T0 })
    ).rejects.toThrow(/empty export/);
    expect(executeRawUnsafe).not.toHaveBeenCalled();
    expect(queryRawUnsafe).not.toHaveBeenCalled();
  });

  it("upserts in chunks, then deletes only stale keys; never issues an unscoped delete", async () => {
    const n = SNAPSHOT_DIFF_CHUNK_SIZE + 5;
    const rows = Array.from({ length: n }, (_, i) => ({ ProviderKey: key("CCCCCCCCCC", i), Q: "1" }));
    rows.push({ ProviderKey: key("CCCCCCCCCC", 0), Q: "dup" });

    executeRawUnsafe.mockResolvedValueOnce(10).mockResolvedValueOnce(3).mockResolvedValueOnce(1);
    queryRawUnsafe
      .mockResolvedValueOnce([{ b: "CCCCCCCCCC", c: n + 1 }])
      .mockResolvedValueOnce([
        ...rows.slice(0, n).map((r) => ({ providerKey: r.ProviderKey })),
        { providerKey: key("CCCCCCCCCC", 9999) },
      ]);

    const res = await applySnapshotDiff({ table: "GalaxusFeedStockSnapshot", rows, exportStartedAt: T0 });
    expect(res).toEqual({ keys: n, written: 13, deleted: 1, duplicates: 1 });
    expect(executeRawUnsafe).toHaveBeenCalledTimes(3); // 2 upsert chunks + 1 delete
    expect(executeRawUnsafe.mock.calls[2][0]).toMatch(/^DELETE FROM "GalaxusFeedStockSnapshot" WHERE "providerKey" = ANY/);
    expect(executeRawUnsafe.mock.calls[2][1]).toEqual([key("CCCCCCCCCC", 9999)]);
  });
});
