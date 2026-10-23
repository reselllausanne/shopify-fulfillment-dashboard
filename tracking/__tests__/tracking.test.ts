import { describe, expect, it } from "vitest";
import {
  OUTBOUND_LOCKED,
  OutboundLockedError,
  assertDestinationOpen,
  destinationGate,
  isProductionId,
  type Destination,
  type Env,
} from "../guards";
import { eventIdFor, feedItemId, orderGid, type ShadowPurchase } from "../contract";
import { hashedEmail, normalizeEmail, normalizePhoneE164, sha256Hex } from "../hash";
import { computeOrderProfit, profitAssumptionsFromEnv, secondaryProfitConversionValue } from "../profit";
import { buildGa4TestPurchase, sendGa4Test } from "../adapters/ga4Test";
import {
  adsDateTime,
  buildSecondaryClickConversion,
  sendGoogleAdsSecondary,
  validateSecondaryAction,
} from "../adapters/googleAdsSecondary";
import { buildMetaPurchase, sendMeta } from "../adapters/meta";
import { buildTikTokPurchase, sendTikTok } from "../adapters/tiktok";

const FULL_ENV = (dest: Destination): Env => ({
  [`TRACKING_${dest.toUpperCase()}_ENABLED`]: "1",
  [`TRACKING_${dest.toUpperCase()}_APPROVED_AT`]: "2026-11-01",
  TRACKING_GA4_TEST_MEASUREMENT_ID: "G-TEST123456",
  TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID: "9999999999",
  TRACKING_META_PIXEL_ID: "123456789012345",
  TRACKING_TIKTOK_PIXEL_ID: "CABCDEF123",
});

function purchase(over: Partial<ShadowPurchase> = {}): ShadowPurchase {
  return {
    orderId: "13697584726402",
    orderName: "#7500",
    occurredAt: new Date("2026-10-14T10:00:00Z"),
    currency: "CHF",
    revenue: 265,
    tax: 19.86,
    shipping: 0,
    items: [
      {
        itemId: "shopify_CH_1_2",
        productId: "1",
        variantId: "2",
        name: "Jordan 4",
        brand: "Jordan",
        variant: "EU 42",
        lane: "standard",
        price: 265,
        quantity: 1,
      },
    ],
    clientId: "cid-1",
    sessionId: "sid-1",
    clickIds: { gclid: "Cj0KCQjw-abc", fbclid: "IwAR0abc", ttclid: "E.C.P.abc" },
    consent: { analytics: true, marketing: true, saleOfData: true },
    email: " Test@Example.com ",
    phone: "079 123 45 67",
    country: "CH",
    ip: "203.0.113.1",
    userAgent: "UA",
    pageUrl: "https://resell-lausanne.ch/checkouts/x/thank-you",
    ...over,
  };
}

describe("guards", () => {
  it("keeps non-G4 destinations code-locked; G4 secondary unlocked but env-gated", () => {
    expect(OUTBOUND_LOCKED.ga4_test).toBe(true);
    expect(OUTBOUND_LOCKED.google_ads_secondary).toBe(false);
    expect(OUTBOUND_LOCKED.meta).toBe(true);
    expect(OUTBOUND_LOCKED.tiktok).toBe(true);

    for (const dest of ["ga4_test", "meta", "tiktok"] as Destination[]) {
      const gate = destinationGate(dest, FULL_ENV(dest));
      expect(gate.open).toBe(false);
      expect(gate.reasons).toContain("phase-1 code lock");
      expect(() => assertDestinationOpen(dest, FULL_ENV(dest))).toThrow(OutboundLockedError);
    }

    const adsGateClosed = destinationGate("google_ads_secondary", {});
    expect(adsGateClosed.open).toBe(false);
    expect(adsGateClosed.reasons.join("|")).toMatch(/ENABLED!=1/);

    const adsGateOpen = destinationGate("google_ads_secondary", FULL_ENV("google_ads_secondary"));
    expect(adsGateOpen.open).toBe(true);
    expect(() => assertDestinationOpen("google_ads_secondary", FULL_ENV("google_ads_secondary"))).not.toThrow();
  });

  it("flags missing env + production ids", () => {
    const gate = destinationGate("ga4_test", { TRACKING_GA4_TEST_MEASUREMENT_ID: "G-828PXC8REN" });
    expect(gate.reasons.join("|")).toMatch(/ENABLED!=1/);
    expect(gate.reasons.join("|")).toMatch(/APPROVED_AT missing/);
    expect(gate.reasons.join("|")).toMatch(/production id/);
  });

  it("recognizes production ids", () => {
    expect(isProductionId("G-828PXC8REN")).toBe(true);
    expect(isProductionId("AW-11152326139")).toBe(true);
    expect(isProductionId("AW-11152326139/jO0PCITe3NUYEPv768Up")).toBe(true);
    expect(isProductionId("6622228228")).toBe(true);
    expect(isProductionId("G-TEST123456")).toBe(false);
    expect(isProductionId("")).toBe(false);
  });

  it("send functions refuse while locked / gated", async () => {
    await expect(sendGa4Test()).rejects.toBeInstanceOf(OutboundLockedError);
    await expect(
      sendGoogleAdsSecondary({
        purchase: purchase(),
        customerId: "123",
        conversionActionId: "9999999999",
      }),
    ).rejects.toBeInstanceOf(OutboundLockedError);
    await expect(sendMeta()).rejects.toBeInstanceOf(OutboundLockedError);
    await expect(sendTikTok()).rejects.toBeInstanceOf(OutboundLockedError);
  });
});

