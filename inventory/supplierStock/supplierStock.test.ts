import { describe, expect, it } from "vitest";
import { defaultPolicyStatusForSupplier } from "./defaults";
import { evaluateSupplierExclusion } from "./exclusions";
import { shouldPauseAfterInvalidRun } from "./invalidRunPolicy";
import {
  detectPackSizeInflation,
  inferPackCount,
  isPokemonBoosterDisplayConflict,
} from "./match";
import {
  decidePublishedQuantity,
  halfCeilStock,
  notSeenInCompleteRunDecision,
  reviewBlockedDecision,
} from "./quantity";
import { applySupplierStockPublishGate } from "./publishGate";
import {
  buildRunContractReport,
  isEligibleForApproval,
  listSupplierContractStatuses,
} from "./contractRegistry";
import {
  getSupplierStockEnforceMode,
  isSupplierStockPublishEnforced,
  mayMutateMarketplaceStock,
  OBSERVATION_ONLY_NOT_ENFORCED,
} from "./enforceMode";
import { enrichObservation, reconcileObservation, zeroMissingFromCompleteSnapshot } from "./reconcile";
import { evaluateScrapeRunValidity } from "./runValidity";
import { describeNotifierChannels, getEmailNotifyPreflight } from "./notify";
import { assertNeverUsesDbStockAsProof, observationFromSourcePayload, validateFreshSourceEvidence } from "./observation";
import type { ScrapeRunMetrics, SupplierVariantObservation, VariantObservation } from "./types";
import {
  FIRST_INVALID_GRACE_MS,
  TEMPORARY_MONITORING_EXCEPTION,
  ZERO_REASON_NO_FRESH_SOURCE,
} from "./types";
import { SCRAPER_STOCK_HOOK_CALL_SITES } from "@/app/lib/scraperRunner";

describe("halfCeilStock", () => {
  it("maps 1→1, 2→1, 3→2, 4→2, 5→3", () => {
    expect(halfCeilStock(1)).toBe(1);
    expect(halfCeilStock(2)).toBe(1);
    expect(halfCeilStock(3)).toBe(2);
    expect(halfCeilStock(4)).toBe(2);
    expect(halfCeilStock(5)).toBe(3);
  });
});

describe("fresh source evidence — never DB stock", () => {
  it("rejects observation without page URL / identity / price / signal", () => {
    const bad: SupplierVariantObservation = {
      supplierKey: "haw",
      supplierVariantId: "haw_1",
      sourceAvailability: "in_stock",
      supplierStockQty: 5,
      scrapeRunId: 1,
      observedAt: new Date(),
    };
    const check = validateFreshSourceEvidence(bad);
    expect(check.ok).toBe(false);
    expect(check.reason).toBe(ZERO_REASON_NO_FRESH_SOURCE);
  });

  it("rejects usedDefaultStock even with signal", () => {
    const obs: SupplierVariantObservation = {
      supplierKey: "ven",
      supplierVariantId: "ven_1",
      productUrl: "https://www.venova.ch/x",
      gtin: "1234567890123",
      sourcePrice: 19.9,
      purchaseSignal: "sofort_verfuegbar",
      sourceAvailability: "in_stock",
      usedDefaultStock: true,
      supplierStockQty: 5,
      scrapeRunId: 1,
      observedAt: new Date(),
    };
    expect(validateFreshSourceEvidence(obs).ok).toBe(false);
  });

  it("accepts exact qty + live page signal", () => {
    const obs: SupplierVariantObservation = {
      supplierKey: "haw",
      supplierVariantId: "haw_2",
      productUrl: "https://www.hawk.ch/a/b.html",
      gtin: "7612345678901",
      sourcePrice: 12,
      purchaseSignal: "stueck_an_lager",
      sourceAvailability: "in_stock",
      supplierStockQty: 5,
      scrapeRunId: 9,
      observedAt: new Date(),
    };
    const check = validateFreshSourceEvidence(obs);
    expect(check.ok).toBe(true);
    const internal = observationFromSourcePayload(obs);
    expect(internal.hasFreshSourceEvidence).toBe(true);
    const decided = decidePublishedQuantity({
      availabilityStatus: "confirmed_in_stock",
      supplierStockQty: 5,
      hasFreshSourceEvidence: true,
    });
    expect(decided.publishedQty).toBe(3);
  });

  it("quantityUnknown confirmed → publish 1 max", () => {
    expect(
      decidePublishedQuantity({
        availabilityStatus: "confirmed_in_stock",
        supplierStockQty: null,
        quantityUnknown: true,
        hasFreshSourceEvidence: true,
      }).publishedQty
    ).toBe(1);
  });

  it("without fresh evidence → 0 NO_FRESH_SOURCE_EVIDENCE", () => {
    const d = decidePublishedQuantity({
      availabilityStatus: "confirmed_in_stock",
      supplierStockQty: 100,
      hasFreshSourceEvidence: false,
    });
    expect(d.publishedQty).toBe(0);
    expect(d.zeroReason).toBe(ZERO_REASON_NO_FRESH_SOURCE);
    expect(d.needsReview).toBe(true);
  });

  it("preorder → 0 + review", () => {
    const d = decidePublishedQuantity({
      availabilityStatus: "preorder",
      supplierStockQty: 10,
      hasFreshSourceEvidence: true,
    });
    expect(d.publishedQty).toBe(0);
    expect(d.needsReview).toBe(true);
  });

  it("quantitySource supplier_variant_stock is forbidden as proof", () => {
    expect(assertNeverUsesDbStockAsProof("supplier_variant_stock")).toBe(false);
    expect(assertNeverUsesDbStockAsProof("numeric_stock")).toBe(true);
  });
});

