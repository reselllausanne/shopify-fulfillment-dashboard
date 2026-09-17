import { describe, expect, it } from "vitest";
import { normalizeSwissPostRecipientPhone } from "@/lib/swissPost";

describe("normalizeSwissPostRecipientPhone", () => {
  it("normalizes Galaxus CH mobile stored without + or leading 0", () => {
    expect(normalizeSwissPostRecipientPhone("41323133511", "CH")).toBe("+41323133511");
  });

  it("normalizes Swiss local numbers with leading 0", () => {
    expect(normalizeSwissPostRecipientPhone("0323133511", "CH")).toBe("+41323133511");
  });

  it("keeps valid E164 numbers", () => {
    expect(normalizeSwissPostRecipientPhone("+41323133511", "CH")).toBe("+41323133511");
  });

  it("returns null for empty input", () => {
    expect(normalizeSwissPostRecipientPhone("", "CH")).toBeNull();
  });
});
