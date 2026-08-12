import { describe, expect, it } from "vitest";
import {
  LOCATIONS,
  ONLINE_LOCATION,
  moneyKickzLocationId,
} from "@/shopify/inventory/locationConfig";

describe("locationConfig ONLINE_LOCATION", () => {
  it("points at Chemin dropship / Website stock, not Money Kickz", () => {
    expect(ONLINE_LOCATION.id).toBe("gid://shopify/Location/72553660705");
    expect(ONLINE_LOCATION.name).toMatch(/Chemin/i);
    expect(ONLINE_LOCATION.id).not.toBe(moneyKickzLocationId());
  });

  it("keeps Money Kickz in LOCATIONS as a separate online location", () => {
    const mk = LOCATIONS.find((l) => l.id === moneyKickzLocationId());
    expect(mk?.sourceType).toBe("online");
    expect(mk?.id).not.toBe(ONLINE_LOCATION.id);
  });
});
