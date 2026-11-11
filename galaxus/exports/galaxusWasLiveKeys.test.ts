import { describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

import {
  DELIST_SCOPE_MAX_KEYS,
  loadGalaxusDelistZeroEligibleKeys,
  shouldEmitGalaxusDelistZero,
} from "@/galaxus/exports/galaxusWasLiveKeys";

describe("shouldEmitGalaxusDelistZero", () => {
  it("emits zero only for eligible delist keys", () => {
    const eligible = new Set(["STX_NEED_ZERO"]);
    expect(shouldEmitGalaxusDelistZero("STX_NEED_ZERO", eligible)).toBe(true);
    expect(shouldEmitGalaxusDelistZero("STX_ALREADY_ZEROED", eligible)).toBe(false);
  });

  it("fails open when eligible set missing (load error)", () => {
    expect(shouldEmitGalaxusDelistZero("STX_ANY", null)).toBe(true);
  });

  it("rejects empty keys", () => {
    expect(shouldEmitGalaxusDelistZero("", new Set(["STX_1"]))).toBe(false);
    expect(shouldEmitGalaxusDelistZero(null, null)).toBe(false);
  });
});

function sqlText(strings: TemplateStringsArray): string {
  return strings.join("?");
}

describe("loadGalaxusDelistZeroEligibleKeys", () => {
  it("returns live keys that are not already zeroed in the stock snapshot", async () => {
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      const sql = sqlText(strings);
      if (sql.includes('FROM "ChannelListingState"')) {
        return [{ providerKey: "A" }, { providerKey: "B" }, { providerKey: " C " }, { providerKey: "D" }];
      }
      if (sql.includes('FROM "GalaxusFeedStockSnapshot"')) {
        return [{ providerKey: "B" }, { providerKey: "Z" }];
      }
      throw new Error(`unexpected sql: ${sql}`);
    });

    const keys = await loadGalaxusDelistZeroEligibleKeys();
    expect(Array.from(keys).sort()).toEqual(["A", "C", "D"]);
  });

  it("scoped lookup: same per-key answer as the full load, bound to the given keys", async () => {
    const seen: Array<{ sql: string; values: unknown[] }> = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray, ...values: unknown[]) => {
      const sql = sqlText(strings);
      seen.push({ sql, values });
      if (sql.includes('FROM "ChannelListingState"')) {
        // CLS live: A (not zeroed), B (already zeroed in snapshot)
        return [{ providerKey: "A" }, { providerKey: "B" }];
      }
      if (sql.includes('FROM "GalaxusFeedStockSnapshot"')) return [{ providerKey: "B" }];
      throw new Error(`unexpected sql: ${sql}`);
    });

    const set = await loadGalaxusDelistZeroEligibleKeys([" A ", "B", "C", "A", ""]);
    expect(seen).toHaveLength(2);
    for (const call of seen) {
      expect(call.sql).toMatch(/ANY\(\?::text\[\]\)/);
      expect(call.sql).not.toMatch(/JOIN/i);
      expect(call.values[0]).toEqual(["A", "B", "C"]);
    }
    expect(set.has("A")).toBe(true); // live, not zeroed → emit zero
    expect(set.has("B")).toBe(false); // already zeroed → skip
    expect(set.has("C")).toBe(false); // in scope, not live in CLS → skip (same as full load)
    expect(set.has("OUT_OF_SCOPE")).toBe(true); // outside scope → fail open (emit zero)
    expect(shouldEmitGalaxusDelistZero("OUT_OF_SCOPE", set)).toBe(true);
    expect(shouldEmitGalaxusDelistZero("B", set)).toBe(false);
  });

  it("scope larger than the cap falls back to the two full scans", async () => {
    const statements: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      statements.push(sqlText(strings));
      return [];
    });
    const many = Array.from({ length: DELIST_SCOPE_MAX_KEYS + 1 }, (_, i) => `K${i}`);
    await loadGalaxusDelistZeroEligibleKeys(many);
    expect(statements).toHaveLength(2);
    for (const sql of statements) expect(sql).not.toMatch(/ANY\(/);
  });

  it("empty / null scope keeps the full-scan behaviour", async () => {
    const statements: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      statements.push(sqlText(strings));
      return [];
    });
    await loadGalaxusDelistZeroEligibleKeys(null);
    await loadGalaxusDelistZeroEligibleKeys([]);
    expect(statements).toHaveLength(4);
    for (const sql of statements) expect(sql).not.toMatch(/ANY\(/);
  });

  it("never joins the two tables in one statement (planner nested-loop regression)", async () => {
    const statements: string[] = [];
    queryRaw.mockImplementation(async (strings: TemplateStringsArray) => {
      statements.push(sqlText(strings));
      return [];
    });
    await loadGalaxusDelistZeroEligibleKeys();
    expect(statements).toHaveLength(2);
    for (const sql of statements) {
      expect(sql).not.toMatch(/JOIN/i);
    }
  });
});
