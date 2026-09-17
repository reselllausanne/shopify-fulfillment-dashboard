import { describe, expect, it } from "vitest";
import {
  detectPokemonBoosterDisplayMismatch,
  evaluateFeedIntegrityOmit,
  extractLongestDimensionMetres,
  extractStructuredDimensionMetres,
  resolveReicheltLongestDimensionMetres,
  sanitizePublishedQuantity,
  shouldOmitReicheltByIntegrity,
  shouldOmitWagoPackNotUnit,
} from "@/galaxus/exports/feedIntegrityRules";
import {
  buildFeedDeltaReport,
  formatFeedDeltaReportText,
} from "@/galaxus/exports/feedDeltaGuard";

describe("feedIntegrityRules", () => {
  it("parses longest dimension in metres", () => {
    expect(extractLongestDimensionMetres("Tube LED 1200 mm")).toBe(1.2);
    expect(extractLongestDimensionMetres("Tube LED 1500 mm")).toBe(1.5);
    expect(extractLongestDimensionMetres("barre 1,5 m")).toBe(1.5);
    // Short mm (<100) ignored by mm token (3–5 digits); must not become metres via "m" of "mm"
    expect(extractLongestDimensionMetres("cable 20 mm")).toBeNull();
    expect(extractLongestDimensionMetres("patch cable 20 m")).toBe(20);
  });

  it("parses structured Dimensions : A x B x C mm", () => {
    expect(
      extractStructuredDimensionMetres("Dimensions : 1500 x 50 x 50 mm")
    ).toBe(1.5);
    expect(
      extractStructuredDimensionMetres("Dimensions: 120 x 80 x 40 cm")
    ).toBe(1.2);
  });

  it("structured >1.20m → exclude", () => {
    const hit = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "Profil aluminium",
      manualNote: JSON.stringify({
        type: "reichelt_landed_cost",
        descriptionText: "Dimensions : 1500 x 50 x 50 mm anodisé",
      }),
    });
    expect(hit.omit).toBe(true);
    expect(hit.reason).toBe("REI_DIMENSION_OVER_120CM");
  });

  it("structured <=1.20m → keep", () => {
    const hit = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "Profil aluminium",
      manualNote: JSON.stringify({
        type: "reichelt_landed_cost",
        descriptionText: "Dimensions : 1200 x 50 x 50 mm",
      }),
    });
    expect(hit.omit).toBe(false);
  });

  it("unknown non-neon → keep", () => {
    const hit = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "Connecteur RJ45 Cat6",
    });
    expect(hit.omit).toBe(false);
    expect(resolveReicheltLongestDimensionMetres({ title: "Connecteur RJ45 Cat6" })).toBeNull();
  });

  it("prefers manualNote descriptionText over title", () => {
    const metres = resolveReicheltLongestDimensionMetres({
      title: "Tube 600 mm",
      manualNote: JSON.stringify({
        descriptionText: "Dimensions : 1800 x 26 x 26 mm",
      }),
    });
    expect(metres).toBe(1.8);
  });

  it("excludes Reichelt neon / >1.20 m with explicit reason", () => {
    const neon = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "Néon LED rose décoratif",
    });
    expect(neon.omit).toBe(true);
    expect(neon.reason).toMatch(/REI_/);

    const long = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "MÜLLER LICHT Tube LED T8 1500 mm verre",
    });
    expect(long.omit).toBe(true);
    expect(long.reason).toBe("REI_DIMENSION_OVER_120CM");

    const ok = shouldOmitReicheltByIntegrity({
      supplierKey: "rei",
      title: "MÜLLER LICHT Tube LED T8 600 mm",
    });
    expect(ok.omit).toBe(false);
  });

  it("flags WAGO multi-piece packs", () => {
    const hit = shouldOmitWagoPackNotUnit({
      title: "WAGO 221-412 Hebelklemmen 100 Stück",
    });
    expect(hit.omit).toBe(true);
    expect(hit.reason).toBe("WAGO_PACK_NOT_UNIT");
  });

  it("detects Pokémon booster↔display mismatch", () => {
    const hit = detectPokemonBoosterDisplayMismatch({
      title: "Pokémon Booster Pack Surging Sparks",
      mappedTitle: "Pokémon Booster Display Box 36 Boosters",
    });
    expect(hit.omit).toBe(true);
    expect(hit.reason).toBe("POKEMON_BOOSTER_DISPLAY_MISMATCH");
  });

  it("never publishes qty 1 as 100", () => {
    const r = sanitizePublishedQuantity({ internalQty: 1, publishedQty: 100 });
    expect(r.qty).toBe(1);
    expect(r.clamped).toBe(true);
    expect(r.reason).toBe("QTY_PACK_INFLATION");
  });

  it("evaluateFeedIntegrityOmit wires REI dimension reason", () => {
    const hit = evaluateFeedIntegrityOmit({
      supplierKey: "rei",
      title: "LED-Röhre 1800 mm Neon",
    });
    expect(hit.omit).toBe(true);
    expect(hit.reason).toBeDefined();
  });
});

describe("feedDeltaGuard", () => {
  it("blocks abnormal positive-stock drop", () => {
    const report = buildFeedDeltaReport({
      dryRun: true,
      previousStockRows: 900_000,
      previousOfferRows: 900_000,
      previousPositiveStockRows: 500_000,
      nextStockRows: 900_000,
      nextOfferRows: 900_000,
      nextPositiveStockRows: 450_000,
      expressToStandard: 49_000,
      exclusions: [
        {
          providerKey: "REI_1",
          supplier: "rei",
          reason: "REI_DIMENSION_OVER_120CM",
          detail: "1.50m",
        },
      ],
      config: { maxPositiveStockDropAbs: 15_000, maxPositiveStockDropPct: 0.08 },
    });
    expect(report.guard.blocked).toBe(true);
    expect(report.expressToStandard).toBe(49_000);
    expect(report.exclusionsByReason.REI_DIMENSION_OVER_120CM).toBe(1);
    const text = formatFeedDeltaReportText(report);
    expect(text).toContain("DRY-RUN");
    expect(text).toContain("Blocked publish");
  });

  it("allows small drops", () => {
    const report = buildFeedDeltaReport({
      dryRun: false,
      previousStockRows: 1000,
      previousOfferRows: 1000,
      previousPositiveStockRows: 1000,
      nextStockRows: 995,
      nextOfferRows: 995,
      nextPositiveStockRows: 995,
      config: { maxPositiveStockDropAbs: 15_000, maxPositiveStockDropPct: 0.08 },
    });
    expect(report.guard.blocked).toBe(false);
  });
});
