import { describe, expect, it } from "vitest";
import { kickdbIdFromSupplierSku } from "@/lib/stockxBuyer/shopifyQueue";

describe("kickdbIdFromSupplierSku", () => {
  it("reads the KickDB id in front of a size suffix", () => {
    expect(kickdbIdFromSupplierSku("8739833a-b50a-4d9b-9b2d-14cec236d583-40")).toBe(
      "8739833a-b50a-4d9b-9b2d-14cec236d583"
    );
    expect(kickdbIdFromSupplierSku("a66dcfdf-531f-42a3-aa0e-0913c725a2a8-L")).toBe(
      "a66dcfdf-531f-42a3-aa0e-0913c725a2a8"
    );
  });

  it("ignores a real style id", () => {
    expect(kickdbIdFromSupplierSku("DZ5485-008")).toBeNull();
    expect(kickdbIdFromSupplierSku("")).toBeNull();
  });
});
