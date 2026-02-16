import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";

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
  const bestByGtin = new Map<string, any>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  const prismaAny = prisma as any;
  const partners = await prismaAny.partner.findMany();
  const partnerByKey = new Map<string, any>(
    partners.map((p: any) => [String(p.key ?? "").toLowerCase(), p])
  );
  const toNumber = (value: any) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const resolvePartnerOverrides = (key: string | null) => {
    if (!key) return null;
    const partner = partnerByKey.get(key.toLowerCase());
    if (!partner) return null;
    return {
      targetMargin: toNumber(partner.targetMargin),
      shippingPerPair: toNumber(partner.shippingPerPair),
      bufferPerPair: toNumber(partner.bufferPerPair),
      roundTo: toNumber(partner.roundTo),
      vatRate: toNumber(partner.vatRate),
    };
  };

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
    const mappings = await prismaAny.variantMapping.findMany({
      where: {
        status: { in: ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] },
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
    accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides);

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  for (const candidate of candidates) {
    const mapping = candidate.mapping;
    const variant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey;
    if (!providerKey) continue;
    const traits = product?.traitsJson ?? null;

    if (variant?.sizeRaw) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Size EU",
        SpecificationValue: variant.sizeRaw,
      });
    }
    const supplierBrand = variant?.supplierBrand ?? variant?.brand ?? null;
    if (supplierBrand || product?.brand) {
      rows.push({
        ProviderKey: providerKey,
        SpecificationKey: "Brand",
        SpecificationValue: supplierBrand || product.brand,
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
