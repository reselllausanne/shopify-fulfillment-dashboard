import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    kickDBProduct: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@/app/lib/prisma";
import {
  kickdbProductIdFromShopifySku,
  resolveKickdbIdentityFromSku,
  resolvePostSaleProductIdentifier,
} from "@/shopify/orders/saleIdentity";

const mockedFindFirst = prisma.kickDBProduct.findFirst as unknown as ReturnType<typeof vi.fn>;

describe("kickdbProductIdFromShopifySku", () => {
  it("strips -OS from KickDB uuid SKU", () => {
    expect(
      kickdbProductIdFromShopifySku("7cd77591-15ee-470a-aaf8-46fd17b89763-OS")
    ).toBe("7cd77591-15ee-470a-aaf8-46fd17b89763");
  });

  it("strips numeric size suffix", () => {
    expect(
      kickdbProductIdFromShopifySku("7cd77591-15ee-470a-aaf8-46fd17b89763-42")
    ).toBe("7cd77591-15ee-470a-aaf8-46fd17b89763");
  });

  it("returns null for style SKUs", () => {
    expect(kickdbProductIdFromShopifySku("735145 KAAAD 8358")).toBeNull();
    expect(kickdbProductIdFromShopifySku("DQ3977-100-40")).toBeNull();
  });
});

describe("resolveKickdbIdentityFromSku", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
  });

  it("loads urlKey + styleId from KickDB", async () => {
    mockedFindFirst.mockResolvedValue({
      kickdbProductId: "7cd77591-15ee-470a-aaf8-46fd17b89763",
      urlKey: "gucci-ophidia-handbag-small-gg-supreme-beige-ebony",
      styleId: "735145 KAAAD 8358",
    });
    const id = await resolveKickdbIdentityFromSku(
      "7cd77591-15ee-470a-aaf8-46fd17b89763-OS"
    );
    expect(id.urlKey).toBe("gucci-ophidia-handbag-small-gg-supreme-beige-ebony");
    expect(id.styleId).toBe("735145 KAAAD 8358");
  });
});

describe("resolvePostSaleProductIdentifier", () => {
  beforeEach(() => {
    mockedFindFirst.mockReset();
  });

  it("prefers GTIN when present", async () => {
    const r = await resolvePostSaleProductIdentifier({
      gtin: "0196021206798",
      sku: "7cd77591-15ee-470a-aaf8-46fd17b89763-OS",
    });
    expect(r).toEqual({ identifier: "0196021206798", source: "gtin" });
    expect(mockedFindFirst).not.toHaveBeenCalled();
  });

  it("falls back to KickDB urlKey when no GTIN", async () => {
    mockedFindFirst.mockResolvedValue({
      kickdbProductId: "7cd77591-15ee-470a-aaf8-46fd17b89763",
      urlKey: "gucci-ophidia-handbag-small-gg-supreme-beige-ebony",
      styleId: "735145 KAAAD 8358",
    });
    const r = await resolvePostSaleProductIdentifier({
      gtin: null,
      sku: "7cd77591-15ee-470a-aaf8-46fd17b89763-OS",
    });
    expect(r.source).toBe("urlKey");
    expect(r.identifier).toBe("gucci-ophidia-handbag-small-gg-supreme-beige-ebony");
  });
});
