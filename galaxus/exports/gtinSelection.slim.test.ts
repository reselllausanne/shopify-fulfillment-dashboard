import { describe, expect, it } from "vitest";
import { accumulateSlimGtinWinners, type SlimGtinWinner } from "@/galaxus/exports/gtinSelection";

function mappingFixture(params: {
  id: string;
  gtin: string;
  price: number;
  stock?: number;
  supplierVariantId?: string;
  hasImage?: boolean;
  updatedAt?: string;
}) {
  const supplierVariantId = params.supplierVariantId ?? `ner:${params.id}`;
  return {
    id: params.id,
    gtin: params.gtin,
    updatedAt: params.updatedAt ?? "2026-01-01T00:00:00.000Z",
    supplierVariant: {
      supplierVariantId,
      providerKey: null,
      gtin: params.gtin,
      price: params.price,
      stock: params.stock ?? 1,
      sizeRaw: null,
      supplierBrand: "Nike",
      supplierProductName: "Test Shoe",
      images: params.hasImage === false ? [] : ["https://cdn.example/a.jpg"],
      hostedImageUrl: params.hasImage === false ? null : "https://cdn.example/a.jpg",
      sourceImageUrl: null,
      imageSyncStatus: params.hasImage === false ? null : "SYNCED",
      manualNote: null,
      deliveryType: null,
      updatedAt: params.updatedAt ?? "2026-01-01T00:00:00.000Z",
    },
    kickdbVariant: { product: { name: "Test Shoe", brand: "Nike" } },
  };
}

describe("accumulateSlimGtinWinners", () => {
  it("keeps cheaper winner per GTIN and only slim fields", () => {
    const best = new Map<string, SlimGtinWinner>();
    accumulateSlimGtinWinners(
      [
        mappingFixture({ id: "a", gtin: "4006381333931", price: 100, stock: 5 }),
        mappingFixture({ id: "b", gtin: "4006381333931", price: 80, stock: 1 }),
      ],
      best,
      { requireImage: true, requireProductName: false, galaxusPartnerKeysLower: new Set(["ner"]) }
    );
    expect(best.size).toBe(1);
    const winner = best.get("4006381333931");
    expect(winner?.mappingId).toBe("b");
    expect(winner?.sellPriceExVat).toBeLessThan(
      best.get("4006381333931") ? 999 : 0
    );
    expect(Object.keys(winner ?? {})).toEqual(
      expect.arrayContaining([
        "mappingId",
        "providerKey",
        "gtin",
        "sellPriceExVat",
        "stock",
        "updatedAtMs",
      ])
    );
    expect(winner && "mapping" in (winner as object)).toBe(false);
  });

  it("master requireImage drops imageless; specs keeps them", () => {
    const master = new Map<string, SlimGtinWinner>();
    const specs = new Map<string, SlimGtinWinner>();
    const rows = [
      mappingFixture({ id: "img", gtin: "4006381333931", price: 90, hasImage: true }),
      mappingFixture({
        id: "noimg",
        gtin: "4006381333931",
        price: 70,
        hasImage: false,
        supplierVariantId: "ner:noimg",
      }),
    ];
    accumulateSlimGtinWinners(rows, master, {
      requireImage: true,
      requireProductName: false,
      galaxusPartnerKeysLower: new Set(["ner"]),
    });
    accumulateSlimGtinWinners(rows, specs, {
      requireImage: false,
      requireProductName: false,
      galaxusPartnerKeysLower: new Set(["ner"]),
    });
    expect(master.get("4006381333931")?.mappingId).toBe("img");
    expect(specs.get("4006381333931")?.mappingId).toBe("noimg");
  });
});
