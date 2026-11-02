import { afterEach, describe, expect, it } from "vitest";
import {
  customerDelayMailMaxPerRun,
  customerDelayMailToOverride,
  isAutoRebuyOnCancelEnabled,
  isCustomerDelayMailEnabled,
} from "@/lib/stockxDelayRebuy/flags";

const KEYS = [
  "STOCKX_CUSTOMER_DELAY_MAIL",
  "STOCKX_CUSTOMER_DELAY_MAIL_TO",
  "STOCKX_AUTO_REBUY_ON_CANCEL",
  "STOCKX_CUSTOMER_DELAY_MAIL_MAX",
] as const;

afterEach(() => {
  for (const k of KEYS) delete process.env[k];
});

describe("stockxDelayRebuy flags", () => {
  it("defaults carefully OFF", () => {
    expect(isCustomerDelayMailEnabled()).toBe(false);
    expect(isAutoRebuyOnCancelEnabled()).toBe(false);
    expect(customerDelayMailToOverride()).toBeNull();
    expect(customerDelayMailMaxPerRun()).toBe(5);
  });

  it("accepts 1/true/yes/on", () => {
    process.env.STOCKX_CUSTOMER_DELAY_MAIL = "1";
    process.env.STOCKX_AUTO_REBUY_ON_CANCEL = "true";
    expect(isCustomerDelayMailEnabled()).toBe(true);
    expect(isAutoRebuyOnCancelEnabled()).toBe(true);
  });

  it("reads TO override + max clamp", () => {
    process.env.STOCKX_CUSTOMER_DELAY_MAIL_TO = " ops@example.com ";
    process.env.STOCKX_CUSTOMER_DELAY_MAIL_MAX = "99";
    expect(customerDelayMailToOverride()).toBe("ops@example.com");
    expect(customerDelayMailMaxPerRun()).toBe(20);
  });
});
