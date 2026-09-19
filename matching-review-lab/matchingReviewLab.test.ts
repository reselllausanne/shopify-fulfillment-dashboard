import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ShopifyLineItem } from "@/app/utils/matching";
import {
  accountKeyMatchesChannel,
  stockxAccountKeyForGalaxus,
  stockxAccountKeyForShopify,
} from "@/matching-review-lab/accountKeys";
import { requiresGenderOrSizeSystemReview } from "@/matching-review-lab/genderReview";
import { buildRulesReport } from "@/matching-review-lab/proposeRules";
import {
  buildReviewRecord,
  readReviews,
  saveReview,
} from "@/matching-review-lab/reviewsStore";
import { searchStockxBuys } from "@/matching-review-lab/searchBuys";
import { simulateBatch, simulateUnitMatch } from "@/matching-review-lab/simulate";
import type {
  LabClientUnit,
  LabStockxBuy,
} from "@/matching-review-lab/types";

function shopifyLine(partial: Partial<ShopifyLineItem> & Pick<ShopifyLineItem, "title" | "createdAt" | "orderName" | "lineItemId">): ShopifyLineItem {
  return {
    shopifyOrderId: partial.shopifyOrderId ?? "1001",
    orderName: partial.orderName,
    createdAt: partial.createdAt,
    displayFinancialStatus: "PAID",
    displayFulfillmentStatus: "UNFULFILLED",
    customerEmail: null,
    customerName: null,
    customerFirstName: null,
    customerLastName: null,
    shippingCountry: "CH",
    shippingCity: "Lausanne",
    lineItemId: partial.lineItemId,
    title: partial.title,
    sku: partial.sku ?? "DQ8426-001",
    variantTitle: partial.variantTitle ?? "42",
    quantity: 1,
    price: "200",
    totalPrice: "200",
    currencyCode: "CHF",
    sizeEU: partial.sizeEU ?? "42",
    lineItemImageUrl: null,
    gtin: partial.gtin ?? "0190000000001",
  };
}

function unit(partial: Partial<LabClientUnit> & { channel: LabClientUnit["channel"]; orderDate: string; title: string }): LabClientUnit {
  const line = shopifyLine({
    title: partial.title,
    createdAt: partial.orderDate,
    orderName: partial.orderNumber ?? "#1001",
    lineItemId: partial.lineId ?? "line-1",
    sku: partial.sku ?? "DQ8426-001",
    sizeEU: partial.sizeRaw ?? "42",
    variantTitle: partial.sizeRaw ?? "42",
  });
  return {
    unitKey: partial.unitKey ?? `${partial.channel}:#1001:line-1:0`,
    channel: partial.channel,
    orderId: partial.orderId ?? "ord-1",
    orderNumber: partial.orderNumber ?? "#1001",
    orderDate: partial.orderDate,
    lineId: partial.lineId ?? "line-1",
    unitIndex: partial.unitIndex ?? 0,
    remainingQty: 1,
    productTitle: partial.title,
    gtin: partial.gtin ?? "0190000000001",
    sku: partial.sku ?? "DQ8426-001",
    styleId: partial.sku ?? "DQ8426-001",
    sizeRaw: partial.sizeRaw ?? "42",
    sizeNormalized: partial.sizeNormalized ?? "42",
    shopifyLine: line,
    stockxVariantId: partial.stockxVariantId ?? null,
    stockxAccountKeyExpected:
      partial.stockxAccountKeyExpected ??
      (partial.channel === "SHOPIFY" ? "shopify:default" : "galaxus:default"),
  };
}

function buy(partial: Partial<LabStockxBuy> & { account: LabStockxBuy["stockxAccountKey"]; number: string; purchaseDate: string; title: string }): LabStockxBuy {
  return {
    chainId: partial.chainId ?? "chain-1",
    orderId: partial.orderId ?? partial.number,
    supplierOrderNumber: partial.number,
    supplierSource: "STOCKX",
    purchaseDate: partial.purchaseDate,
    offerAmount: partial.offerAmount ?? 120,
    totalTTC: null,
    productTitle: partial.title,
    productName: partial.title,
    skuKey: partial.skuKey ?? "DQ8426-001",
    sizeEU: partial.sizeEU ?? "42",
    statusKey: "AUTHENTICATING",
    statusTitle: "Authenticating",
    currencyCode: "CHF",
    awb: partial.awb ?? "AWB123",
    trackingUrl: null,
    productVariantId: partial.productVariantId ?? "var-abc",
    stockxAccountKey: partial.account,
    gtin: partial.gtin ?? "0190000000001",
  };
}