describe("evaluateScrapeRunValidity", () => {
  const base = {
    supplierKey: "exl",
    scrapeRunId: 1,
    productsListed: 0,
    variantsUpserted: 0,
    withGtin: 0,
    errors: 0,
    priorActiveCatalog: 93_000,
    finishedAt: new Date(),
  };

  it("invalid Ex Libris listed=0/wrote=0", () => {
    const res = evaluateScrapeRunValidity({ ...base, status: "ok", message: "listed=0 wrote=0" });
    expect(res.valid).toBe(false);
    expect(res.invalidReason).toBe("listed_zero_with_active_catalog");
  });

  it("accepts completed as success status", () => {
    const res = evaluateScrapeRunValidity({
      ...base,
      status: "completed",
      productsListed: 1000,
      variantsUpserted: 900,
      priorActiveCatalog: 800,
      snapshotCompleteness: "full",
      previousReliableSnapshotCount: 1000,
    });
    expect(res.valid).toBe(true);
  });

  it("invalid for error / failed / running", () => {
    for (const status of ["error", "failed", "running"] as const) {
      const res = evaluateScrapeRunValidity({ ...base, status, productsListed: 10, variantsUpserted: 10 });
      expect(res.valid).toBe(false);
      expect(res.invalidReason).toContain(status);
    }
  });

  it("never marks completeSnapshot at ~75% coverage (threshold 80%)", () => {
    const res = evaluateScrapeRunValidity({
      supplierKey: "rei",
      scrapeRunId: 4,
      status: "ok",
      finishedAt: new Date(),
      productsListed: 7_500,
      variantsUpserted: 7_000,
      withGtin: 7_000,
      errors: 0,
      priorActiveCatalog: 10_000,
      previousReliableSnapshotCount: 10_000,
      snapshotCompleteness: "full",
    });
    expect(res.valid).toBe(true);
    expect(res.completeSnapshot).toBe(false);
    expect(res.coverageVsPrevious).toBeLessThan(0.8);
  });

  it("5% coverage of large catalog is invalid volume drop — never complete", () => {
    const res = evaluateScrapeRunValidity({
      supplierKey: "rei",
      scrapeRunId: 41,
      status: "ok",
      finishedAt: new Date(),
      productsListed: 500,
      variantsUpserted: 400,
      withGtin: 400,
      errors: 0,
      priorActiveCatalog: 70_000,
      previousReliableSnapshotCount: 70_000,
      snapshotCompleteness: "full",
    });
    expect(res.valid).toBe(false);
    expect(res.completeSnapshot).toBe(false);
  });

  it("completeSnapshot only when declared full + ≥80% coverage", () => {
    const res = evaluateScrapeRunValidity({
      supplierKey: "haw",
      scrapeRunId: 5,
      status: "ok",
      finishedAt: new Date(),
      productsListed: 9000,
      variantsUpserted: 8500,
      withGtin: 8500,
      errors: 10,
      priorActiveCatalog: 9000,
      previousReliableSnapshotCount: 10_000,
      snapshotCompleteness: "full",
    });
    expect(res.valid).toBe(true);
    expect(res.completeSnapshot).toBe(true);
  });

  it("partial max-run never complete", () => {
    const res = evaluateScrapeRunValidity({
      supplierKey: "fan",
      scrapeRunId: 6,
      status: "ok",
      finishedAt: new Date(),
      productsListed: 50,
      variantsUpserted: 50,
      withGtin: 50,
      errors: 0,
      priorActiveCatalog: 50,
      snapshotCompleteness: "full",
      partialRun: true,
      previousReliableSnapshotCount: 50,
    });
    expect(res.completeSnapshot).toBe(false);
  });

  it("cloudflare invalid", () => {
    const res = evaluateScrapeRunValidity({
      ...base,
      status: "error",
      message: "Cloudflare challenge page",
      priorActiveCatalog: 4400,
    });
    expect(res.invalidReason).toBe("cloudflare_block");
  });
});

