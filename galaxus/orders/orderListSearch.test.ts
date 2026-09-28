import { describe, expect, it } from "vitest";
import {
  buildOrderListSearchOrClauses,
  classifyOrderListSearch,
  shouldResolveCatalogSku,
} from "@/galaxus/orders/orderListSearch";

describe("classifyOrderListSearch", () => {
  it("treats product names as text (multi-hit)", () => {
    expect(classifyOrderListSearch("midnight")).toBe("text");
    expect(classifyOrderListSearch("Air Jordan")).toBe("text");
  });

  it("treats model numbers as model (multi-hit)", () => {
    expect(classifyOrderListSearch("1130")).toBe("model");
    expect(classifyOrderListSearch("2002r")).toBe("model");
    expect(classifyOrderListSearch("FQ8144")).toBe("model");
  });

  it("treats full style-colorway as full_sku (precise)", () => {
    expect(classifyOrderListSearch("FQ8144-001")).toBe("full_sku");
    expect(classifyOrderListSearch("DM0029_102")).toBe("full_sku");
    expect(classifyOrderListSearch("STX_ABC123")).toBe("full_sku");
  });

  it("treats long digit strings as order ids", () => {
    expect(classifyOrderListSearch("12345678")).toBe("order_id");
  });
});

describe("buildOrderListSearchOrClauses", () => {
  it("midnight searches product + person fields", () => {
    const clauses = buildOrderListSearchOrClauses("midnight");
    expect(clauses.length).toBeGreaterThan(0);
    const blob = JSON.stringify(clauses);
    expect(blob).toContain("midnight");
    expect(blob).toContain("productName");
    expect(blob).toContain("recipientName");
  });

  it("1130 only searches line identity (not size / random names)", () => {
    const clauses = buildOrderListSearchOrClauses("1130");
    const blob = JSON.stringify(clauses);
    expect(blob).toContain("1130");
    expect(blob).toContain("productName");
    expect(blob).not.toContain('"size"');
    expect(blob).not.toContain("recipientName");
  });

  it("full SKU requires all tokens on the same line", () => {
    const clauses = buildOrderListSearchOrClauses("FQ8144-001");
    const blob = JSON.stringify(clauses);
    expect(blob).toContain("FQ8144");
    expect(blob).toContain("001");
    expect(blob).toContain('"AND"');
    expect(blob).not.toContain("recipientName");
  });

  it("asics 1130 ANDs tokens on one line", () => {
    const clauses = buildOrderListSearchOrClauses("asics 1130");
    expect(classifyOrderListSearch("asics 1130")).toBe("text");
    const andClause = clauses.find((c) => (c as { lines?: { some?: { AND?: unknown } } }).lines?.some?.AND);
    expect(andClause).toBeTruthy();
  });

  it("skips tiny queries", () => {
    expect(buildOrderListSearchOrClauses("a")).toEqual([]);
  });

  it("resolves catalog for model/text/sku", () => {
    expect(shouldResolveCatalogSku("midnight")).toBe(true);
    expect(shouldResolveCatalogSku("1130")).toBe(true);
    expect(shouldResolveCatalogSku("FQ8144-001")).toBe(true);
    expect(shouldResolveCatalogSku("12345678")).toBe(false);
  });
});