describe("Matching Review Lab", () => {
  it("matches Shopify existing path with same name/size/causal proofs", () => {
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
      sku: "DD1391-100",
      sizeRaw: "42",
    });
    const buys = [
      buy({
        account: "shopify:default",
        number: "01-SHOP-OK",
        purchaseDate: "2026-09-10T12:00:00.000Z",
        title: "Nike Dunk Low Retro Black White",
        skuKey: "DD1391-100",
        sizeEU: "42",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(), new Set());
    expect(proposal.proposed).not.toBeNull();
    expect(proposal.matchMethod).toBe("NAME_SIZE_TIME");
    expect(proposal.proposed!.supplierOrder.supplierOrderNumber).toBe("01-SHOP-OK");
    expect(proposal.proposed!.reasons.some((r) => r.includes("causal") || r.includes("Valid causal"))).toBe(
      true
    );
  });

  it("matches Galaxus with VARIANT_ID same causal proofs", () => {
    const u = unit({
      channel: "GALAXUS",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Adidas Samba OG",
      stockxVariantId: "var-abc",
      sizeRaw: "42",
    });
    const buys = [
      buy({
        account: "galaxus:default",
        number: "01-GAL-OK",
        purchaseDate: "2026-09-10T11:00:00.000Z",
        title: "Adidas Samba OG",
        productVariantId: "var-abc",
        sizeEU: "42",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(), new Set());
    expect(proposal.matchMethod).toBe("VARIANT_ID");
    expect(proposal.proposed!.supplierOrder.supplierOrderNumber).toBe("01-GAL-OK");
    expect(proposal.proposed!.reasons).toContain("VARIANT_ID");
  });

  it("refuses StockX buy before customer sale", () => {
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T12:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
      sku: "DD1391-100",
    });
    const buys = [
      buy({
        account: "shopify:default",
        number: "01-EARLY",
        purchaseDate: "2026-09-10T10:00:00.000Z",
        title: "Nike Dunk Low Retro Black White",
        skuKey: "DD1391-100",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(), new Set());
    expect(proposal.proposed).toBeNull();
    expect(proposal.refusalReasons.some((r) => r.startsWith("WRONG_CAUSAL_DATE"))).toBe(true);
  });

  it("refuses wrong StockX account", () => {
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
      sku: "DD1391-100",
    });
    const buys = [
      buy({
        account: "galaxus:default",
        number: "01-WRONG-ACC",
        purchaseDate: "2026-09-10T12:00:00.000Z",
        title: "Nike Dunk Low Retro Black White",
        skuKey: "DD1391-100",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(), new Set(), {
      enforceAccountSeparation: true,
    });
    expect(proposal.proposed).toBeNull();
    expect(proposal.refusalReasons.some((r) => r.startsWith("WRONG_STOCKX_ACCOUNT"))).toBe(true);
    expect(accountKeyMatchesChannel("SHOPIFY", "galaxus:default")).toBe(false);
  });

  it("refuses already consumed StockX buy", () => {
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
      sku: "DD1391-100",
    });
    const buys = [
      buy({
        account: "shopify:default",
        number: "01-USED",
        purchaseDate: "2026-09-10T12:00:00.000Z",
        title: "Nike Dunk Low Retro Black White",
        skuKey: "DD1391-100",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(["01-USED"]), new Set());
    expect(proposal.proposed).toBeNull();
    expect(proposal.refusalReasons.some((r) => r.startsWith("ALREADY_CONSUMED"))).toBe(true);
  });

  it("sends Women/GS cases to review", () => {
    expect(
      requiresGenderOrSizeSystemReview({
        clientTitle: "Nike Dunk Low Women",
        clientSize: "38",
      })
    ).toBe(true);
    expect(
      requiresGenderOrSizeSystemReview({
        clientTitle: "Jordan 1 Mid",
        clientSize: "5.5Y",
      })
    ).toBe(true);

    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Women White",
      sku: "DD1503-100",
      sizeRaw: "38",
    });
    u.shopifyLine.title = "Nike Dunk Low Women White";
    const buys = [
      buy({
        account: "shopify:default",
        number: "01-WOMEN",
        purchaseDate: "2026-09-10T12:00:00.000Z",
        title: "Nike Dunk Low Women White",
        skuKey: "DD1503-100",
        sizeEU: "38",
      }),
    ];
    const proposal = simulateUnitMatch(u, buys, new Set(), new Set());
    expect(proposal.needsGenderOrSizeReview).toBe(true);
    expect(proposal.refusalReasons).toContain("WOMEN_OR_GS_SENT_TO_REVIEW");
  });

  it("records manual correction without writing live match", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mrl-"));
    const filePath = path.join(dir, "reviews.jsonl");
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
    });
    const correct = buy({
      account: "shopify:default",
      number: "01-CORRECT",
      purchaseDate: "2026-09-10T14:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
    });
    const wrong = buy({
      account: "shopify:default",
      number: "01-WRONG",
      purchaseDate: "2026-09-10T12:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
    });
    const proposal = simulateUnitMatch(u, [wrong, correct], new Set(), new Set());
    const record = saveReview(
      {
        proposal,
        decision: "WRONG_PICK_BUY",
        reasonCodes: ["WRONG_PRODUCT"],
        reasonNote: "picked wrong buy",
        chosenBuy: correct,
      },
      filePath
    );
    expect(record.wroteLiveMatch).toBe(false);
    expect(record.chosenBuyOrderNumber).toBe("01-CORRECT");
    const loaded = readReviews(filePath);
    expect(loaded).toHaveLength(1);
    expect(loaded[0]!.wroteLiveMatch).toBe(false);
  });

  it("builds rules report proposed but not applied", () => {
    const u = unit({
      channel: "SHOPIFY",
      orderDate: "2026-09-10T10:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
    });
    const b = buy({
      account: "shopify:default",
      number: "01-X",
      purchaseDate: "2026-09-10T12:00:00.000Z",
      title: "Nike Dunk Low Retro Black White",
    });
    const proposal = simulateUnitMatch(u, [b], new Set(), new Set());
    const r1 = buildReviewRecord({
      proposal,
      decision: "WRONG_PICK_BUY",
      reasonCodes: ["WRONG_SIZE"],
      chosenBuy: b,
    });
    const r2 = buildReviewRecord({
      proposal: {
        ...proposal,
        unit: { ...proposal.unit, unitKey: "SHOPIFY:#1002:line-1:0", orderNumber: "#1002" },
      },
      decision: "WRONG_PICK_BUY",
      reasonCodes: ["WRONG_SIZE"],
      chosenBuy: b,
    });
    const report = buildRulesReport([r1, r2]);
    expect(report.generalizableRules.length).toBeGreaterThan(0);
    expect(report.generalizableRules.every((r) => r.applied === false)).toBe(true);
    expect(report.note).toContain("separate PR");
  });

  it("searches buys by AWB / buy order / SKU", () => {
    const buys = [
      buy({
        account: "shopify:default",
        number: "01-SEARCH",
        orderId: "oid-search",
        purchaseDate: "2026-09-10T12:00:00.000Z",
        title: "New Balance 550 White Green",
        skuKey: "BB550WT1",
        awb: "TRACK-999",
        sizeEU: "43",
      }),
    ];
    expect(searchStockxBuys(buys, { awb: "TRACK-999" })).toHaveLength(1);
    expect(searchStockxBuys(buys, { buyOrderId: "oid-search" })).toHaveLength(1);
    expect(searchStockxBuys(buys, { sku: "BB550WT1" })).toHaveLength(1);
    expect(searchStockxBuys(buys, { name: "New Balance", size: "43" })).toHaveLength(1);
    expect(searchStockxBuys(buys, { awb: "NOPE" })).toHaveLength(0);
  });

  it("batch stats + account key helpers", () => {
    expect(stockxAccountKeyForShopify({ customerUuid: "abc-uuid" })).toBe("shopify:abc-uuid");
    expect(stockxAccountKeyForGalaxus({ source: "galaxus" })).toBe("galaxus:galaxus");
    const result = simulateBatch(
      [
        unit({
          channel: "SHOPIFY",
          orderDate: "2026-09-10T10:00:00.000Z",
          title: "Nike Dunk Low Retro Black White",
          sku: "DD1391-100",
        }),
      ],
      [
        buy({
          account: "shopify:default",
          number: "01-BATCH",
          purchaseDate: "2026-09-10T12:00:00.000Z",
          title: "Nike Dunk Low Retro Black White",
          skuKey: "DD1391-100",
        }),
      ]
    );
    expect(result.stats.totalUnits).toBe(1);
    expect(result.stats.withProposal).toBe(1);
  });
});
