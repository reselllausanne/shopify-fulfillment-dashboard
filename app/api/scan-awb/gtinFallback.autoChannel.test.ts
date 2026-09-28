import { describe, expect, it } from "vitest";
import { decideGtinAutoChannel } from "./gtinFallback";

describe("decideGtinAutoChannel", () => {
  it("passes through direct when only direct is open", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 1,
        openWarehouse: 0,
        autoRowChannel: "galaxus_direct",
      })
    ).toEqual({ autoChannel: "galaxus_direct", requiresChannelChoice: false });
  });

  it("blocks auto when warehouse AND direct both open for same GTIN", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 1,
        openWarehouse: 1,
        autoRowChannel: "galaxus_direct",
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: true });
  });

  it("still blocks auto even if shopify would have won", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 2,
        openWarehouse: 1,
        autoRowChannel: "shopify",
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: true });
  });

  it("allows shopify when no warehouse conflict", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 0,
        openWarehouse: 0,
        autoRowChannel: "shopify",
      })
    ).toEqual({ autoChannel: "shopify", requiresChannelChoice: false });
  });

  it("returns null channel when warehouse-only (packing handles it)", () => {
    expect(
      decideGtinAutoChannel({
        openDirect: 0,
        openWarehouse: 2,
        autoRowChannel: null,
      })
    ).toEqual({ autoChannel: null, requiresChannelChoice: false });
  });
});
