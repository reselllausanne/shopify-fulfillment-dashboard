import { describe, expect, it } from "vitest";
import {
  formatSwissPostItemErrors,
  normalizeSwissPostRecipientPhone,
} from "@/lib/swissPost";

describe("normalizeSwissPostRecipientPhone", () => {
  it("normalizes Galaxus-style CH numbers without plus prefix", () => {
    expect(normalizeSwissPostRecipientPhone("41789108855", "CH")).toBe("+41789108855");
    expect(normalizeSwissPostRecipientPhone("41791026233", "CH")).toBe("+41791026233");
  });

  it("keeps already valid E.164 numbers", () => {
    expect(normalizeSwissPostRecipientPhone("+41789108855", "CH")).toBe("+41789108855");
  });

  it("normalizes local 0-prefixed CH numbers", () => {
    expect(normalizeSwissPostRecipientPhone("079108855", "CH")).toBe("+4179108855");
  });
});

describe("formatSwissPostItemErrors", () => {
  it("surfaces Swiss Post validation errors from item.errors", () => {
    const message = formatSwissPostItemErrors({
      item: {
        errors: [{ code: "E2042", message: "Invalid phone number" }],
      },
    });
    expect(message).toBe("E2042: Invalid phone number");
  });
});
