import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const rows: ExportRow[] = [];
  const seenGtins = new Set<string>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;

  const pickTrait = (traits: any, keys: string[]) => {
    if (!traits) return null;
    const list = Array.isArray(traits) ? traits : traits.traits ?? traits;
    const traitArray = Array.isArray(list) ? list : [];
    const lowerKeys = keys.map((key) => key.toLowerCase());
    for (const entry of traitArray) {
      const entryKey = String(entry?.name ?? entry?.key ?? entry?.attribute ?? "").toLowerCase();
      if (!entryKey) continue;
      if (lowerKeys.some((key) => entryKey.includes(key))) {
        const value = entry?.value ?? entry?.values ?? entry?.displayValue ?? entry?.text;
        if (Array.isArray(value)) return String(value[0] ?? "");
        if (value !== null && value !== undefined) return String(value);
      }
    }
    return null;
  };

  do {
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
      take: pageSize,
      skip: currentOffset,
    });
    lastBatch = mappings.length;

    for (const mapping of mappings) {
      const gtin = mapping.gtin ?? "";
      if (gtin && seenGtins.has(gtin)) continue;
      if (gtin) seenGtins.add(gtin);
      const supplierVariant = mapping.supplierVariant;
      const product = mapping.kickdbVariant?.product as any;
      const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId);
      if (!providerKey) continue;
      const traits = product?.traitsJson ?? null;

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

      const color = pickTrait(traits, ["color", "colour"]);
      const gender = pickTrait(traits, ["gender", "sex", "target"]);
      const material = pickTrait(traits, ["material"]);

      if (color) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Color",
          SpecificationValue: color,
        });
      }
      if (gender) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Target group",
          SpecificationValue: gender,
        });
      }
      if (material) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Material",
          SpecificationValue: material,
        });
      }
    }

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

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
