import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/app/lib/prisma", () => ({
  prisma: {
    kickDBProduct: {
      upsert: vi.fn().mockResolvedValue({ id: "kdb-product-1" }),
    },
    kickDBVariant: {
      upsert: vi.fn().mockImplementation(({ where }: any) =>
        Promise.resolve({ id: `kdbvar-${where.kickdbVariantId}` })
      ),
    },
  },
}));

vi.mock("@/galaxus/jobs/bulkSql", () => ({
  bulkInsertSupplierVariants: vi.fn().mockResolvedValue(0),
  bulkUpdateSupplierVariants: vi.fn().mockResolvedValue(0),
  bulkUpsertVariantMappings: vi.fn().mockResolvedValue({ inserted: 0, updated: 0 }),
  remapRowsToExistingProviderKeyGtin: vi
    .fn()
    .mockImplementation((rows: unknown[]) => Promise.resolve({ rows, remapped: 0 })),
}));

vi.mock("@/galaxus/kickdb/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/galaxus/kickdb/client")>();
  return {
    ...actual,
    fetchStockxProductByIdOrSlugRaw: vi.fn(),
  };
});

vi.mock("@/galaxus/stx/variantPriceLanes", () => ({
  allowsStxStandardImport: vi.fn().mockReturnValue(false),
  buildStxDualPriceFields: vi.fn().mockReturnValue({
    price: 110,
    stock: 5,
    deliveryType: "express_standard",
    suggestedRetailPriceInclVat: 219,
    standardBuyPrice: 100,
    expressBuyPrice: 110,
    standardSuggestedRetailPriceInclVat: 209,
  }),
}));

import { fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import {
  bulkInsertSupplierVariants,
  bulkUpsertVariantMappings,
} from "@/galaxus/jobs/bulkSql";
import { importStxProductByInput } from "@/galaxus/stx/importProduct";

const mockedFetch = fetchStockxProductByIdOrSlugRaw as unknown as ReturnType<typeof vi.fn>;
const mockedInsert = bulkInsertSupplierVariants as unknown as ReturnType<typeof vi.fn>;
const mockedMappings = bulkUpsertVariantMappings as unknown as ReturnType<typeof vi.fn>;

const SCANNED_GTIN = "4550330121471";

/** Onitsuka class: KickDB product where NO variant carries a GTIN. */
function onitsukaLikeProduct() {
  return {
    product: {
      id: "kickdb-prod-onitsuka",
      slug: "onitsuka-tiger-mexico-66-yellow",
      sku: "1183A872-752",
      title: "Onitsuka Tiger Mexico 66 Yellow",
      brand: "Onitsuka Tiger",
      image: "https://img.example/mexico66.jpg",
      gallery: ["https://img.example/mexico66.jpg"],
      market: "CH",
      variants: [
        { id: "v36", size_eu: "36", size_us: "5.5" },
        { id: "v375", size_eu: "37.5", size_us: "6.5" },
        { id: "v38", size_eu: "38", size_us: "7" },
      ],
    },
  };
}

describe("importStxProductByInput — no-GTIN KickDB sizes (Onitsuka class)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedFetch.mockResolvedValue(onitsukaLikeProduct());
  });

  it("keeps all sizes without KickDB GTIN as PENDING_GTIN rows", async () => {
    const result = await importStxProductByInput("onitsuka-tiger-mexico-66-yellow", {
      forceImport: true,
    });

    expect(result.ok).toBe(true);
    expect(result.importedVariantsCount).toBe(3);
    expect(result.diagnostics.skipReasons.invalidGtin).toBe(0);

    const rows = mockedInsert.mock.calls[0]![0] as Array<{
      supplierVariantId: string;
      gtin: string | null;
      providerKey: string | null;
    }>;
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row.gtin).toBeNull();
      expect(row.providerKey).toBeNull();
    }

    const mappingRows = mockedMappings.mock.calls[0]![0] as Array<{
      supplierVariantId: string;
      status: string;
    }>;
    expect(mappingRows.map((r) => r.status)).toEqual([
      "PENDING_GTIN",
      "PENDING_GTIN",
      "PENDING_GTIN",
    ]);
  });

  it("stamps the scanned GTIN on the size matching attachSizeEu only", async () => {
    const result = await importStxProductByInput("onitsuka-tiger-mexico-66-yellow", {
      forceImport: true,
      targetGtin: SCANNED_GTIN,
      attachGtin: SCANNED_GTIN,
      attachSizeEu: "37.5",
    });

    expect(result.ok).toBe(true);
    expect(result.importedVariantsCount).toBe(3);

    const rows = mockedInsert.mock.calls[0]![0] as Array<{
      supplierVariantId: string;
      gtin: string | null;
      providerKey: string | null;
    }>;
    const stamped = rows.find((r) => r.supplierVariantId === "stx_v375");
    expect(stamped?.gtin).toBe(SCANNED_GTIN);
    expect(stamped?.providerKey).toBe(`STX_${SCANNED_GTIN}`);

    for (const other of rows.filter((r) => r.supplierVariantId !== "stx_v375")) {
      expect(other.gtin).toBeNull();
      expect(other.providerKey).toBeNull();
    }

    const mappingRows = mockedMappings.mock.calls[0]![0] as Array<{
      supplierVariantId: string;
      status: string;
      gtin: string | null;
    }>;
    const stampedMapping = mappingRows.find((r) => r.supplierVariantId === "stx_v375");
    expect(stampedMapping?.status).toBe("SUPPLIER_GTIN");
    expect(stampedMapping?.gtin).toBe(SCANNED_GTIN);
    expect(
      mappingRows
        .filter((r) => r.supplierVariantId !== "stx_v375")
        .every((r) => r.status === "PENDING_GTIN")
    ).toBe(true);
  });

  it("does not stamp the scanned GTIN when no size matches attachSizeEu", async () => {
    await importStxProductByInput("onitsuka-tiger-mexico-66-yellow", {
      forceImport: true,
      attachGtin: SCANNED_GTIN,
      attachSizeEu: "45",
    });

    const rows = mockedInsert.mock.calls[0]![0] as Array<{ gtin: string | null }>;
    expect(rows.every((r) => r.gtin === null)).toBe(true);
  });
});