describe("invalid run pause policy", () => {
  it("monitoring_only TEMPORARY_MONITORING_EXCEPTION — alert on 2nd, never zero", () => {
    const d = shouldPauseAfterInvalidRun({
      policyStatus: "monitoring_only",
      consecutiveInvalidRuns: 1,
      invalidReason: "cloudflare_block",
    });
    expect(d.shouldPause).toBe(false);
    expect(d.zeroMarketplaceStock).toBe(false);
    expect(d.notify).toBe(true);
    expect(d.exceptionTag).toBe(TEMPORARY_MONITORING_EXCEPTION);
  });

  it("approved 1st invalid keeps grace, 2nd zeros + email", () => {
    const first = shouldPauseAfterInvalidRun({
      policyStatus: "approved",
      consecutiveInvalidRuns: 0,
    });
    expect(first.keepLastProofGrace).toBe(true);
    expect(first.zeroMarketplaceStock).toBe(false);

    const second = shouldPauseAfterInvalidRun({
      policyStatus: "approved",
      consecutiveInvalidRuns: 1,
      invalidReason: "listed_zero_with_active_catalog",
    });
    expect(second.shouldPause).toBe(true);
    expect(second.zeroMarketplaceStock).toBe(true);
    expect(second.notify).toBe(true);
  });
});

describe("publish gate", () => {
  const proofAt = new Date();

  it("observation-only (default): never cuts qty regardless of policy", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 4400,
        policyStatus: "review_required",
        lastProofAt: null,
        enforced: false,
      })
    ).toBe(4400);
    expect(
      applySupplierStockPublishGate({
        baseStock: 12,
        policyStatus: "paused_due_to_scrape_failure",
        enforced: false,
      })
    ).toBe(12);
  });

  it("review_required blocks when enforced", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 100,
        policyStatus: "review_required",
        evidencePublishedQty: 10,
        lastProofAt: proofAt,
        enforced: true,
      })
    ).toBe(reviewBlockedDecision().publishedQty);
  });

  it("monitoring_only passthrough (TEMPORARY freeze) when enforced", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 4400,
        policyStatus: "monitoring_only",
        lastProofAt: null,
        enforced: true,
      })
    ).toBe(4400);
  });

  it("approved without lastProofAt → 0 when enforced (DB stock alone never publishes)", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 4400,
        policyStatus: "approved",
        evidencePublishedQty: 4400,
        lastProofAt: null,
        enforced: true,
      })
    ).toBe(0);
  });

  it("approved uses evidence when proof fresh and enforced", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 100,
        policyStatus: "approved",
        evidencePublishedQty: 3,
        lastProofAt: proofAt,
        enforced: true,
      })
    ).toBe(3);
  });

  it("first-invalid grace window constant documented", () => {
    expect(FIRST_INVALID_GRACE_MS).toBe(24 * 60 * 60 * 1000);
  });
});

