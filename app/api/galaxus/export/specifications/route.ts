import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import { accumulateBestCandidates, filterExportCandidates } from "@/galaxus/exports/gtinSelection";
import {
  buildFeedMappingsWhere,
  createTrmFeedExclusionStats,
  recordTrmFeedExclusion,
  totalTrmFeedExclusions,
  trmFeedExclusionsHeaderValue,
} from "@/galaxus/exports/trmExport";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();
  const report = ["1", "true", "yes"].includes((searchParams.get("report") ?? "").toLowerCase());
  const providerKeys = (searchParams.get("providerKeys") ?? "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const mappingsWhere = buildFeedMappingsWhere(supplier, all);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;

  const rows: ExportRow[] = [];
  const trmExclusionStats = createTrmFeedExclusionStats();
  const exclusionStats: Record<string, number> = {
    MISSING_GTIN: 0,
    INVALID_GTIN: 0,
    ENRICHMENT_PENDING: 0,
    KICKDB_NOT_FOUND: 0,
    MISSING_PRODUCT_NAME: 0,
    MISSING_IMAGE: 0,
    INVALID_PRICE: 0,
    INVALID_PROVIDER_KEY: 0,
  };
  const exclusionSamples: Record<string, string[]> = Object.fromEntries(
    Object.keys(exclusionStats).map((key) => [key, []])
  );
  const recordExclude = (payload: { reason: string; mapping?: any; variant?: any }) => {
    const reason = String(payload?.reason ?? "UNKNOWN");
    if (!(reason in exclusionStats)) return;
    exclusionStats[reason] += 1;
    const sample =
      payload?.variant?.supplierVariantId ??
      payload?.mapping?.supplierVariantId ??
      payload?.mapping?.gtin ??
      "";
    if (sample && exclusionSamples[reason].length < 25) {
      exclusionSamples[reason].push(String(sample));
    }
  };
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
        ...mappingsWhere,
        ...(providerKeyFilter ? providerKeyFilter : {}),
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
    accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides, {
      keyBy: "gtin",
      requireProductName: false,
      requireImage: false,
      onExclude: (payload) => {
        recordExclude(payload);
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  const { valid: exportCandidates, invalidSupplierVariantIds } = filterExportCandidates(candidates);
  if (invalidSupplierVariantIds.length > 0 && !report) {
    return NextResponse.json(
      {
        ok: false,
        error: "ProviderKey/GTIN invariant failed",
        supplierVariantIds: invalidSupplierVariantIds.slice(0, 50),
      },
      { status: 409 }
    );
  }
  const specStats = {
    exportable: exportCandidates.length,
    withSpecs: 0,
    withoutSpecs: 0,
    totalRows: 0,
    missingTraits: {
      size: 0,
      brand: 0,
      color: 0,
      gender: 0,
      material: 0,
    },
    missingSpecSamples: [] as string[],
  };
  for (const candidate of exportCandidates) {
    const mapping = candidate.mapping;
    const variant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey;
    if (!providerKey) continue;
    const traits = product?.traitsJson ?? null;

    let rowsAdded = 0;
    if (variant?.sizeRaw) {
      rowsAdded += 2;
      if (!report) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Schuhgrösse (EU)",
          SpecificationValue: variant.sizeRaw,
        });
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Bekleidungsgrösse",
          SpecificationValue: variant.sizeRaw,
        });
      }
    } else {
      specStats.missingTraits.size += 1;
    }
    const supplierBrand = variant?.supplierBrand ?? variant?.brand ?? null;
    if (supplierBrand || product?.brand) {
      rowsAdded += 1;
      if (!report) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Brand",
          SpecificationValue: supplierBrand || product.brand,
        });
      }
    } else {
      specStats.missingTraits.brand += 1;
    }

    const color = pickTrait(traits, ["color", "colour"]);
    const gender = pickTrait(traits, ["gender", "sex", "target"]);
    const material = pickTrait(traits, ["material"]);

    if (color) {
      rowsAdded += 1;
      if (!report) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Color",
          SpecificationValue: color,
        });
      }
    } else {
      specStats.missingTraits.color += 1;
    }
    if (gender) {
      rowsAdded += 1;
      if (!report) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Target group",
          SpecificationValue: gender,
        });
      }
    } else {
      specStats.missingTraits.gender += 1;
    }
    if (material) {
      rowsAdded += 1;
      if (!report) {
        rows.push({
          ProviderKey: providerKey,
          SpecificationKey: "Material",
          SpecificationValue: material,
        });
      }
    } else {
      specStats.missingTraits.material += 1;
    }
    if (rowsAdded > 0) {
      specStats.withSpecs += 1;
      specStats.totalRows += rowsAdded;
    } else {
      specStats.withoutSpecs += 1;
      if (specStats.missingSpecSamples.length < 25) {
        specStats.missingSpecSamples.push(providerKey);
      }
    }
  }
  if (report) {
    return NextResponse.json({
      ok: true,
      scope: "specs",
      counts: specStats,
      excluded: exclusionStats,
      excludedSamples: exclusionSamples,
      providerKeyMismatch: invalidSupplierVariantIds.length,
      trmExcluded: trmExclusionStats,
    });
  }

  rows.sort((a, b) => a.ProviderKey.localeCompare(b.ProviderKey));

  const headers = ["ProviderKey", "SpecificationKey", "SpecificationValue"];
  const csv = toCsv(headers, rows);
  const filename = `galaxus-specifications-${supplier ?? "all"}-${Date.now()}.csv`;
  const trmExcluded = totalTrmFeedExclusions(trmExclusionStats);
  if (trmExcluded > 0) {
    console.info("[GALAXUS][EXPORT][SPECS][TRM] Excluded rows", trmExclusionStats);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": rows.length.toString(),
      "X-Offset": offset.toString(),
      "X-TRM-Excluded": trmFeedExclusionsHeaderValue(trmExclusionStats),
    },
  });
}
