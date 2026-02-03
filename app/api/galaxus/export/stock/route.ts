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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

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
    take: limit,
    skip: offset,
  });

  const headers = [
    "ProviderKey",
    "PurchasePriceExclVat",
    "PurchasePriceExclVatAndFee",
    "QuantityOnStock",
  ];

  const rows: ExportRow[] = mappings.map((mapping) => {
    const supplierVariant = mapping.supplierVariant;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
    const price = decimalToString(supplierVariant?.price ?? "");
    const stock = supplierVariant?.stock ?? 0;

    return {
      ProviderKey: providerKey,
      PurchasePriceExclVat: price,
      PurchasePriceExclVatAndFee: price,
      QuantityOnStock: stock.toString(),
    };
  });

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
