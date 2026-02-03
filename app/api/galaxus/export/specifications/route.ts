import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

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
      kickdbVariant: { include: { product: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const rows: ExportRow[] = [];

  for (const mapping of mappings) {
    const supplierVariant = mapping.supplierVariant;
    const product = mapping.kickdbVariant?.product;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId);
    if (!providerKey) continue;

    // Minimum viable specs from available data.
    if (supplierVariant?.sizeRaw) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Size EU",
        SpecificationValue: supplierVariant.sizeRaw,
      });
    }
    if (product?.brand) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Brand",
        SpecificationValue: product.brand,
      });
    }
  }

  rows.sort((a, b) => a.ProviderKey.localeCompare(b.ProviderKey));

  const headers = ["ProviderKey", "SpecificationKey", "SpecificationValue"];
  const csv = toCsv(headers, rows);
  const filename = `galaxus-specifications-${supplier ?? "all"}-${Date.now()}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": rows.length.toString(),
      "X-Offset": offset.toString(),
    },
  });
}
