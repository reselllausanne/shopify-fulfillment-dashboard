import { describe, expect, it } from "vitest";
import { buildUploadClickConversionsUrl } from "./conversionUploads";
import type { AdsConfig } from "@/adsanalytics/config";

const cfg = {
  developerToken: "x",
  clientId: "x",
  clientSecret: "x",
  refreshToken: "x",
  loginCustomerId: null,
  customerId: "1234567890",
  apiVersion: "v25",
  timezone: "Europe/Zurich",
} satisfies AdsConfig;

describe("conversionUploads", () => {
  it("builds uploadClickConversions URL", () => {
    expect(buildUploadClickConversionsUrl(cfg)).toBe(
      "https://googleads.googleapis.com/v25/customers/1234567890:uploadClickConversions",
    );
  });
});
