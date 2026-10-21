import { describe, expect, it } from "vitest";
import {
  adminMatchUrl,
  filterFreshDedupeKeys,
  formatMediumOpsEmailBody,
  mediumCandidateDedupeKey,
  mediumOpsEmailSubject,
  productUrlFromUrlKey,
  type MediumMatchEmailItem,
} from "@/shopify/orders/emailMediumCandidates";

const sample: MediumMatchEmailItem = {
  shopifyOrderName: "#7601",
  shopifyLineItemId: "gid://shopify/LineItem/99",
  shopifyTitle: "Nike Dunk Low",
  shopifySku: "DD1391-100",
  shopifySizeEU: "42",
  stockxOrderNumber: "03-YELLOW1",
  stockxOrderId: "03-YELLOW1",
  stockxTitle: "Nike Dunk Low Retro",
  stockxSizeEU: "42",
  stockxSkuKey: "DD1391-100",
  score: 110,
  confidence: "medium",
  reasons: ["SKU match", "size match", "time>4d"],
  timeDiffHours: 120,
  suggestedCost: 140,
  urlKey: "nike-dunk-low-retro-white-black-2021",
};

describe("mediumOpsEmailSubject", () => {
  it("includes medium count and optional low", () => {
    expect(mediumOpsEmailSubject(2, 0)).toBe(
      "[Resell] StockX↔Shopify match jaune — action manuelle (2)"
    );
    expect(mediumOpsEmailSubject(2, 5)).toBe(
      "[Resell] StockX↔Shopify match jaune — action manuelle (2 · low 5)"
    );
  });
});

describe("link helpers", () => {
  it("builds match dashboard URL", () => {
    expect(adminMatchUrl("#7601", "https://example.com")).toBe(
      "https://example.com/?order=%237601"
    );
  });

  it("builds product URL from urlKey", () => {
    expect(productUrlFromUrlKey(sample.urlKey)).toBe(
      "https://stockx.com/fr-fr/nike-dunk-low-retro-white-black-2021"
    );
  });
});

describe("dedupe", () => {
  it("keys by line + stockx number", () => {
    expect(mediumCandidateDedupeKey(sample)).toBe(
      "gid://shopify/LineItem/99::03-YELLOW1"
    );
  });

  it("keeps only fresh keys", () => {
    const now = Date.parse("2026-10-21T12:00:00Z");
    const sent = {
      fresh: new Date(now - 60_000).toISOString(),
      stale: new Date(now - 8 * 24 * 60 * 60 * 1000).toISOString(),
    };
    const out = filterFreshDedupeKeys(sent, now);
    expect(out.fresh).toBeTruthy();
    expect(out.stale).toBeUndefined();
  });
});

describe("formatMediumOpsEmailBody", () => {
  it("includes Shopify/StockX ids, score, reasons, links", () => {
    const body = formatMediumOpsEmailBody([sample], {
      baseUrl: "https://solution.resell-lausanne.ch",
      lowBrief: [
        {
          ...sample,
          shopifyOrderName: "#7602",
          stockxOrderNumber: "03-LOW1",
          confidence: "low",
          score: 40,
        },
      ],
    });
    expect(body).toContain("Shopify #: #7601");
    expect(body).toContain("StockX #: 03-YELLOW1");
    expect(body).toContain("Score: 110");
    expect(body).toContain("SKU match");
    expect(body).toContain("Buy/Product URL: https://stockx.com/fr-fr/nike-dunk-low-retro-white-black-2021");
    expect(body).toContain("order=%237601");
    expect(body).toContain("LOW (brief");
    expect(body).toContain("#7602 ↔ 03-LOW1");
  });
});
