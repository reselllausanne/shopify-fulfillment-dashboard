import { describe, expect, it } from "vitest";
import {
  extractPaymentSnippet,
  isPaymentNotCompletedDetail,
  isPaymentRefused,
  nextPaymentStreak,
  paymentBreakerTripped,
  PAYMENT_BREAKER_LIMIT,
} from "./stockxPaymentDiag";

describe("isPaymentRefused", () => {
  it.each([
    "Your card was declined",
    "Carte refusée",
    "Paiement refusé",
    "Insufficient funds",
    "Your card has expired",
    "3-D Secure authentication required",
    "Authentication required to complete payment",
    "There was a problem with your order",
    "Something went wrong. Please try again.",
    "Veuillez réessayer",
    "Une erreur est survenue: paiement impossible",
  ])("refused: %s", (t) => {
    expect(isPaymentRefused(t, "https://stockx.com/checkout")).toBe(true);
  });
  it("orders list nav (Gift Cards) is not a refusal", () => {
    const nav = "Skip to Main Content StockX Wallet Payments, Payouts, Gift Cards, Buying Active Offers & Bids, In-Progress";
    expect(isPaymentRefused(nav, "https://stockx.com/buying/orders")).toBe(false);
    expect(isPaymentRefused(nav, "https://stockx.com/checkout")).toBe(false);
  });
  it("never refused on /buying/ even with scary words", () => {
    expect(isPaymentRefused("something went wrong", "https://stockx.com/buying/orders")).toBe(false);
  });
});

describe("extractPaymentSnippet", () => {
  it("centers on the payment keyword, skipping nav", () => {
    const body = "Skip to Main Content StockX Sneakers Shoes ".repeat(20) + " Your card was declined. Please use another payment method.";
    const s = extractPaymentSnippet(body, 400);
    expect(s).toContain("declined");
    expect(s.length).toBeLessThanOrEqual(400);
  });
  it("no keyword: drops nav header", () => {
    const s = extractPaymentSnippet("Skip to Main Content StockX Log Out " + "Order summary item total ".repeat(5));
    expect(s.startsWith("Order summary")).toBe(true);
  });
  it("empty", () => {
    expect(extractPaymentSnippet("")).toBe("");
  });
});

describe("payment breaker", () => {
  it("trips at 3 consecutive no-order, resets on order", () => {
    let s = 0;
    s = nextPaymentStreak(s, "no_order");
    s = nextPaymentStreak(s, "no_order");
    expect(paymentBreakerTripped(s)).toBe(false);
    s = nextPaymentStreak(s, "order");
    expect(s).toBe(0);
    for (let i = 0; i < PAYMENT_BREAKER_LIMIT; i += 1) s = nextPaymentStreak(s, "no_order");
    expect(paymentBreakerTripped(s)).toBe(true);
  });
  it("detail prefix", () => {
    expect(isPaymentNotCompletedDetail("Payment not completed (no charge): x")).toBe(true);
    expect(isPaymentNotCompletedDetail("Paid but no StockX order number")).toBe(false);
    expect(isPaymentNotCompletedDetail(null)).toBe(false);
  });
});
