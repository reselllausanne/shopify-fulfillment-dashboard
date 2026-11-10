import { describe, expect, it, vi } from "vitest";

const queryRaw = vi.fn();
vi.mock("@/app/lib/prisma", () => ({
  prisma: { $queryRaw: (...args: unknown[]) => queryRaw(...args) },
}));

import {
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
