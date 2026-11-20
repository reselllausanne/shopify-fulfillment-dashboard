import { beforeEach, describe, expect, it, vi } from "vitest";

const G = "194513902217";
const STX = `STX_${G}`;
const NER = `NER_${G}`;

type Row = Record<string, string>;
/** What the export routes return per requested key set (simulates the GTIN election). */
let exportImpl: (keys: string[]) => { stock: Row[]; offer: Row[] };
const exportCalls: string[][] = [];
const stockUpserts: string[] = [];
const offerUpserts: string[] = [];
const stockDeletes: string[] = [];
const offerDeletes: string[] = [];
let siblings: Array<{ gtin: string; providerKey: string }> = [];

function csv(rows: Row[], headers: string[]): string {
  return [headers.join(","), ...rows.map((r) => headers.map((h) => r[h] ?? "").join(","))].join("\n");
}

vi.mock("@/galaxus/ops/internalExportGet", () => ({
  runGalaxusExportGET: async (url: string) => {
    const parsed = new URL(url);
    const keys = (parsed.searchParams.get("providerKeys") ?? "").split(",").filter(Boolean);
    if (parsed.pathname.endsWith("/stock")) exportCalls.push(keys);
    const out = exportImpl(keys);
    const body = parsed.pathname.endsWith("/stock")
      ? csv(out.stock, ["ProviderKey", "QuantityOnStock"])
      : csv(out.offer, ["ProviderKey", "PurchasePriceExclVat_CHF"]);
    return new Response(body, { status: 200 });
  },
}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    galaxusFeedSnapshotMeta: {
      findUnique: async () => ({ stockRowCount: 10, offerRowCount: 10 }),
    },
    variantMapping: {
      findMany: async ({ where }: any) =>
        siblings.filter((s) => (where.gtin.in as string[]).includes(s.gtin)),
    },
    galaxusFeedStockSnapshot: {
      upsert: async ({ where }: any) => stockUpserts.push(where.providerKey),
      deleteMany: async ({ where }: any) => stockDeletes.push(...where.providerKey.in),
    },
    galaxusFeedOfferSnapshot: {
      upsert: async ({ where }: any) => offerUpserts.push(where.providerKey),
      deleteMany: async ({ where }: any) => offerDeletes.push(...where.providerKey.in),
    },
  },
  prismaDirect: null,
}));

import { patchFeedSnapshotsForProviderKeys } from "@/galaxus/exports/feedSnapshot";

describe("patchFeedSnapshotsForProviderKeys GTIN election", () => {
  beforeEach(() => {
    exportCalls.length = 0;
    stockUpserts.length = 0;
    offerUpserts.length = 0;
    stockDeletes.length = 0;
    offerDeletes.length = 0;
    siblings = [
      { gtin: G, providerKey: STX },
      { gtin: G, providerKey: NER },
    ];
  });

  it("STX refresh no longer re-publishes STX next to cheaper NER", async () => {
    exportImpl = (keys) =>
      keys.includes(NER)
        ? {
            stock: [
              { ProviderKey: NER, QuantityOnStock: "3" },
              { ProviderKey: STX, QuantityOnStock: "0" },
            ],
            offer: [{ ProviderKey: NER, PurchasePriceExclVat_CHF: "50.00" }],
          }
        : {
            stock: [{ ProviderKey: STX, QuantityOnStock: "2" }],
            offer: [{ ProviderKey: STX, PurchasePriceExclVat_CHF: "95.28" }],
          };

    await patchFeedSnapshotsForProviderKeys({ origin: "http://x", providerKeys: [STX] });

    expect(exportCalls).toEqual([[STX, NER]]);
    expect(offerUpserts).toEqual([NER]);
    expect(offerDeletes).toEqual([STX]);
    expect(stockUpserts.sort()).toEqual([NER, STX].sort());
    expect(stockDeletes).toEqual([]);
  });

  it("reconcile (deleteStale=false) still drops the election loser", async () => {
    exportImpl = () => ({
      stock: [{ ProviderKey: NER, QuantityOnStock: "3" }],
      offer: [{ ProviderKey: NER, PurchasePriceExclVat_CHF: "50.00" }],
    });

    await patchFeedSnapshotsForProviderKeys({
      origin: "http://x",
      providerKeys: [STX],
      deleteStale: false,
    });

    expect(offerDeletes).toEqual([STX]);
    expect(stockDeletes).toEqual([STX]);
  });

  it("falls back to the solo export when the elected sibling is not live", async () => {
    exportImpl = (keys) =>
      keys.includes(NER)
        ? { stock: [], offer: [] }
        : {
            stock: [{ ProviderKey: STX, QuantityOnStock: "2" }],
            offer: [{ ProviderKey: STX, PurchasePriceExclVat_CHF: "95.28" }],
          };

    await patchFeedSnapshotsForProviderKeys({ origin: "http://x", providerKeys: [STX] });

    expect(exportCalls).toEqual([[STX, NER], [STX]]);
    expect(offerUpserts).toEqual([STX]);
    expect(offerDeletes).toEqual([]);
    expect(stockDeletes).toEqual([]);
  });

  it("keys without siblings export exactly as before", async () => {
    siblings = [];
    exportImpl = () => ({
      stock: [{ ProviderKey: STX, QuantityOnStock: "2" }],
      offer: [{ ProviderKey: STX, PurchasePriceExclVat_CHF: "95.28" }],
    });

    await patchFeedSnapshotsForProviderKeys({ origin: "http://x", providerKeys: [STX] });

    expect(exportCalls).toEqual([[STX]]);
    expect(offerUpserts).toEqual([STX]);
    expect(offerDeletes).toEqual([]);
  });
});
