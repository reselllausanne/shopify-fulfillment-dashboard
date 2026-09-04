import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

describe("findBlockedDirectDeliveryRoute", () => {
  let storeDir = "";
  let storePath = "";

  beforeEach(() => {
    storeDir = path.join(os.tmpdir(), `scan-direct-guard-${Date.now()}-${Math.random().toString(16).slice(2)}`);
    storePath = path.join(storeDir, "routes.json");
    process.env.STOCKX_INBOUND_HOME_ROUTES_PATH = storePath;
    vi.resetModules();
  });

  afterEach(async () => {
    delete process.env.STOCKX_INBOUND_HOME_ROUTES_PATH;
    vi.resetModules();
    await fs.rm(storeDir, { recursive: true, force: true });
  });

  it("blocks by inbound AWB route", async () => {
    const { upsertStockxInboundHomeRoute } = await import("@/app/lib/stockxInboundHomeRoutes");
    const { findBlockedDirectDeliveryRoute } = await import("./directDeliveryGuard");

    await upsertStockxInboundHomeRoute({
      stockxOrderNumber: "03-ABCD",
      stockxAwb: "1ZR1H0146710944652",
      shopifyOrderName: "#1001",
    });

    const blocked = await findBlockedDirectDeliveryRoute({
      awb: "1Z R1H 014 6710 9446 52",
      gtinFulfill: false,
    });

    expect(blocked?.stockxOrderNumber).toBe("03-ABCD");
  });

  it("blocks GTIN fulfill by Shopify order name route", async () => {
    const { upsertStockxInboundHomeRoute } = await import("@/app/lib/stockxInboundHomeRoutes");
    const { findBlockedDirectDeliveryRoute } = await import("./directDeliveryGuard");

    await upsertStockxInboundHomeRoute({
      stockxOrderNumber: "03-EFGH",
      shopifyOrderName: "#2002",
    });

    const blocked = await findBlockedDirectDeliveryRoute({
      awb: "7612345678901",
      shopifyOrderName: "#2002",
      gtinFulfill: true,
    });

    expect(blocked?.shopifyOrderName).toBe("#2002");
  });

  it("allows non direct-delivery scans", async () => {
    const { findBlockedDirectDeliveryRoute } = await import("./directDeliveryGuard");

    const blocked = await findBlockedDirectDeliveryRoute({
      awb: "1ZUNRELATED12345678",
      shopifyOrderName: "#9999",
      gtinFulfill: false,
    });

    expect(blocked).toBeNull();
  });
});
