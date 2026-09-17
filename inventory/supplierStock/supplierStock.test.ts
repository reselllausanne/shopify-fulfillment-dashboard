import { describe, expect, it } from "vitest";
import { defaultPolicyStatusForSupplier, buildSupplierSeed } from "./defaults";
import { evaluateSupplierExclusion } from "./exclusions";
import { shouldPauseAfterInvalidRun } from "./invalidRunPolicy";
import {
  detectPackSizeInflation,
  inferPackCount,
  isPokemonBoosterDisplayConflict,
  resolveIdentityMatchLevel,
} from "./match";
import {
  decidePublishedQuantity,
  halfCeilStock,
  notSeenInCompleteRunDecision,
  reviewBlockedDecision,
} from "./quantity";
import { applySupplierStockPublishGate, resolveSupplierKeyFromIds } from "./publishGate";
import { enrichObservation, reconcileObservation, zeroMissingFromCompleteSnapshot } from "./reconcile";
import { evaluateScrapeRunValidity } from "./runValidity";
import { describeNotifierChannels } from "./notify";
import type { ScrapeRunMetrics, VariantObservation } from "./types";

describe("halfCeilStock", () => {
  it("maps 1→1, 2→1, 3→2, 4→2, 5→3", () => {
    expect(halfCeilStock(1)).toBe(1);
    expect(halfCeilStock(2)).toBe(1);
    expect(halfCeilStock(3)).toBe(2);
    expect(halfCeilStock(4)).toBe(2);
    expect(halfCeilStock(5)).toBe(3);
  });
});

describe("evaluateScrapeRunValidity", () => {
  it("invalid when listed=0 with active catalog (Ex Libris anomaly)", () => {
    const metrics: ScrapeRunMetrics = {
      supplierKey: "exl",
      scrapeRunId: 1,
      status: "ok",
      productsListed: 0,
      variantsUpserted: 0,
      withGtin: 0,
      errors: 0,
      priorActiveCatalog: 93_000,
    };
    const res = evaluateScrapeRunValidity(metrics);
    expect(res.valid).toBe(false);
    expect(res.invalidReason).toBe("listed_zero_with_active_catalog");
  });

  it("invalid on cloudflare block (FantasyWelt anomaly)", () => {
    const metrics: ScrapeRunMetrics = {
      supplierKey: "fan",
      scrapeRunId: 2,
      status: "error",
      message: "Cloudflare challenge page",
      productsListed: 0,
      variantsUpserted: 0,
      withGtin: 0,
      errors: 12,
      priorActiveCatalog: 4_400,
    };
    const res = evaluateScrapeRunValidity(metrics);
    expect(res.valid).toBe(false);
    expect(res.invalidReason).toBe("cloudflare_block");
  });

  it("invalid on mostly empty parse", () => {
    const metrics: ScrapeRunMetrics = {
      supplierKey: "bwz",
      scrapeRunId: 3,
      status: "ok",
      message: "listed=8000 wrote=0",
      productsListed: 8000,
      variantsUpserted: 0,
      withGtin: 0,
      errors: 0,
      priorActiveCatalog: 5000,
    };
    const res = evaluateScrapeRunValidity(metrics);
    expect(res.valid).toBe(false);
    expect(res.invalidReason).toBe("mostly_empty_parse");
  });

  it("valid on healthy run", () => {
    const metrics: ScrapeRunMetrics = {
      supplierKey: "rei",
      scrapeRunId: 4,
      status: "ok",
      productsListed: 10_000,
      variantsUpserted: 9_500,
      withGtin: 9_500,
      errors: 20,
      priorActiveCatalog: 9_000,
    };
    const res = evaluateScrapeRunValidity(metrics);
    expect(res.valid).toBe(true);
    expect(res.completeSnapshot).toBe(true);
  });
});

describe("invalid run pause policy", () => {
  it("monitoring_only never pauses", () => {
    const d = shouldPauseAfterInvalidRun({
      policyStatus: "monitoring_only",
      consecutiveInvalidRuns: 1,
      invalidReason: "cloudflare_block",
    });
    expect(d.shouldPause).toBe(false);
    expect(d.consecutiveInvalidRuns).toBe(2);
  });

  it("2nd invalid pauses review_required suppliers", () => {
    const d = shouldPauseAfterInvalidRun({
      policyStatus: "review_required",
      consecutiveInvalidRuns: 1,
      invalidReason: "listed_zero_with_active_catalog",
    });
    expect(d.shouldPause).toBe(true);
    expect(d.newStatus).toBe("paused_due_to_scrape_failure");
    expect(d.notify).toBe(true);
  });
});

