import { afterEach, describe, expect, it } from "vitest";
import { resolveShopifyReturnFrankingLicense } from "../label";

const ORIGINAL_ENV = {
  SWISS_POST_RETURN_FRANKING_LICENSE: process.env.SWISS_POST_RETURN_FRANKING_LICENSE,
  SWISS_POST_FRANKING_LICENSE: process.env.SWISS_POST_FRANKING_LICENSE,
};

afterEach(() => {
  process.env.SWISS_POST_RETURN_FRANKING_LICENSE = ORIGINAL_ENV.SWISS_POST_RETURN_FRANKING_LICENSE;
  process.env.SWISS_POST_FRANKING_LICENSE = ORIGINAL_ENV.SWISS_POST_FRANKING_LICENSE;
});

describe("resolveShopifyReturnFrankingLicense", () => {
  it("uses explicit override first", () => {
    process.env.SWISS_POST_RETURN_FRANKING_LICENSE = "RET-123";
    process.env.SWISS_POST_FRANKING_LICENSE = "BASE-123";
    expect(resolveShopifyReturnFrankingLicense("OVERRIDE-123")).toBe("OVERRIDE-123");
  });

  it("uses SWISS_POST_RETURN_FRANKING_LICENSE before default", () => {
    process.env.SWISS_POST_RETURN_FRANKING_LICENSE = "RET-123";
    process.env.SWISS_POST_FRANKING_LICENSE = "BASE-123";
    expect(resolveShopifyReturnFrankingLicense()).toBe("RET-123");
  });

  it("falls back to SWISS_POST_FRANKING_LICENSE", () => {
    process.env.SWISS_POST_RETURN_FRANKING_LICENSE = "";
    process.env.SWISS_POST_FRANKING_LICENSE = "BASE-123";
    expect(resolveShopifyReturnFrankingLicense()).toBe("BASE-123");
  });
});
