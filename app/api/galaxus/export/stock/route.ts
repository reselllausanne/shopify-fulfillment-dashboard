import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function hasSupplierImage(images: unknown): boolean {
  if (!Array.isArray(images)) return false;
  return images.some((value) => typeof value === "string" && value.length > 0 && isAbsoluteUrl(value));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const headers = [
    "ProviderKey",
    "QuantityOnStock",
    "RestockTime",
    "RestockDate",
    "MinimumOrderQuantity",
    "OrderQuantitySteps",
    "TradeUnit",
    "LogisticUnit",
    "WarehouseCountry",
    "DirectDeliverySupported",
  ];

  const rows: ExportRow[] = [];
  const seenGtins = new Set<string>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;

  do {
    const mappings = await prisma.variantMapping.findMany({
      where: {
        status: "MATCHED",
        gtin: { not: null },
        ...whereSupplier,
      },
      include: {
        supplierVariant: true,
      },
      orderBy: { updatedAt: "desc" },
      take: pageSize,
      skip: currentOffset,
    });
    lastBatch = mappings.length;

    mappings.forEach((mapping) => {
      const gtin = mapping.gtin ?? "";
      if (gtin && seenGtins.has(gtin)) return;
      if (gtin) seenGtins.add(gtin);
      const supplierVariant = mapping.supplierVariant;
      const supplierVariantAny = supplierVariant as any;
      if (!supplierVariantAny?.supplierProductName || !hasSupplierImage(supplierVariantAny?.images)) {
        return;
      }
      const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
      const stock = supplierVariant?.stock ?? 0;

      rows.push({
        ProviderKey: providerKey,
        QuantityOnStock: stock.toString(),
        RestockTime: "",
        RestockDate: "",
        MinimumOrderQuantity: "1",
        OrderQuantitySteps: "1",
        TradeUnit: "",
        LogisticUnit: "",
        WarehouseCountry: "Poland",
        DirectDeliverySupported: "no",
      });
    });

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const csv = toCsv(headers, rows);
  const filename = `galaxus-stock-${supplier ?? "all"}-${Date.now()}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": rows.length.toString(),
      "X-Offset": offset.toString(),
    },
  });
}
