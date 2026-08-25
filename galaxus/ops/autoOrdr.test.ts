import { describe, expect, it } from "vitest";
import {
  assertOrdrUploaded,
  hasConfirmedOrdr,
  isValidOrdrMode,
  orderNeedsAutoOrdr,
} from "./autoOrdr";

describe("auto ORDR reconcile", () => {
  it("accepts only spec modes", () => {
    expect(isValidOrdrMode("WITHOUT_POSITIONS")).toBe(true);
    expect(isValidOrdrMode("WITH_ARRIVAL_DATES")).toBe(true);
    expect(isValidOrdrMode(null)).toBe(false);
    expect(isValidOrdrMode("")).toBe(false);
  });

  it("treats SENT without ordrMode as unconfirmed (old XML)", () => {
    expect(
      orderNeedsAutoOrdr({
        ordrSentAt: new Date(),
        ordrStatus: "SENT",
        ordrMode: null,
      })
    ).toBe(true);
    expect(
      hasConfirmedOrdr({
        ordrSentAt: new Date(),
        ordrStatus: "SENT",
        ordrMode: "WITHOUT_POSITIONS",
      })
    ).toBe(true);
  });

  it("retries FAILED / PENDING / missing sentAt", () => {
    expect(orderNeedsAutoOrdr({ ordrStatus: "FAILED" })).toBe(true);
    expect(orderNeedsAutoOrdr({ ordrStatus: "PENDING" })).toBe(true);
    expect(orderNeedsAutoOrdr({ ordrStatus: "SENT", ordrSentAt: null, ordrMode: "WITHOUT_POSITIONS" })).toBe(
      true
    );
  });

  it("skips cancelled", () => {
    expect(orderNeedsAutoOrdr({ cancelledAt: new Date(), ordrStatus: "PENDING" })).toBe(false);
  });

  it("fails when upload did not succeed", () => {
    expect(() => assertOrdrUploaded([{ docType: "ORDR", status: "error", message: "SFTP" }])).toThrow(
      "SFTP"
    );
    expect(() => assertOrdrUploaded([])).toThrow("ORDR not returned");
    expect(() => assertOrdrUploaded([{ docType: "ORDR", status: "uploaded" }])).not.toThrow();
  });
});
