import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_PRICE_CURRENCY, GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { toCsv } from "@/galaxus/exports/csv";
import { computeGalaxusSellPriceExVat, getDefaultPricing, resolvePricingOverrides } from "@/galaxus/exports/pricing";
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

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}


function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function publishStxStockFromAsks(asks: number): number {
  if (!Number.isFinite(asks) || asks < 2) return 0;
  if (asks <= 5) return 2;
  if (asks <= 10) return 5;
  if (asks <= 20) return 8;
  return 12;
}

export async function GET(request: Request) {
  const prismaAny = prisma as any;
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();
  const providerKeys = (searchParams.get("providerKeys") ?? "")
    .split(/[\n,]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  const mappingsWhere = buildFeedMappingsWhere(supplier, all);
  const providerKeyFilter = providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : null;
  const trmExclusionStats = createTrmFeedExclusionStats();

  const rows: ExportRow[] = [];
  const skippedProviderKeys: string[] = [];
  let skippedInvalidPrice = 0;
  let skippedMissingProviderKey = 0;
  const bestByGtin = new Map<string, any>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;

  const currency = GALAXUS_PRICE_CURRENCY.toUpperCase();
  const isMerchant = GALAXUS_PRICE_MODEL.toLowerCase() === "merchant";
  const defaults = getDefaultPricing();
  const vatRateDefault = defaults.vatRate;
  const priceHeader = isMerchant
    ? `SalesPriceExclVat_${currency}`
    : `PurchasePriceExclVat_${currency}`;
  const headers = isMerchant
    ? ["ProviderKey", priceHeader, "VatRatePercentage"]
    : [
        "ProviderKey",
        priceHeader,
        "SuggestedRetailPriceInclVat_CHF",
        "VatRatePercentage",
      ];

  const partners = await prismaAny.partner.findMany({
    select: {
      key: true,
      targetMargin: true,
      shippingPerPair: true,
      bufferPerPair: true,
      roundTo: true,
      vatRate: true,
    },
  });
  const partnerByKey = new Map<string, any>(
    partners.map((p: any) => [String(p.key ?? "").toLowerCase(), p])
  );
  const resolvePartnerOverrides = (key: string | null) => {
    if (!key) return null;
    const partner = partnerByKey.get(key.toLowerCase());
    if (!partner) return null;
    return {
      targetMargin: parseNumber(partner.targetMargin),
      shippingPerPair: parseNumber(partner.shippingPerPair),
      bufferPerPair: parseNumber(partner.bufferPerPair),
      roundTo: parseNumber(partner.roundTo),
      vatRate: parseNumber(partner.vatRate),
    };
  };

  do {
    const whereClause: Record<string, unknown> = all
      ? {
          ...mappingsWhere,
          ...(providerKeyFilter ? providerKeyFilter : {}),
          ...(cursorUpdatedAt && cursorId
            ? {
                OR: [
                  { updatedAt: { lt: cursorUpdatedAt } },
                  { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
                ],
              }
            : {}),
        }
      : {
          ...mappingsWhere,
          ...(providerKeyFilter ? providerKeyFilter : {}),
        };
    const mappings: any[] = await prismaAny.variantMapping.findMany({
      where: whereClause,
      select: {
        id: true,
        gtin: true,
        updatedAt: true,
        supplierVariantId: true,
        supplierVariant: {
          select: {
            supplierVariantId: true,
            price: true,
            stock: true,
            manualPrice: true,
            manualStock: true,
            manualLock: true,
            updatedAt: true,
            deliveryType: true,
          },
        },
        kickdbVariant: {
          select: {
            product: {
              select: {
                retailPrice: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
      ...(all ? {} : { skip: currentOffset }),
    });
    lastBatch = mappings.length;
    if (mappings.length > 0) {
      const last: any = mappings[mappings.length - 1];
      cursorUpdatedAt = last.updatedAt ?? null;
      cursorId = last.id ?? null;
    }
    accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides, {
      keyBy: "gtin",
      requireProductName: false,
      requireImage: true,
      onExclude: (payload) => {
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });
    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values()).filter((candidate: any) => {
    const key = String(candidate?.providerKey ?? "");
    return Boolean(key);
  });
  const seenProviderKeys = new Set<string>();
  const uniqueCandidates = candidates.filter((candidate: any) => {
    const key = String(candidate?.providerKey ?? "");
    if (seenProviderKeys.has(key)) return false;
    seenProviderKeys.add(key);
    return true;
  });
  const { valid: exportCandidates, invalidSupplierVariantIds } = filterExportCandidates(uniqueCandidates);
  if (invalidSupplierVariantIds.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: "ProviderKey/GTIN invariant failed",
        supplierVariantIds: invalidSupplierVariantIds.slice(0, 50),
      },
      { status: 409 }
    );
  }
  for (const candidate of exportCandidates) {
    const mapping = candidate.mapping;
    const variant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey ?? "";
    const sellPrice = Number(candidate.sellPriceExVat);
    const vatRate = vatRateDefault;
    const manualLock = Boolean(variant?.manualLock);
    const manualPrice = parseNumber(variant?.manualPrice);
    const manualStockRaw = variant?.manualStock;
    const manualStock =
      manualStockRaw === null || manualStockRaw === undefined ? null : Number.parseInt(String(manualStockRaw), 10);
    const manualPriceExVat =
      manualLock && manualPrice && manualPrice > 0 ? manualPrice / (1 + (vatRate ?? 0)) : null;
    const priceValue =
      manualPriceExVat && manualPriceExVat > 0 ? manualPriceExVat : sellPrice;
    if (!Number.isFinite(priceValue) || priceValue <= 0) {
      skippedInvalidPrice += 1;
      if (providerKey) skippedProviderKeys.push(providerKey);
      continue;
    }
    const price = Number.isFinite(priceValue) && priceValue > 0 ? priceValue.toFixed(2) : "";
    const rrp = parseNumber(product?.retailPrice);
    const rrpAdjusted = rrp ? (rrp + 30).toFixed(2) : "";
    if (!providerKey || !price) {
      if (!providerKey) skippedMissingProviderKey += 1;
      continue;
    }

    const baseStock = Number.parseInt(String(variant?.stock ?? 0), 10);
    const rawStock = manualLock && manualStock !== null ? manualStock : baseStock;
    const supplierVariantId = String(variant?.supplierVariantId ?? "");
    const isStx = supplierVariantId.startsWith("stx_") || providerKey.startsWith("STX_");
    const deliveryType = String(variant?.deliveryType ?? "");
    const effectiveStock = isStx && deliveryType.startsWith("express_")
      ? publishStxStockFromAsks(rawStock)
      : isStx
        ? 0
        : rawStock;
    if (!Number.isFinite(effectiveStock) || effectiveStock <= 0) {
      continue;
    }

    if (isMerchant) {
      rows.push({
        ProviderKey: providerKey,
        [priceHeader]: price,
        VatRatePercentage: vatRate ? String(vatRate * 100) : "8.1",
      });
      continue;
    }

    rows.push({
      ProviderKey: providerKey,
      [priceHeader]: price,
      SuggestedRetailPriceInclVat_CHF: rrpAdjusted,
      VatRatePercentage: vatRate ? String(vatRate * 100) : "8.1",
    });
  }

  const csv = toCsv(headers, rows);
  const filename = `galaxus-offer-${supplier ?? "all"}-${Date.now()}.csv`;
  const trmExcluded = totalTrmFeedExclusions(trmExclusionStats);
  if (trmExcluded > 0) {
    console.info("[GALAXUS][EXPORT][OFFER][TRM] Excluded rows", trmExclusionStats);
  }
  if (skippedProviderKeys.length > 0) {
    console.info("[GALAXUS][EXPORT][OFFER] Skipped invalid price", {
      count: skippedProviderKeys.length,
      providerKeys: Array.from(new Set(skippedProviderKeys)),
    });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": rows.length.toString(),
      "X-Offset": offset.toString(),
      "X-TRM-Excluded": trmFeedExclusionsHeaderValue(trmExclusionStats),
      "X-Skipped-Invalid-Price": skippedInvalidPrice.toString(),
      "X-Skipped-Missing-ProviderKey": skippedMissingProviderKey.toString(),
    },
  });
}
