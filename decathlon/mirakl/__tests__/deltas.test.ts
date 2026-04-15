import { describe, expect, it } from "vitest";
import { computeDecathlonDeltasFromCandidates, resolveEffectivePrice, resolveEffectiveStock } from "../deltas";

/** Aligns with `buildProviderKey(gtin, supplierVariantId)` → NER_1234567890123 for ner_* suppliers */
const makeCandidate = (overrides?: Partial<any>) => ({
  providerKey: "NER_1234567890123",
  gtin: "1234567890123",
  mapping: {},
  kickdbVariant: null,
  product: null,
  variant: {
    supplierVariantId: "ner_1",
    manualLock: true,
    manualPrice: "120",
    manualStock: 5,
    stock: 3,
    price: 100,
  },
  ...overrides,
});

describe("mirakl deltas", () => {
  it("resolves manual stock and price overrides", () => {
    const candidate = makeCandidate();
    expect(resolveEffectiveStock(candidate)).toBe(5);
    expect(resolveEffectivePrice(candidate)).toBe("145.00");
  });

  it("does not emit updates when values are unchanged", () => {
    const candidate = makeCandidate();
    const syncByKey = new Map([
      [
        "NER_1234567890123",
        {
          providerKey: "NER_1234567890123",
          lastStock: 5,
          lastPrice: "145.00",
          offerCreatedAt: new Date(),
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.newOffers.length).toBe(0);
    expect(result.stockUpdates.length).toBe(0);
    expect(result.priceUpdates.length).toBe(0);
  });

  it("emits stock updates when stock changes", () => {
    const candidate = makeCandidate();
    const syncByKey = new Map([
      [
        "NER_1234567890123",
        {
          providerKey: "NER_1234567890123",
          lastStock: 2,
          lastPrice: "145.00",
          offerCreatedAt: new Date(),
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.stockUpdates.length).toBe(1);
    expect(result.stockUpdates[0].offerSku).toBe("NER_1234567890123");
  });

  it("applies Decathlon margin list rule for non-partner THE_* (no partner-key multiplier)", () => {
    const candidate = makeCandidate({
      providerKey: "THE_1234567890123",
      variant: {
        supplierVariantId: "the_warehouse-1",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 10,
        price: 99.5,
      },
    });
    expect(resolveEffectivePrice(candidate, new Set())).toBe("156.60");
  });

  it("applies ×1.35 on list TTC when supplier key is in partner set", () => {
    const candidate = makeCandidate({
      providerKey: "THE_1234567890123",
      variant: {
        supplierVariantId: "the_warehouse-1",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 10,
        price: 99.5,
      },
    });
    expect(resolveEffectivePrice(candidate, new Set(["the"]))).toBe("211.41");
  });

  it("emits new offers when offerCreatedAt is missing", () => {
    const candidate = makeCandidate();
    const syncByKey = new Map([
      [
        "NER_1234567890123",
        {
          providerKey: "NER_1234567890123",
          lastStock: 5,
          lastPrice: "145.00",
          offerCreatedAt: null,
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.newOffers.length).toBe(1);
    expect(result.newOffers[0].offerSku).toBe("NER_1234567890123");
  });
});
