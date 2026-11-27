import { describe, expect, it } from "vitest";
import { decideRefundRelease, parseStockxRefundMail, type RefundLink } from "@/lib/stockxBuyer/refundMail";

const mind: RefundLink = {
  source: "galaxus",
  orderRef: "210422089",
  product: "Nike Mind 001 Mineral Slate Light Pumice Hyper Crimson Metallic Platinum (47.5)",
  size: "47.5",
  stockxOrderNumber: "03-WPN3H3QYRR",
  stockxStatus: "ORDERED",
  manual: false,
};

describe("refund and cancel mails", () => {
  it("parses the French refund subject with product, and an order number in the body", () => {
    const mail = parseStockxRefundMail({
      subject: "Remboursement effectué : Nike Mind 001 Mineral Slate Light Pumice Hyper Crimson Metallic Platinum",
      body: "Commande 03-WPN3H3QYRR remboursée.",
    });
    expect(mail).toMatchObject({
      kind: "refund",
      product: "Nike Mind 001 Mineral Slate Light Pumice Hyper Crimson Metallic Platinum",
      stockxOrderNumber: "03-WPN3H3QYRR",
    });
  });

  it("parses FR cancel and EN refund / cancel subjects", () => {
    expect(parseStockxRefundMail({ subject: "Votre commande a été annulée : Nike Run Swift 2 (47.5)" })?.kind).toBe("cancel");
    expect(parseStockxRefundMail({ subject: "Votre commande a été annulée : Nike Run Swift 2 (47.5)" })?.size).toBe("47.5");
    expect(parseStockxRefundMail({ subject: "Order canceled: Nike Pegasus" })?.kind).toBe("cancel");
    expect(parseStockxRefundMail({ subject: "Refund issued: Ugg Classic" })?.kind).toBe("refund");
    expect(parseStockxRefundMail({ subject: "Your order has shipped" })).toBeNull();
  });

  it("releases the linked number and does not touch a different active buy", () => {
    const active: RefundLink = { ...mind, stockxOrderNumber: "03-NEWLIVE", stockxStatus: "ORDERED" };
    const mail = parseStockxRefundMail({
      subject: "Remboursement effectué : Nike Mind 001",
      body: "03-WPN3H3QYRR",
    })!;
    expect(decideRefundRelease(mail, [mind, active]).link?.stockxOrderNumber).toBe("03-WPN3H3QYRR");
    expect(decideRefundRelease(mail, [active])).toMatchObject({ release: false, reason: "order_not_linked" });
  });

  it("does not release a manual checkout", () => {
    const mail = parseStockxRefundMail({ subject: "Order canceled", body: "03-WPN3H3QYRR" })!;
    expect(decideRefundRelease(mail, [{ ...mind, manual: true }])).toMatchObject({ release: false, reason: "manual" });
  });

  it("matches a single product when the mail has no order number", () => {
    const mail = parseStockxRefundMail({
      subject: "Remboursement effectué : Nike Run Swift 2 Running (47.5)",
    })!;
    const swift: RefundLink = {
      ...mind,
      orderRef: "209037228",
      product: "Nike Run Swift 2 Running (47.5)",
      size: "47.5",
      stockxOrderNumber: "03-RF8YGEDUC3",
    };
    expect(decideRefundRelease(mail, [mind, swift]).link?.orderRef).toBe("209037228");
    const colorway = parseStockxRefundMail({
      subject: "Order canceled: Nike Run Swift 2 Black Dark Smoke Grey",
    })!;
    expect(decideRefundRelease(colorway, [mind, swift]).link?.stockxOrderNumber).toBe("03-RF8YGEDUC3");
    expect(decideRefundRelease(mail, [swift, { ...swift, orderRef: "x", stockxOrderNumber: "03-OTHER" }]).reason).toBe(
      "ambiguous_product"
    );
  });
});