describe("enforce mode + contract registry", () => {
  it("absent flag → observation only", () => {
    expect(isSupplierStockPublishEnforced({})).toBe(false);
    expect(isSupplierStockPublishEnforced({ SUPPLIER_STOCK_PUBLISH_ENFORCED: "0" })).toBe(false);
    expect(getSupplierStockEnforceMode({}).banner).toBe(OBSERVATION_ONLY_NOT_ENFORCED);
    expect(mayMutateMarketplaceStock({})).toBe(false);
  });

  it("flag=1 → enforced", () => {
    expect(isSupplierStockPublishEnforced({ SUPPLIER_STOCK_PUBLISH_ENFORCED: "1" })).toBe(true);
    expect(getSupplierStockEnforceMode({ SUPPLIER_STOCK_PUBLISH_ENFORCED: "1" }).banner).toBeNull();
    expect(mayMutateMarketplaceStock({ SUPPLIER_STOCK_PUBLISH_ENFORCED: "1" })).toBe(true);
  });

  it("batch1 suppliers have observation contract implemented", () => {
    const statuses = listSupplierContractStatuses();
    expect(statuses.length).toBeGreaterThanOrEqual(14);
    for (const key of ["fan", "haw", "bwz", "tus", "exl", "ven", "wrk"]) {
      expect(statuses.find((s) => s.supplierKey === key)?.observationContractImplemented).toBe(true);
    }
    expect(statuses.filter((s) => s.supplierKey === "wel" || s.supplierKey === "rei").every((s) => !s.observationContractImplemented)).toBe(
      true
    );
    expect(isEligibleForApproval({ supplierKey: "wel" }).eligibleForApproval).toBe(false);
    expect(isEligibleForApproval({ supplierKey: "haw", observationsReceivedThisRun: 1 }).eligibleForApproval).toBe(
      true
    );
    expect(isEligibleForApproval({ supplierKey: "fan", observationsReceivedThisRun: 1 }).eligibleForApproval).toBe(
      true
    );
  });

  it("run contract report honest when 0 observations", () => {
    const report = buildRunContractReport({
      supplierKey: "alt",
      observationsReceivedThisRun: 0,
      variantsProcessed: 0,
    });
    expect(report.observationContractImplemented).toBe(false);
    expect(report.observationsReceivedThisRun).toBe(0);
    expect(report.eligibleForApproval).toBe(false);
  });
});

describe("snapshot zero missing", () => {
  it("zeros only when complete snapshot helper used", () => {
    const zeros = zeroMissingFromCompleteSnapshot({
      seenVariantIds: new Set(["a"]),
      catalogVariantIds: ["a", "b"],
    });
    expect(zeros).toHaveLength(1);
    expect(zeros[0]!.zeroReason).toBe(notSeenInCompleteRunDecision().zeroReason);
  });
});

describe("reichelt / pokemon / pack", () => {
  it("excludes neon and >1.20m", () => {
    expect(evaluateSupplierExclusion({ supplierKey: "rei", productName: "Neonröhre" }).excluded).toBe(true);
    expect(evaluateSupplierExclusion({ supplierKey: "rei", productName: "Kabel 150 cm" }).excluded).toBe(true);
  });

  it("pokemon booster ≠ display", () => {
    expect(
      isPokemonBoosterDisplayConflict({
        title: "Pokemon Booster Pack",
        mappedTitle: "Booster Display 36 packs",
      })
    ).toBe(true);
  });

  it("qty 1 never becomes 100", () => {
    expect(
      detectPackSizeInflation({ internalQty: 1, publishedQty: 100, title: "WAGO 100er" }).inflated
    ).toBe(true);
    expect(inferPackCount("WAGO 100 Stück")).toBe(100);
  });
});

describe("defaults", () => {
  it("WEL/REI monitoring_only; others review_required", () => {
    expect(defaultPolicyStatusForSupplier("wel")).toBe("monitoring_only");
    expect(defaultPolicyStatusForSupplier("rei")).toBe("monitoring_only");
    expect(defaultPolicyStatusForSupplier("haw")).toBe("review_required");
  });
});

describe("notifications honesty", () => {
  it("does not claim SMS/WhatsApp delivered", () => {
    const d = describeNotifierChannels();
    expect(["not_implemented", "credentials_present_unwired", "missing"]).toContain(d.sms);
    expect(["not_implemented", "credentials_present_unwired", "missing"]).toContain(d.whatsapp);
    const pf = getEmailNotifyPreflight();
    expect(["configured", "recipient_missing", "not_configured"]).toContain(pf.status);
  });
});

describe("central hook call sites", () => {
  it("lists all scraper entry points as hooked", () => {
    expect(SCRAPER_STOCK_HOOK_CALL_SITES.length).toBeGreaterThanOrEqual(10);
    expect(SCRAPER_STOCK_HOOK_CALL_SITES.every((c) => c.hooked)).toBe(true);
  });
});

describe("reconcile without fresh evidence", () => {
  it("forces review + zero", () => {
    const obs: VariantObservation = {
      supplierKey: "exl",
      supplierVariantId: "exl_x",
      availabilityStatus: "confirmed_in_stock",
      supplierStockQty: 5,
      hasFreshSourceEvidence: false,
      zeroReason: ZERO_REASON_NO_FRESH_SOURCE,
    };
    const r = reconcileObservation(enrichObservation(obs));
    expect(r.publishedQty).toBe(0);
    expect(r.needsReview).toBe(true);
  });
});
