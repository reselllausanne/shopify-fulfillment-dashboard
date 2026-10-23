import { describe, expect, it } from "vitest";
import {
  applyListingAliasToCandidates,
  buildGalaxusListingIdentity,
  pickGalaxusListingProviderKey,
} from "@/galaxus/exports/listingAlias";

describe("pickGalaxusListingProviderKey", () => {
  it("prefers master-snapshot key over current catalog key", () => {
    const key = pickGalaxusListingProviderKey({
      currentProviderKey: "STX_6931571025366",
      clsProviderKeys: ["STX_6931571022945", "STX_6931571025366"],
      masterProviderKeys: new Set(["STX_6931571022945"]),
    });
    expect(key).toBe("STX_6931571022945");
  });

  it("falls back to ghost CLS when current and ghost both exist and master empty", () => {
    const key = pickGalaxusListingProviderKey({
      currentProviderKey: "STX_6931571025366",
      clsProviderKeys: ["STX_6931571022945", "STX_6931571025366"],
      masterProviderKeys: new Set(),
    });
    expect(key).toBe("STX_6931571022945");
  });

  it("uses current when it is the only CLS key", () => {
    const key = pickGalaxusListingProviderKey({
      currentProviderKey: "STX_6931571025366",
      clsProviderKeys: ["STX_6931571025366"],
      masterProviderKeys: new Set(["STX_6931571025366"]),
    });
    expect(key).toBe("STX_6931571025366");
  });
});

describe("applyListingAliasToCandidates", () => {
  it("rewrites ProviderKey to listing alias and marks superseded current key", () => {
    const identities = new Map([
      [
        "stx_ced60fe1-9421-47ec-89bd-5bbc354199f4",
        buildGalaxusListingIdentity({
          supplierVariantId: "stx_ced60fe1-9421-47ec-89bd-5bbc354199f4",
          currentProviderKey: "STX_6931571025366",
          listingProviderKey: "STX_6931571022945",
        })!,
      ],
    ]);
    const { candidates, supersededProviderKeys } = applyListingAliasToCandidates(
      [
        {
          providerKey: "STX_6931571025366",
          variant: { supplierVariantId: "stx_ced60fe1-9421-47ec-89bd-5bbc354199f4" },
        },
      ],
      identities
    );
    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.providerKey).toBe("STX_6931571022945");
    expect(supersededProviderKeys).toEqual(["STX_6931571025366"]);
  });
});