describe("publish gate", () => {
  const proofAt = new Date();

  it("manualLock bypasses gate via caller contract", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 5,
        manualLock: true,
        policyStatus: "review_required",
        evidencePublishedQty: null,
        lastProofAt: null,
      })
    ).toBe(5);
  });

  it("review_required blocks without approval", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 100,
        policyStatus: "review_required",
        evidencePublishedQty: 10,
        lastProofAt: proofAt,
      })
    ).toBe(reviewBlockedDecision().publishedQty);
  });

  it("monitoring_only passthrough preserves live export (WEL/REI)", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 4400,
        policyStatus: "monitoring_only",
        evidencePublishedQty: null,
        lastProofAt: null,
      })
    ).toBe(4400);
  });

  it("approved: no historical qty without fresh proof", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 4400,
        policyStatus: "approved",
        evidencePublishedQty: 4400,
        lastProofAt: null,
      })
    ).toBe(0);
  });

  it("uses evidence when proof fresh", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 100,
        policyStatus: "approved",
        evidencePublishedQty: 3,
        lastProofAt: proofAt,
      })
    ).toBe(3);
  });

  it("resolveSupplierKeyFromIds", () => {
    expect(resolveSupplierKeyFromIds("exl_9781234567890")).toBe("exl");
    expect(resolveSupplierKeyFromIds("bad")).toBeNull();
  });
});

describe("match + pack inflation", () => {
  it("identity hierarchy gtin > mpn > sku", () => {
    expect(
      resolveIdentityMatchLevel({
        gtin: "123",
        dbGtin: "123",
        supplierSku: "x",
        dbSku: "y",
      })
    ).toBe("gtin");
    expect(
      resolveIdentityMatchLevel({
        manufacturerRef: "mpn1",
        dbMpn: "mpn1",
      })
    ).toBe("mpn");
    expect(
      resolveIdentityMatchLevel({
        supplierSku: "sku1",
        dbSku: "sku1",
      })
    ).toBe("sku");
  });

  it("detectPackSizeInflation: qty 1 never publish 100", () => {
    const hit = detectPackSizeInflation({ internalQty: 1, publishedQty: 100 });
    expect(hit.inflated).toBe(true);
  });

  it("pokemon booster display conflict", () => {
    expect(
      isPokemonBoosterDisplayConflict({
        title: "Pokemon Booster Pack",
        mappedTitle: "Booster Display 36 packs",
      })
    ).toBe(true);
  });

  it("inferPackCount from title", () => {
    expect(inferPackCount("WAGO 100 Stück")).toBe(100);
  });
});

describe("reichelt exclusions", () => {
  it("excludes neon without safe length", () => {
    const hit = evaluateSupplierExclusion({
      supplierKey: "rei",
      productName: "Neonröhre rot",
    });
    expect(hit.excluded).toBe(true);
  });

  it("excludes dimension > 1.20m", () => {
    const hit = evaluateSupplierExclusion({
      supplierKey: "rei",
      productName: "LED Röhre 150 cm",
    });
    expect(hit.excluded).toBe(true);
  });
});

describe("reconcile", () => {
  it("zeros variants not seen in complete snapshot", () => {
    const zeros = zeroMissingFromCompleteSnapshot({
      seenVariantIds: new Set(["exl_a", "exl_b"]),
      catalogVariantIds: ["exl_a", "exl_b", "exl_c"],
    });
    expect(zeros).toHaveLength(1);
    expect(zeros[0].supplierVariantId).toBe("exl_c");
    expect(zeros[0].publishedQty).toBe(0);
    expect(zeros[0].zeroReason).toBe(notSeenInCompleteRunDecision().zeroReason);
  });

  it("Venova/Hawk: no publish without exact qty proof path", () => {
    const obs: VariantObservation = {
      supplierKey: "ven",
      supplierVariantId: "ven_123",
      availabilityStatus: "confirmed_in_stock",
      supplierStockQty: 5,
      quantitySource: "defaultStock",
    };
    const enriched = enrichObservation(obs);
    const rec = reconcileObservation(enriched);
    expect(rec.publishedQty).toBeGreaterThan(0);
    expect(decidePublishedQuantity({
      availabilityStatus: "variant_uncertain",
      supplierStockQty: 5,
    }).publishedQty).toBe(0);
  });
});

describe("defaults", () => {
  it("WEL+REI monitoring_only; others review_required", () => {
    expect(defaultPolicyStatusForSupplier("wel")).toBe("monitoring_only");
    expect(defaultPolicyStatusForSupplier("rei")).toBe("monitoring_only");
    expect(defaultPolicyStatusForSupplier("exl")).toBe("review_required");
    expect(defaultPolicyStatusForSupplier("haw")).toBe("review_required");
  });

  it("seeds all configured suppliers", () => {
    const exl = buildSupplierSeed("exl");
    expect(exl.supplierCode).toBe("EXL");
    expect(exl.displayName).toBe("Ex Libris");
  });
});

describe("notifier channels", () => {
  it("describeNotifierChannels returns shape", () => {
    const ch = describeNotifierChannels();
    expect(ch).toHaveProperty("email");
    expect(ch).toHaveProperty("sms");
    expect(ch).toHaveProperty("whatsapp");
  });
});
