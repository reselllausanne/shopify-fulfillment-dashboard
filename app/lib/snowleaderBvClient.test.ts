import { describe, expect, it } from "vitest";
import {
  expandBvProduct,
  extractBvGtins,
  normalizeBvGtin,
} from "@/app/lib/snowleaderBvClient";

describe("snowleaderBvClient", () => {
  it("normalizes GTIN14 to GTIN13", () => {
    expect(normalizeBvGtin("07615537598666")).toBe("7615537598666");
    expect(normalizeBvGtin("7615537598666")).toBe("7615537598666");
  });

  it("extracts gtins from EANs and GTIN14 attributes", () => {
    const gtins = extractBvGtins({
      Id: "ON__00907",
      EANs: ["7615537598666", "7615537598635"],
      Attributes: {
        GTIN14: {
          Values: [{ Value: "07615537598604" }],
        },
      },
    });
    expect(gtins).toContain("7615537598666");
    expect(gtins).toContain("7615537598635");
    expect(gtins).toContain("7615537598604");
  });

  it("expands one BV product into one row per gtin", () => {
    const rows = expandBvProduct({
      Id: "ON__00907",
      Name: "Cloudhorizon 2 M Black/Black",
      Brand: { Name: "On Running" },
      CategoryId: "596",
      ImageUrl: "https://images.snowleader.com/test.jpg",
      EANs: ["7615537598666", "7615537598635"],
      Attributes: {
        AVAILABILITY: { Values: [{ Value: "True" }] },
      },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].bvProductId).toBe("ON__00907");
    expect(rows[0].gtin).toBe("7615537598666");
    expect(rows[0].available).toBe(true);
  });
});
