import { describe, expect, it } from "vitest";
import {
  collectRecipientHints,
  extractStockxOtp,
  recipientMatchesLogin,
} from "@/lib/stockxEmailOtp";

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

describe("recipientMatchesLogin", () => {
  it("matches forwarded Galaxus OTP by original To", () => {
    const recipients = collectRecipientHints({
      envelopeTo: [{ address: "reselllausanne@gmail.com" }],
      rawSource:
        "Delivered-To: reselllausanne@gmail.com\nX-Original-To: contact@resell-lausanne.ch\nTo: contact@resell-lausanne.ch\n",
    });
    expect(recipients).toContain("contact@resell-lausanne.ch");
    expect(recipientMatchesLogin("contact@resell-lausanne.ch", recipients)).toBe(true);
    expect(recipientMatchesLogin("reselllausanne@gmail.com", recipients)).toBe(true);
  });

  it("rejects OTP meant for the other StockX account", () => {
    expect(
      recipientMatchesLogin("contact@resell-lausanne.ch", ["reselllausanne@gmail.com"])
    ).toBe(false);
  });
});
