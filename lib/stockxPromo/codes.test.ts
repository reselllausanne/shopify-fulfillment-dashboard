import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { failureClass } from "@/lib/stockxBuyer/attemptCap";
import { isCardDeclined, isPaymentRefused } from "@/lib/stockxPaymentDiag";
import {
  accountForRecipients,
  lastCheckoutTotalChf,
  mergePromoCodes,
  pickNextPromo,
  promoApplyOutcome,
  promosFromMail,
  type PromoCode,
} from "@/lib/stockxPromo/codes";
import { claimNextPromo, markPromoRejected, markPromoUsed, mergeScannedPromos, releasePromoHold } from "@/lib/stockxPromo/store";

/**
 * Anonymized excerpt of a real StockX reward mail (26 Nov 2026).
 * Names, mailbox, and the live code are stripped. Shape kept: "Code promo : …".
 */
const ANON_PROMO_MAIL =
  "Tu as gagné ! 10,00 USD Crédit sur StockX Code promo : 10BF26EXAMPLE1 storeCredit10";

function row(partial: Partial<PromoCode> & Pick<PromoCode, "code" | "account" | "emailDate">): PromoCode {
  return {
    subject: partial.subject ?? "promo",
    expires: partial.expires ?? null,
    status: partial.status ?? "unused",
    lastTriedAt: partial.lastTriedAt ?? null,
    rejectReason: partial.rejectReason ?? null,
    holdUntil: partial.holdUntil ?? null,
    ...partial,
  };
}

describe("promosFromMail", () => {
  it("parses an anonymized StockX promo mail", () => {
    const found = promosFromMail({
      subject: "et voici ta récompense de Black Friday... 10,00 USD de crédit sur StockX !",
      body: ANON_PROMO_MAIL,
      recipients: ["buyer@example.com"],
      emailDate: "2026-11-26T01:21:41.000Z",
    });
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      code: "10BF26EXAMPLE1",
      account: "shopify",
      expires: null,
      status: "unused",
    });
  });

  it("marks a code already printed on an order receipt as used", () => {
    const found = promosFromMail({
      subject: "Commande livrée : Example Shoe",
      body: "Numéro de commande : 03-EXAMPLE123 Prix d'achat : CHF74.16 Livraison : CHF20.00 5BF25EXAMPLE1: -CHF4.02 Prix total à payer CHF95.73",
      recipients: ["buyer@example.com"],
      emailDate: "2025-12-08T11:38:40.000Z",
    });
    expect(found).toEqual([
      expect.objectContaining({ code: "5BF25EXAMPLE1", status: "used", rejectReason: "seen on order receipt" }),
    ]);
  });

  it("assigns contact@ to the Galaxus account and ignores a bare OTP", () => {
    const promo = promosFromMail({
      subject: "10% off — use code GALAXUS15",
      body: "Use code GALAXUS15 at checkout. Valid until 2026-12-01.",
      recipients: ["reselllausanne@gmail.com", "contact@resell-lausanne.ch"],
      emailDate: "2026-10-01T00:00:00.000Z",
    });
    expect(promo[0]?.account).toBe("galaxus");
    expect(promo[0]?.code).toBe("GALAXUS15");
    expect(promo[0]?.expires).toBe("2026-12-01");

    const otp = promosFromMail({
      subject: "482913 – Votre code de connexion StockX",
      body: "Votre code de connexion est 482913. Il expire dans 10 minutes.",
      recipients: ["contact@resell-lausanne.ch"],
      emailDate: "2026-11-01T00:00:00.000Z",
    });
    expect(otp).toEqual([]);
    expect(accountForRecipients(["contact@resell-lausanne.ch"])).toBe("galaxus");
    expect(accountForRecipients(["buyer@example.com"])).toBe("shopify");
  });
});

