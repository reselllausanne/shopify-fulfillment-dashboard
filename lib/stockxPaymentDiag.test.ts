import { describe, expect, it } from "vitest";
import {
  CARD_DECLINED_HALT_REASON,
  extractPaymentSnippet,
  isCardDeclined,
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

describe("isCardDeclined (real StockX pages, 26 Nov 2026)", () => {
  const FR =
    " tab Retour adidas AE 1 Low MX Grey Taille : EU 40 2/3 Nouveautés vérifiées Une erreur s'est produite avec votre mode de paiement. Merci d'indiquer un nouveau mode de paiement, puis réessayez. Actualiser Forte demande 72 personnes sont intéressées par ce produit Taille : EU 40 2/3 MODIFIER Prix de l'article de 64 CHF Recevez votre commande d'ici le Sous-total 4 décembre - 14 décembre 89,81 CHF";
  const EN =
    "GG Tasman Weather Hybrid Slipper Black Size: US M 5 New & Verified There was an error with your payment method. Please enter a new payment method and try again. Update High Demand 61 people are interested in this product";
  it("FR banner", () => expect(isCardDeclined(FR, "https://stockx.com/fr-fr/buy/adidas-ae-1-low-mx-grey?size=7.5")).toBe(true));
  it("EN banner", () => expect(isCardDeclined(EN, "https://stockx.com/buy/ugg-tasman-weather-hybrid-slipper-black")).toBe(true));
  it.each([
    "Your payment was declined",
    "Payment method declined",
    "Paiement refusé",
    "Votre carte a été refusée",
    "card was declined",
    "Insufficient funds",
    "Fonds insuffisants",
    "Please update your payment method",
    "Mettez à jour votre mode de paiement",
    "3-D Secure authentication failed",
  ])("common wording: %s", (t) => expect(isCardDeclined(t)).toBe(true));
  it("never on /buying/ pages (order list / detail)", () => {
    expect(isCardDeclined(FR, "https://stockx.com/fr-fr/buying/orders")).toBe(false);
  });
  it("normal checkout / confirmation text is not a decline", () => {
    expect(isCardDeclined("Passer commande Sous-total 89,81 CHF Commission de traitement incluse. Gift Cards Login to Apply", "https://stockx.com/fr-fr/buy/x")).toBe(false);
    expect(isCardDeclined("Merci ! Votre commande 03-ABCDEF1234 est confirmée", "https://stockx.com/fr-fr/buy/x")).toBe(false);
    expect(isCardDeclined("Please try again later, something went wrong loading sizes", "")).toBe(false);
    expect(isCardDeclined("", "")).toBe(false);
  });
  it("halt reason constant", () => expect(CARD_DECLINED_HALT_REASON).toBe("card declined — fund/unlock card"));
});
