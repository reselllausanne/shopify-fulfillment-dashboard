import { describe, expect, it } from "vitest";
import { computeDecathlonDeltasFromCandidates, resolveEffectivePrice, resolveEffectiveStock } from "../deltas";
import { computeDecathlonOfferListPriceFromBuyNowForSupplier } from "@/decathlon/exports/pricing";

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
    expect(resolveEffectivePrice(candidate)).toBe("120.00");
  });

  it("does not emit updates when values are unchanged", () => {
    const candidate = makeCandidate();
    const syncByKey = new Map([
      [
        "NER_1234567890123",
        {
          providerKey: "NER_1234567890123",
          lastStock: 5,
          lastPrice: "120.00",
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
          lastPrice: "120.00",
          offerCreatedAt: new Date(),
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.stockUpdates.length).toBe(1);
    expect(result.stockUpdates[0].offerSku).toBe("NER_1234567890123");
  });

  it("uses partner /0.75 rule for NER rows", () => {
    const candidate = makeCandidate({
      providerKey: "NER_1234567890123",
      variant: {
        supplierVariantId: "ner_1",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 10,
        price: 100,
      },
    });
    expect(resolveEffectivePrice(candidate, new Set())).toBe("133.33");
  });

  it("uses loss-fraction rule for THE rows", () => {
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
    expect(resolveEffectivePrice(candidate, new Set())).toBe("112.01");
  });

  it("keeps THE loss-fraction rule when partner set includes THE", () => {
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
    expect(resolveEffectivePrice(candidate, new Set(["the"]))).toBe("112.01");
  });

  it("STX high buy excluded when website list exceeds 400 cap", () => {
    const candidate = makeCandidate({
      providerKey: "STX_1234567890123",
      variant: {
        supplierVariantId: "stx_1",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 10,
        price: 300,
        deliveryType: "express_standard",
      },
    });
    expect(resolveEffectivePrice(candidate, new Set())).toBeNull();
  });

  it("uses website margin list for STX normal buy", () => {
    const candidate = makeCandidate({
      providerKey: "STX_1234567890123",
      variant: {
        supplierVariantId: "stx_1",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 10,
        price: 106.47,
        deliveryType: "express_standard",
      },
    });
    const price = resolveEffectivePrice(candidate, new Set());
    expect(price).toBe(
      computeDecathlonOfferListPriceFromBuyNowForSupplier(106.47, "stx", undefined, {
        deliveryType: "express_standard",
      })?.toFixed(2) ?? null
    );
    expect(Number(price)).toBe(149);
    expect(Number(price)).toBeLessThanOrEqual(400);
    expect(resolveEffectiveStock(candidate, Number(price))).toBe(1);
  });

  it("zeros stock on Mirakl when STX list exceeds 400", () => {
    const candidate = makeCandidate({
      providerKey: "STX_1234567890123",
      variant: {
        supplierVariantId: "stx_1",
        manualLock: true,
        manualPrice: "410",
        manualStock: 1,
        stock: 10,
        price: 100,
        deliveryType: "express_standard",
      },
    });
    const syncByKey = new Map([
      [
        "STX_1234567890123",
        {
          providerKey: "STX_1234567890123",
          lastStock: 1,
          lastPrice: "410.00",
          offerCreatedAt: new Date(),
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.stockUpdates.length).toBe(1);
    expect(result.stockUpdates[0].stock).toBe(0);
  });

  it("emits new offers when offerCreatedAt is missing", () => {
    const candidate = makeCandidate();
    const syncByKey = new Map([
      [
        "NER_1234567890123",
        {
          providerKey: "NER_1234567890123",
          lastStock: 5,
          lastPrice: "160.00",
          offerCreatedAt: null,
        },
      ],
    ]);
    const result = computeDecathlonDeltasFromCandidates([candidate], syncByKey);
    expect(result.newOffers.length).toBe(1);
    expect(result.newOffers[0].offerSku).toBe("NER_1234567890123");
  });

  it("emits stock=0 when offerCreatedAt missing and includeZeroStockWithoutOffer", () => {
    const candidate = makeCandidate({
      providerKey: "THE_1234567890123",
      variant: {
        supplierVariantId: "the:IM4002-100-40",
        manualLock: false,
        manualPrice: null,
        manualStock: null,
        stock: 0,
        price: 94.5,
      },
    });
    const result = computeDecathlonDeltasFromCandidates([candidate], new Map(), {
      includeZeroStockWithoutOffer: true,
    });
    expect(result.newOffers.length).toBe(0);
    expect(result.stockUpdates.length).toBe(1);
    expect(result.stockUpdates[0].stock).toBe(0);
    expect(result.stockUpdates[0].offerSku).toBe("THE_1234567890123");
  });
});