describe("contract", () => {
  it("builds feed item ids and event ids", () => {
    expect(feedItemId("gid://shopify/Product/1", "gid://shopify/ProductVariant/2")).toBe("shopify_CH_1_2");
    expect(feedItemId("x", 2)).toBeNull();
    expect(eventIdFor("purchase", "gid://shopify/Order/42")).toBe("purchase_42");
    expect(orderGid(42)).toBe("gid://shopify/Order/42");
    expect(() => eventIdFor("purchase", "nope")).toThrow();
  });
});

describe("hash", () => {
  it("normalizes email and phone", () => {
    expect(normalizeEmail(" Test@Example.com ")).toBe("test@example.com");
    expect(normalizeEmail("nope")).toBeNull();
    expect(normalizePhoneE164("079 123 45 67", "CH")).toBe("+41791234567");
    expect(normalizePhoneE164("0041 79 123 45 67")).toBe("+41791234567");
    expect(normalizePhoneE164("06 12 34 56 78", "FR")).toBe("+33612345678");
    expect(normalizePhoneE164("12", "CH")).toBeNull();
    expect(hashedEmail("Test@Example.com")).toBe(sha256Hex("test@example.com"));
    expect(sha256Hex("test@example.com")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("profit (internal only)", () => {
  it("computes CM1/CM2 and flags unknown cost", () => {
    const p = computeOrderProfit([{ revenueGross: 216.2, supplierCost: 120 }]);
    expect(p.revenueNet).toBe(200);
    expect(p.cm1).toBe(80);
    expect(p.costComplete).toBe(true);
    expect(p.cm2).toBeCloseTo(80 - (216.2 * 0.029 + 0.3) - 9 - 4, 2);
    expect(secondaryProfitConversionValue(p)).toBe(p.cm2);

    const unknown = computeOrderProfit([{ revenueGross: 19, supplierCost: 0 }]);
    expect(unknown.costComplete).toBe(false);
    expect(secondaryProfitConversionValue(unknown)).toBeNull();

    const loss = computeOrderProfit([{ revenueGross: 100, supplierCost: 150 }]);
    expect(loss.cm2).toBeLessThan(0);
    expect(secondaryProfitConversionValue(loss)).toBe(0);
  });

  it("reads assumptions from env with safe fallback", () => {
    const a = profitAssumptionsFromEnv({ TRACKING_CM2_SHIPPING_COST: "12", TRACKING_CM2_VAT_RATE: "bad" });
    expect(a.shippingCostPerOrder).toBe(12);
    expect(a.vatRate).toBe(0.081);
  });
});

describe("disabled adapters — payload contract", () => {
  it("GA4 test: refuses prod stream, needs analytics consent + client id", () => {
    expect(() => buildGa4TestPurchase(purchase(), "G-828PXC8REN")).toThrow();
    expect(buildGa4TestPurchase(purchase({ consent: { analytics: false, marketing: true, saleOfData: true } }), "G-T")).toBeNull();
    const body = buildGa4TestPurchase(purchase(), "G-TEST123456")!;
    expect(body.client_id).toBe("cid-1");
    expect(body.events[0].params.transaction_id).toBe("13697584726402");
    expect((body.events[0].params.items as any[])[0].item_id).toBe("shopify_CH_1_2");
  });

  it("Google Ads secondary: consent + click id required, prod action refused", () => {
    expect(() => buildSecondaryClickConversion(purchase(), "123", "6622228228", 10)).toThrow();
    expect(
      buildSecondaryClickConversion(purchase({ consent: { analytics: true, marketing: false, saleOfData: true } }), "123", "999", 10),
    ).toBeNull();
    expect(buildSecondaryClickConversion(purchase({ clickIds: {} }), "123", "999", 10)).toBeNull();
    const body = buildSecondaryClickConversion(purchase(), "123", "999", -5)!;
    expect(body.gclid).toBe("Cj0KCQjw-abc");
    expect(body.conversionValue).toBe(0);
    expect(body.orderId).toBe("13697584726402");
    expect(body.conversionDateTime).toBe("2026-10-14 12:00:00+02:00");
  });

  it("validates that an action is secondary before use", () => {
    const ok = { id: "999", name: "TEST purchase_profit", status: "ENABLED", type: "UPLOAD_CLICKS", primaryForGoal: false };
    expect(validateSecondaryAction(ok)).toEqual([]);
    expect(validateSecondaryAction({ ...ok, primaryForGoal: true }).join()).toMatch(/Primary/);
    expect(validateSecondaryAction({ ...ok, id: "6622228228" }).join()).toMatch(/production/);
  });

  it("uploads Secondary click conversion when gate open (mocked transport)", async () => {
    const ok = {
      id: "9999999999",
      name: "TEST purchase (shadow)",
      status: "ENABLED",
      type: "UPLOAD_CLICKS",
      primaryForGoal: false,
      includeInConversionsMetric: false,
    };
    let uploaded: unknown[] = [];
    const result = await sendGoogleAdsSecondary({
      purchase: purchase(),
      customerId: "1234567890",
      conversionActionId: "9999999999",
      actionCheck: ok,
      env: FULL_ENV("google_ads_secondary"),
      uploadFn: async (_cfg, conversions) => {
        uploaded = conversions;
        return { results: [{}], partialFailureError: null };
      },
    });
    expect(result.status).toBe("uploaded");
    expect(result.body?.orderId).toBe("13697584726402");
    expect(uploaded).toHaveLength(1);
  });

  it("rejects Primary action even when gate open", async () => {
    await expect(
      sendGoogleAdsSecondary({
        purchase: purchase(),
        customerId: "123",
        conversionActionId: "9999999999",
        actionCheck: {
          id: "9999999999",
          name: "bad",
          status: "ENABLED",
          type: "UPLOAD_CLICKS",
          primaryForGoal: true,
        },
        env: FULL_ENV("google_ads_secondary"),
        uploadFn: async () => ({ results: [], partialFailureError: null }),
      }),
    ).rejects.toThrow(/Primary/);
  });

  it("Meta / TikTok: consent gate, hashed PII, shared event_id", () => {
    expect(buildMetaPurchase(purchase({ consent: { analytics: true, marketing: false, saleOfData: true } }))).toBeNull();
    expect(buildTikTokPurchase(purchase({ consent: { analytics: true, marketing: null, saleOfData: null } }))).toBeNull();
    const m = buildMetaPurchase(purchase())!;
    const t = buildTikTokPurchase(purchase())!;
    expect(m.event_id).toBe("purchase_13697584726402");
    expect(t.event_id).toBe(m.event_id);
    expect((m.user_data.em as string[])[0]).toBe(sha256Hex("test@example.com"));
    expect((m.user_data.ph as string[])[0]).toBe(sha256Hex("41791234567"));
    expect(t.user.phone).toBe(sha256Hex("+41791234567"));
    expect(String(m.user_data.fbc)).toMatch(/^fb\.1\.\d+\.IwAR0abc$/);
    expect(JSON.stringify(m)).not.toContain("example.com");
  });

  it("formats Ads date time in Zurich winter time", () => {
    expect(adsDateTime(new Date("2026-01-10T08:00:00Z"))).toBe("2026-01-10 09:00:00+01:00");
  });
});
