import { describe, expect, it } from "vitest";
import {
  activeExternalBuysForLine,
  isExternalBuyEligibleLine,
  resolveLineSupplierKey,
  sumExternalBuyCostChf,
} from "@/galaxus/orders/externalBuy";
import { attachProcurementToLines } from "@/galaxus/orders/lineProcurement";

describe("externalBuy helpers", () => {
  it("detects REI eligible lines and rejects STX", () => {
    expect(
      isExternalBuyEligibleLine({ supplierPid: "REI_4018412327116", providerKey: "REI_4018412327116" })
    ).toBe(true);
    expect(resolveLineSupplierKey({ providerKey: "REI_4018412327116" })).toBe("REI");
    expect(
      isExternalBuyEligibleLine({ supplierPid: "STX_197860579422", providerKey: "STX_197860579422" })
    ).toBe(false);
  });

  it("sums active buy costs", () => {
    const buys = [
      {
        id: "1",
        galaxusOrderLineId: "L1",
        unitIndex: 0,
        supplierKey: "REI",
        supplierOrderNumber: "X",
        costAmount: 10.5,
      },
      {
        id: "2",
        galaxusOrderLineId: "L1",
        unitIndex: 1,
        supplierKey: "REI",
        supplierOrderNumber: "X",
        costAmount: 5,
        cancelledAt: new Date(),
      },
    ];
    const active = activeExternalBuysForLine(buys, "L1");
    expect(active).toHaveLength(1);
    expect(sumExternalBuyCostChf(active)).toBe(10.5);
  });
});

describe("attachProcurementToLines external buy", () => {
  it("marks REI line linked with cost from external buy", () => {
    const lines = [
      {
        id: "line-rei",
        orderId: "ord",
        quantity: 2,
        gtin: "4260664814405",
        supplierPid: "REI_4260664814405",
        providerKey: "REI_4260664814405",
        productName: "Gardigo",
        lineNetAmount: 83,
      },
    ];
    const buys = [
      {
        id: "buy1",
        galaxusOrderLineId: "line-rei",
        unitIndex: 0,
        supplierKey: "REI",
        supplierOrderNumber: "REI-CART-1",
        costAmount: 33.82,
        currencyCode: "CHF",
        trackingNumber: null,
        trackingUrl: null,
      },
    ];
    const [row] = attachProcurementToLines(lines, null, [], [], buys);
    expect(row.procurement?.ok).toBe(true);
    expect(row.procurement?.source).toBe("external_buy");
    expect(row.procurement?.stockxOrderNumber).toBe("REI-CART-1");
    expect(row.procurement?.stockxCostChf).toBe(33.82);
    expect(row.procurement?.units?.every((u: { linked: boolean }) => u.linked)).toBe(true);
  });
});
