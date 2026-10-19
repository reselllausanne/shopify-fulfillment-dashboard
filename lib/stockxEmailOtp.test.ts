import { describe, expect, it } from "vitest";
import { extractStockxOtp } from "@/lib/stockxEmailOtp";

describe("extractStockxOtp", () => {
  it("extracts a StockX verification code", () => {
    expect(extractStockxOtp("Your StockX verification code is 482913. It expires soon.")).toBe(
      "482913"
    );
  });

  it("extracts a code written before its label", () => {
    expect(extractStockxOtp("731204 is your one-time authentication code.")).toBe("731204");
  });

  it("ignores unrelated six-digit numbers", () => {
    expect(extractStockxOtp("StockX order 731204 shipped today.")).toBeNull();
  });

  it("rejects ambiguous codes", () => {
    expect(extractStockxOtp("Use verification code 123456 or code 654321.")).toBe("123456");
  });
});
