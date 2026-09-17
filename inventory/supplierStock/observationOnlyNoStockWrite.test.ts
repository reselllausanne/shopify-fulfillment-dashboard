/**
 * Explicit safety: SUPPLIER_STOCK_PUBLISH_ENFORCED unset/≠1 → zero SupplierVariant.stock writes,
 * even when cron/API finalize would otherwise pause-zero or apply approved qty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateMany = vi.fn(async () => ({ count: 0 }));
const policyUpdate = vi.fn(async () => ({}));
const qualityUpsert = vi.fn(async () => ({}));
const evidenceUpsert = vi.fn(async () => ({}));
const reviewCreate = vi.fn(async () => ({}));

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    supplierStockPolicy: {
      findUnique: vi.fn(async () => ({
        supplierKey: "exl",
        displayName: "Ex Libris",
        status: "approved",
        consecutiveInvalidRuns: 1,
        lastValidRunAt: new Date(),
      })),
      update: (...args: unknown[]) => policyUpdate(...args),
    },
    supplierVariant: {
      updateMany: (...args: unknown[]) => updateMany(...args),
      findMany: vi.fn(async () => [{ supplierVariantId: "exl_a" }, { supplierVariantId: "exl_b" }]),
    },
    supplierScrapeQualityRun: {
      upsert: (...args: unknown[]) => qualityUpsert(...args),
      findFirst: vi.fn(async () => null),
    },
    supplierVariantEvidence: {
      upsert: (...args: unknown[]) => evidenceUpsert(...args),
      findMany: vi.fn(async () => []),
    },
    supplierStockReviewItem: {
      create: (...args: unknown[]) => reviewCreate(...args),
    },
  },
}));

vi.mock("@/app/lib/scraperDb", () => ({
  scraperQuery: vi.fn(async () => [
    {
      id: "99",
      shop_id: "exl",
      started_at: new Date().toISOString(),
      finished_at: new Date().toISOString(),
      status: "ok",
      products_listed: 0,
      variants_upserted: 0,
      with_gtin: 0,
      errors: 0,
      message: "empty",
    },
  ]),
}));

vi.mock("./notify", () => ({
  createSupplierStockNotifier: () => ({
    notifyInvalidRunPause: vi.fn(async () => ({
      ok: true,
      channels: [],
      errors: [],
      emailStatus: "not_configured",
      smsStatus: "not_implemented",
      whatsappStatus: "not_implemented",
    })),
    notifyReviewQueue: vi.fn(async () => ({
      ok: true,
      channels: [],
      errors: [],
      emailStatus: "not_configured",
      smsStatus: "not_implemented",
      whatsappStatus: "not_implemented",
    })),
  }),
}));

import { finalizeSupplierStockFromScrapeRun } from "./hookScrape";
import { mayMutateMarketplaceStock, OBSERVATION_ONLY_NOT_ENFORCED } from "./enforceMode";
import { applySupplierStockPublishGate } from "./publishGate";
import { SCRAPER_STOCK_HOOK_CALL_SITES } from "@/app/lib/scraperRunner";

describe("observation-only: zero stock writes (cron/API path)", () => {
  const prev = process.env.SUPPLIER_STOCK_PUBLISH_ENFORCED;

  beforeEach(() => {
    delete process.env.SUPPLIER_STOCK_PUBLISH_ENFORCED;
    updateMany.mockClear();
    policyUpdate.mockClear();
    qualityUpsert.mockClear();
    evidenceUpsert.mockClear();
    reviewCreate.mockClear();
  });

  afterEach(() => {
    if (prev === undefined) delete process.env.SUPPLIER_STOCK_PUBLISH_ENFORCED;
    else process.env.SUPPLIER_STOCK_PUBLISH_ENFORCED = prev;
  });

  it("flag absent → mayMutateMarketplaceStock false", () => {
    expect(mayMutateMarketplaceStock()).toBe(false);
    expect(mayMutateMarketplaceStock({ SUPPLIER_STOCK_PUBLISH_ENFORCED: "0" })).toBe(false);
  });

  it("cron + API finalize via same hooked runner sites", () => {
    const paths = SCRAPER_STOCK_HOOK_CALL_SITES.map((s) => s.path);
    expect(paths).toContain("app/api/scraper/scrape/route.ts");
    expect(paths).toContain("scripts/scrape-cron.sh");
    expect(paths).toContain("scripts/run-exlibris-scrape.ts");
    expect(SCRAPER_STOCK_HOOK_CALL_SITES.every((s) => s.hooked)).toBe(true);
  });

  it("EXL empty run (2nd invalid / approved): finalize writes quality report but NEVER updateMany stock", async () => {
    const result = await finalizeSupplierStockFromScrapeRun("exl", 99, {
      priorActiveCatalog: 93000,
    });

    expect(result.ok).toBe(true);
    expect(result.valid).toBe(false);
    expect(mayMutateMarketplaceStock()).toBe(false);
    expect(updateMany).not.toHaveBeenCalled();
    expect(qualityUpsert).toHaveBeenCalled();
    const summary = (qualityUpsert.mock.calls[0]?.[0] as any)?.create?.summaryJson
      ?? (qualityUpsert.mock.calls[0]?.[0] as any)?.update?.summaryJson;
    expect(summary?.banner ?? OBSERVATION_ONLY_NOT_ENFORCED).toBe(OBSERVATION_ONLY_NOT_ENFORCED);
    expect(summary?.enforceMode).toBe("observation_only");
  });

  it("marketplace gate passthrough when flag off (feed attachAvailableStock path)", () => {
    expect(
      applySupplierStockPublishGate({
        baseStock: 250_000,
        policyStatus: "review_required",
        lastProofAt: null,
        enforced: false,
      })
    ).toBe(250_000);
  });
});