describe("pickNextPromo", () => {
  const now = Date.parse("2026-11-27T10:00:00.000Z");
  const codes = [
    row({ code: "NEW", account: "shopify", emailDate: "2026-11-20T00:00:00.000Z" }),
    row({ code: "OLD", account: "shopify", emailDate: "2026-09-01T00:00:00.000Z" }),
    row({ code: "USED", account: "shopify", emailDate: "2026-01-01T00:00:00.000Z", status: "used" }),
    row({ code: "DEAD", account: "shopify", emailDate: "2026-01-02T00:00:00.000Z", status: "rejected" }),
    row({ code: "HELD", account: "shopify", emailDate: "2026-08-01T00:00:00.000Z", holdUntil: "2026-11-27T10:05:00.000Z" }),
    row({ code: "STALE", account: "shopify", emailDate: "2026-07-01T00:00:00.000Z", expires: "2026-11-01" }),
    row({ code: "GAL", account: "galaxus", emailDate: "2026-06-01T00:00:00.000Z" }),
  ];

  it("picks the oldest unused code for that account, skipping year-old credits when a recent one exists", () => {
    expect(pickNextPromo(codes, "shopify", now)?.code).toBe("OLD");
    expect(pickNextPromo(codes, "galaxus", now)?.code).toBe("GAL");
    const withStale = [
      ...codes,
      row({ code: "BF25", account: "shopify", emailDate: "2025-11-28T08:11:47.000Z" }),
    ];
    expect(pickNextPromo(withStale, "shopify", now)?.code).toBe("OLD");
  });

  it("keeps a rejected status when the scanner sees the same code again", () => {
    const merged = mergePromoCodes(codes, [
      row({
        code: "dead",
        account: "shopify",
        emailDate: "2026-01-02T00:00:00.000Z",
        status: "unused",
        subject: "again",
      }),
    ]);
    expect(merged.find((code) => code.code.toUpperCase() === "DEAD")?.status).toBe("rejected");
  });
});

describe("promo refusal is not a card decline", () => {
  const samples = [
    "This discount code is invalid",
    "This discount code has already been used",
    "Ce code promo est invalide",
    "Ce code promo a expiré",
    "Code promo déjà utilisé",
    "Minimum order of CHF 200 for this promo code",
  ];

  it("detects FR+EN refusals and does not trip payment_declined or the 20-attempt cap", () => {
    for (const sample of samples) {
      expect(promoApplyOutcome({ before: 180, after: 180, body: sample })).toBe("rejected");
      expect(isCardDeclined(sample)).toBe(false);
      expect(isPaymentRefused(sample)).toBe(false);
      expect(failureClass("bot_fail", sample)).toBeNull();
    }
    const card = "There was an error with your payment method. Please enter a new payment method and try again.";
    expect(isCardDeclined(card)).toBe(true);
    expect(failureClass("payment_declined", card)).toBeNull();
    expect(failureClass("size_grid", "size grid shown")).toBe("size_grid");
  });

  it("treats a lower total as applied, once", () => {
    expect(promoApplyOutcome({ before: 210, after: 189, body: "Total CHF 189.00" })).toBe("applied");
    expect(promoApplyOutcome({ before: 210, after: 210, body: "Total CHF 210.00" })).toBe("unchanged");
    expect(lastCheckoutTotalChf("Subtotal CHF 210.00\nTotal CHF 189.00")).toBe(189);
  });
});

describe("promo file", () => {
  it("claims one code, rejects it, and does not let a rescan reset status", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "stx-promo-"));
    const file = path.join(dir, "stockx-promo-codes.json");
    const incoming = [
      row({ code: "OLD", account: "shopify", emailDate: "2026-09-01T00:00:00.000Z", subject: "older" }),
      row({ code: "NEW", account: "shopify", emailDate: "2026-11-01T00:00:00.000Z", subject: "newer" }),
    ];
    await mergeScannedPromos(incoming, file);
    const first = await claimNextPromo("shopify", Date.parse("2026-11-27T10:00:00.000Z"), file);
    expect(first?.code).toBe("OLD");
    const second = await claimNextPromo("shopify", Date.parse("2026-11-27T10:00:01.000Z"), file);
    expect(second?.code).toBe("NEW");
    await markPromoRejected("OLD", "This discount code is invalid", file);
    await releasePromoHold("NEW", file);
    await mergeScannedPromos(
      [row({ code: "OLD", account: "shopify", emailDate: "2026-09-01T00:00:00.000Z", status: "unused" })],
      file
    );
    const raw = JSON.parse(await fs.readFile(file, "utf8")) as { codes: PromoCode[] };
    expect(raw.codes.find((code) => code.code === "OLD")?.status).toBe("rejected");
    expect(raw.codes.find((code) => code.code === "NEW")?.status).toBe("unused");
    await markPromoUsed("NEW", file);
    const after = JSON.parse(await fs.readFile(file, "utf8")) as { codes: PromoCode[] };
    expect(after.codes.find((code) => code.code === "NEW")?.status).toBe("used");
    expect(await claimNextPromo("shopify", Date.parse("2026-11-27T11:00:00.000Z"), file)).toBeNull();
  });
});
