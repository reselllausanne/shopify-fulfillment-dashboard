import { afterEach, describe, expect, it } from "vitest";
import { stockxBlockHeavy, stockxProxyMaxMb } from "@/lib/stockxBandwidthGuard";

const origBlock = process.env.STOCKX_BLOCK_HEAVY;
const origMax = process.env.STOCKX_PROXY_MAX_MB;

afterEach(() => {
  if (origBlock === undefined) delete process.env.STOCKX_BLOCK_HEAVY;
  else process.env.STOCKX_BLOCK_HEAVY = origBlock;
  if (origMax === undefined) delete process.env.STOCKX_PROXY_MAX_MB;
  else process.env.STOCKX_PROXY_MAX_MB = origMax;
});

describe("stockxBlockHeavy", () => {
  it("defaults on", () => {
    delete process.env.STOCKX_BLOCK_HEAVY;
    expect(stockxBlockHeavy()).toBe(true);
  });
  it("off only when explicitly 0", () => {
    process.env.STOCKX_BLOCK_HEAVY = "0";
    expect(stockxBlockHeavy()).toBe(false);
    process.env.STOCKX_BLOCK_HEAVY = "1";
    expect(stockxBlockHeavy()).toBe(true);
  });
});

describe("stockxProxyMaxMb", () => {
  it("defaults 500", () => {
    delete process.env.STOCKX_PROXY_MAX_MB;
    expect(stockxProxyMaxMb()).toBe(500);
  });
  it("parses valid positive numbers", () => {
    process.env.STOCKX_PROXY_MAX_MB = "120";
    expect(stockxProxyMaxMb()).toBe(120);
  });
  it("falls back on garbage / non-positive", () => {
    process.env.STOCKX_PROXY_MAX_MB = "nope";
    expect(stockxProxyMaxMb()).toBe(500);
    process.env.STOCKX_PROXY_MAX_MB = "0";
    expect(stockxProxyMaxMb()).toBe(500);
  });
});
