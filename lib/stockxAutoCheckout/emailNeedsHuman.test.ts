import { describe, expect, it } from "vitest";
import {
  formatNeedsHumanEmailBody,
  needsHumanEmailSubject,
} from "@/lib/stockxAutoCheckout/emailNeedsHuman";
import type { StockxNeedsHumanPayload } from "@/lib/stockxAutoCheckout/types";

const sample: StockxNeedsHumanPayload = {
  shopifyOrderName: "#7541",
  shopifyOrderId: "gid://shopify/Order/1",
  shopifyLineItemId: "gid://shopify/LineItem/2",
  title: "Adidas Handball Spezial",
  sku: "IF5741-420",
  saleChf: 129.0,
  slug: "adidas-handball-spezial-fox-brown-clear-sky",
  productUrl: "https://stockx.com/fr-fr/adidas-handball-spezial-fox-brown-clear-sky",
  buyUrl:
    "https://stockx.com/fr-fr/adidas-handball-spezial-fox-brown-clear-sky?size=8.5",
  sizeEU: "EU 42",
  sizeUS: "8.5",
  desiredLane: "STANDARD",
  lanes: [
    { label: "STANDARD", rawLabel: "Standard", totalChf: 86.74, eta: "5-7j" },
    { label: "EXPRESS", rawLabel: "Express", totalChf: 142, eta: "24 oct" },
  ],
  recommended: {
    label: "STANDARD",
    rawLabel: "Standard",
    totalChf: 86.74,
    eta: "5-7j",
  },
  reason: "multi_price",
  detail: "deux asks Standard",
  screenshotRel: "stockx-auto-7541.png",
};

describe("needsHumanEmailSubject", () => {
  it("counts items", () => {
    expect(needsHumanEmailSubject(3)).toBe(
      "[Resell] StockX auto-checkout — action manuelle (3)"
    );
  });
});

describe("formatNeedsHumanEmailBody", () => {
  it("includes FR ops fields", () => {
    const body = formatNeedsHumanEmailBody([sample]);
    expect(body).toContain("Shopify #: #7541");
    expect(body).toContain("Line: gid://shopify/LineItem/2");
    expect(body).toContain("Titre: Adidas Handball Spezial");
    expect(body).toContain("SKU: IF5741-420");
    expect(body).toContain("Vente: 129.00 CHF");
    expect(body).toContain("Taille EU: EU 42 · Taille US: 8.5");
    expect(body).toContain("Lane désirée (depuis Shopify Express): STANDARD");
    expect(body).toContain("Plusieurs prix pour la lane demandée");
    expect(body).toContain("deux asks Standard");
    expect(body).toContain("Slug: adidas-handball-spezial-fox-brown-clear-sky");
    expect(body).toContain("Buy URL (size US):");
    expect(body).toContain("size=8.5");
    expect(body).toContain("Recommandé: Standard: 86.74 CHF");
    expect(body).toContain("Toutes les lanes");
    expect(body).toContain("Express: 142.00 CHF");
    expect(body).toContain("Screenshot VPS: .data/stockx-auto-7541.png");
  });
});
