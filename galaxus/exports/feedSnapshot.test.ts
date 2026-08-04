import { describe, expect, it } from "vitest";
import {
  parseCsvToRows,
  GALAXUS_STOCK_CSV_HEADERS,
  isFeedSnapshotRebuildRunning,
} from "@/galaxus/exports/feedSnapshot";
import { toCsv } from "@/galaxus/exports/csv";

describe("feedSnapshot", () => {
  it("round-trips CSV rows", () => {
    const rows = [
      {
        ProviderKey: "STX_ABC",
        QuantityOnStock: "1",
        RestockTime: "3",
        RestockDate: "2026-08-10",
        MinimumOrderQuantity: "1",
        OrderQuantitySteps: "1",
        TradeUnit: "",
        LogisticUnit: "",
        WarehouseCountry: "Switzerland",
        DirectDeliverySupported: "1",
      },
    ];
    const csv = toCsv([...GALAXUS_STOCK_CSV_HEADERS], rows);
    const parsed = parseCsvToRows(csv);
    expect(parsed.headers).toEqual([...GALAXUS_STOCK_CSV_HEADERS]);
    expect(parsed.rows).toEqual(rows);
  });

  it("detects running snapshot rebuild job rows", () => {
    const startedAt = new Date(Date.now() - 60_000);
    expect(
      isFeedSnapshotRebuildRunning({
        startedAt,
        finishedAt: startedAt,
      })
    ).toBe(true);
    expect(
      isFeedSnapshotRebuildRunning({
        startedAt,
        finishedAt: new Date(startedAt.getTime() + 1000),
        success: true,
      })
    ).toBe(false);
  });
});
