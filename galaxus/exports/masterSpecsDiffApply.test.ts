import { beforeEach, describe, expect, it, vi } from "vitest";

const queryRawUnsafe = vi.fn();
const executeRawUnsafe = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    $queryRawUnsafe: (...args: unknown[]) => queryRawUnsafe(...args),
    $executeRawUnsafe: (...args: unknown[]) => executeRawUnsafe(...args),
  },
}));

import { MasterSpecsDiffWriter } from "@/galaxus/exports/masterSpecsDiffApply";

const pk = (prefix: string, n: number) => `${prefix}${String(n).padStart(7, "0")}`;

beforeEach(() => {
  queryRawUnsafe.mockReset();
  executeRawUnsafe.mockReset();
});

describe("MasterSpecsDiffWriter", () => {
  it("master: first occurrence of a key wins across batches; unchanged rows are skipped by SQL", async () => {
    executeRawUnsafe.mockResolvedValue(1);
    const w = new MasterSpecsDiffWriter();
    const a = { providerKey: "STX_1", gtin: "g1", supplierKey: "STX", rowJson: { ProviderKey: "STX_1", v: "a" } };
    const dup = { ...a, rowJson: { ProviderKey: "STX_1", v: "later" } };
    expect(await w.upsertMaster([a, dup])).toBe(1);
    expect(await w.upsertMaster([dup])).toBe(0);
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    const [sql, keys, , , values] = executeRawUnsafe.mock.calls[0];
    expect(sql).toContain("IS DISTINCT FROM");
    expect(keys).toEqual(["STX_1"]);
    expect(JSON.parse(values[0]).v).toBe("a");
  });

  it("specs: composite key dedupe", async () => {
    executeRawUnsafe.mockResolvedValue(2);
    const w = new MasterSpecsDiffWriter();
    const n = await w.upsertSpecs([
      { providerKey: "A", specificationKey: "x", rowJson: {} },
      { providerKey: "A", specificationKey: "x", rowJson: {} },
      { providerKey: "A", specificationKey: "y", rowJson: {} },
    ]);
    expect(n).toBe(2);
    expect(w.seenSpecs.size).toBe(2);
  });

  it("sweep deletes only unseen master keys and never issues an unscoped delete", async () => {
    executeRawUnsafe.mockResolvedValue(1);
    const w = new MasterSpecsDiffWriter();
    for (let i = 0; i < 2; i++) {
      w.seenMaster.add(pk("AAAAAAAAAA", i));
    }
    queryRawUnsafe
      // master bucket counts: DB has 3 in bucket A (one stale)
      .mockResolvedValueOnce([{ b: "AAAAAAAAAA", c: 3 }])
      .mockResolvedValueOnce([
        { providerKey: pk("AAAAAAAAAA", 0) },
        { providerKey: pk("AAAAAAAAAA", 1) },
        { providerKey: pk("AAAAAAAAAA", 2) },
      ])
      // specs bucket counts: nothing seen, nothing in DB
      .mockResolvedValueOnce([]);
    const res = await w.sweep();
    expect(res).toEqual({ masterDeleted: 1, specsDeleted: 0 });
    expect(executeRawUnsafe).toHaveBeenCalledTimes(1);
    expect(executeRawUnsafe.mock.calls[0][0]).toContain(`"providerKey" = ANY($1::text[])`);
    expect(executeRawUnsafe.mock.calls[0][1]).toEqual([pk("AAAAAAAAAA", 2)]);
  });

  it("sweep deletes unseen spec rows by composite key", async () => {
    executeRawUnsafe.mockResolvedValue(1);
    const w = new MasterSpecsDiffWriter();
    await w.upsertSpecs([{ providerKey: pk("BBBBBBBBBB", 1), specificationKey: "k1", rowJson: {} }]);
    executeRawUnsafe.mockClear();
    queryRawUnsafe
      .mockResolvedValueOnce([]) // master counts: none
      .mockResolvedValueOnce([{ b: "BBBBBBBBBB", c: 2 }])
      .mockResolvedValueOnce([
        { providerKey: pk("BBBBBBBBBB", 1), specificationKey: "k1" },
        { providerKey: pk("BBBBBBBBBB", 1), specificationKey: "gone" },
      ]);
    const res = await w.sweep();
    expect(res.specsDeleted).toBe(1);
    const call = executeRawUnsafe.mock.calls[0];
    expect(call[0]).toContain("USING unnest");
    expect(call[2]).toEqual(["gone"]);
  });
});
