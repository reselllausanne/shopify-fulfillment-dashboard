import { describe, expect, it } from "vitest";
import { recoverStockxOrderNumberFromBuyingListText } from "@/lib/stockxAutoCheckout/recoverOrderNumberFromBuyingList";

const SAMPLE = `
Article
Numéro de commande
Date d'achat
Prix
Statut
Nike Air Max Command Noir
Black
Taille: EU 42.5
03-B0ST0FTNGK
29/10/26
104,00 CHF
Commande confirmée
Converse Run Star Hike Ox Noir Blanc Gomme
Black White Gum
Taille: EU 39
03-NTVJ6JASDM
29/10/26
87,00 CHF
Commande confirmée
Converse Run Star Hike Ox Noir Blanc Gomme
Black White Gum
Taille: EU 39
03-0918RMEKEK
29/10/26
86,00 CHF
Commande confirmée
Nike Zoom Vomero 5 Celestial Doré
Celestial Gold
Taille: EU 42.5
03-MQWDNTXS9Q
29/10/26
101,00 CHF
`;

describe("recoverStockxOrderNumberFromBuyingListText", () => {
  it("empty body → null", () => {
    expect(recoverStockxOrderNumberFromBuyingListText("", { sizeEU: "39" })).toBeNull();
  });

  it("matches Converse EU 39 + title (newest first)", () => {
    const hit = recoverStockxOrderNumberFromBuyingListText(SAMPLE, {
      sizeEU: "39",
      productName: "Converse Run Star Hike Ox (39)",
    });
    expect(hit?.orderNumber).toBe("03-NTVJ6JASDM");
  });

  it("prefers CHF proximity when two same size/title", () => {
    const hit = recoverStockxOrderNumberFromBuyingListText(SAMPLE, {
      sizeEU: "39",
      productName: "Converse Run Star Hike Ox",
      totalChf: 86,
      totalToleranceChf: 1,
    });
    expect(hit?.orderNumber).toBe("03-0918RMEKEK");
  });

  it("matches Command 42.5", () => {
    const hit = recoverStockxOrderNumberFromBuyingListText(SAMPLE, {
      sizeEU: "42.5",
      productName: "Nike Air Max Command (42.5)",
      totalChf: 104,
    });
    expect(hit?.orderNumber).toBe("03-B0ST0FTNGK");
  });

  it("rejects unrelated product", () => {
    const hit = recoverStockxOrderNumberFromBuyingListText(SAMPLE, {
      sizeEU: "46",
      productName: "Adidas Ultraboost Running White",
    });
    expect(hit).toBeNull();
  });
});
