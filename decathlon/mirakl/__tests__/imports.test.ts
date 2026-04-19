import { describe, expect, it } from "vitest";
import { createDecathlonExclusionSummary } from "@/decathlon/exports/mapping";
import { __test__ as importsTest } from "../imports";

describe("mirakl import parsing", () => {
  it("detects semicolon delimiters", () => {
    const csv = "\"offer-sku\";\"error\"\n\"PK_1\";\"Missing field\"";
    expect(importsTest.detectDelimiter(csv)).toBe(";");
  });

  it("parses error report and extracts failed skus", () => {
    const csv = "\"offer-sku\";\"error\"\n\"PK_1\";\"Bad data\"\n\"PK_2\";\"Bad data\"";
    const report = importsTest.parseErrorReport(csv);
    expect(report.failedSkus.has("PK_1")).toBe(true);
    expect(report.summary.topReasons[0].count).toBe(2);
  });

  it("parses product identifier errors", () => {
    const csv = "\"Product Identifier\";\"error\"\n\"PROD_1\";\"Missing field\"";
    const report = importsTest.parseErrorReport(csv);
    expect(report.failedSkus.has("PROD_1")).toBe(true);
  });

  it("CM11 LIVE: filters offers when product is not live", () => {
    const summary = createDecathlonExclusionSummary();
    const offers = [
      {
        providerKey: "PK_1",
        gtin: "111",
        offerSku: "PK_1",
        supplierVariantId: null,
        price: "10.00",
        stock: 1,
      },
      {
        providerKey: "PK_2",
        gtin: "222",
        offerSku: "PK_2",
        supplierVariantId: null,
        price: "12.00",
        stock: 2,
      },
    ];
    const lookup = {
      byProductId: new Map([["PK_1", "NOT_LIVE"], ["PK_2", "LIVE"]]),
      byEan: new Map<string, string>(),
    };
    const result = importsTest.filterOffersByCm11Policy(offers, lookup, summary, "LIVE");
    expect(result.eligible.length).toBe(1);
    expect(result.blockedNotLive).toBe(1);
    expect(summary.totals.PRODUCT_NOT_LIVE).toBe(1);
  });

  it("CM11 KNOWN: keeps NOT_LIVE when a CM11 row exists; drops only UNKNOWN", () => {
    const summary = createDecathlonExclusionSummary();
    const offers = [
      {
        providerKey: "PK_1",
        gtin: "111",
        offerSku: "PK_1",
        supplierVariantId: null,
        price: "10.00",
        stock: 1,
      },
      {
        providerKey: "PK_3",
        gtin: "333",
        offerSku: "PK_3",
        supplierVariantId: null,
        price: "9.00",
        stock: 1,
      },
    ];
    const lookup = {
      byProductId: new Map([["PK_1", "NOT_LIVE"]]),
      byEan: new Map<string, string>(),
    };
    const result = importsTest.filterOffersByCm11Policy(offers, lookup, summary, "KNOWN");
    expect(result.eligible.map((r) => r.providerKey)).toEqual(["PK_1"]);
    expect(result.blockedCm11Unknown).toBe(1);
  });

  it("maps import status with error lines to PARTIAL", () => {
    expect(importsTest.mapImportStatus("COMPLETE", 2)).toBe("PARTIAL");
    expect(importsTest.mapImportStatus("FAILED", 0)).toBe("FAILED");
  });

  it("maps P51 product import intermediate states to RUNNING", () => {
    expect(importsTest.mapImportStatus("TRANSFORMATION_WAITING", 0)).toBe("RUNNING");
    expect(importsTest.mapImportStatus("RUNNING", 0)).toBe("RUNNING");
  });
});
