import { describe, expect, it } from "vitest";
import {
  looksLikeStockxOrderNumber,
  normalizeStockxOrderNumberInput,
} from "@/decathlon/stx/manualStockxEnrich";
import { buyOrderNumbersMatch } from "@/galaxus/stx/stockxClient";

describe("normalizeStockxOrderNumberInput", () => {
  it("strips leading hash from Pro paste", () => {
    expect(normalizeStockxOrderNumberInput("#03-2GJ0J7WHDV")).toBe("03-2GJ0J7WHDV");
    expect(normalizeStockxOrderNumberInput("##03-2GJ0J7WHDV")).toBe("03-2GJ0J7WHDV");
  });
});

describe("looksLikeStockxOrderNumber", () => {
  it("accepts hashed and bare StockX order numbers", () => {
    expect(looksLikeStockxOrderNumber("#03-2GJ0J7WHDV")).toBe(true);
    expect(looksLikeStockxOrderNumber("03-2GJ0J7WHDV")).toBe(true);
  });

  it("rejects empty / urls / spaces", () => {
    expect(looksLikeStockxOrderNumber("")).toBe(false);
    expect(looksLikeStockxOrderNumber("https://stockx.com/x")).toBe(false);
    expect(looksLikeStockxOrderNumber("03 2GJ0")).toBe(false);
  });
});

describe("buyOrderNumbersMatch", () => {
  it("matches with or without leading hash", () => {
    expect(buyOrderNumbersMatch("03-2GJ0J7WHDV", "#03-2GJ0J7WHDV")).toBe(true);
    expect(buyOrderNumbersMatch("#03-2GJ0J7WHDV", "03-2GJ0J7WHDV")).toBe(true);
  });
});
