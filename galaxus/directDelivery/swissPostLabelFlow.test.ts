import { describe, expect, it } from "vitest";
import {
  extractSwissPostLabelErrors,
  extractSwissPostTracking,
} from "@/galaxus/directDelivery/swissPostLabelParse";

describe("extractSwissPostLabelErrors", () => {
  it("reads validation errors from Swiss Post 200 responses", () => {
    const errors = extractSwissPostLabelErrors({
      item: {
        itemID: "x",
        errors: [{ code: "E2042", message: "Invalid phone" }],
        label: [null],
      },
    });
    expect(errors).toEqual(["E2042: Invalid phone"]);
  });
});

describe("extractSwissPostTracking", () => {
  it("reads identCode from item", () => {
    expect(
      extractSwissPostTracking({
        item: { identCode: "996015781700005895", label: [{ content: "abc" }] },
      })
    ).toBe("996015781700005895");
  });

  it("returns null when Post only returned validation errors", () => {
    expect(
      extractSwissPostTracking({
        item: {
          itemID: "x",
          errors: [{ code: "E2042", message: "Invalid phone" }],
          label: [null],
        },
      })
    ).toBeNull();
  });
});
