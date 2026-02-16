import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_CURRENCY, GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { toCsv } from "@/galaxus/exports/csv";
import { computeGalaxusSellPriceExVat, getDefaultPricing, resolvePricingOverrides } from "@/galaxus/exports/pricing";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";

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

export async function GET(request: Request) {
  const prismaAny = prisma as any;
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

  const partners = await prismaAny.partner.findMany();
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
    const supplierKey = String(variant?.supplierVariantId ?? "").split(":")[0] || "";
    const overrides = resolvePricingOverrides(resolvePartnerOverrides(supplierKey));

    const buyPrice = parseNumber(variant?.price);
    if (!buyPrice || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      continue;
    }
    const computedPrice = computeGalaxusSellPriceExVat({
      buyPriceExVatCHF: buyPrice,
      shippingPerPairCHF: overrides.shippingPerPair,
      targetNetMargin: overrides.targetMargin,
      bufferPerPairCHF: overrides.bufferPerPair,
      roundTo: overrides.roundTo,
      vatRate: overrides.vatRate,
    });
    const price = computedPrice.sellPriceExVatCHF.toFixed(2);
    const vatRate = overrides.vatRate ?? vatRateDefault;
    const rrp = parseNumber(product?.retailPrice);
    const rrpAdjusted = rrp ? (rrp + 30).toFixed(2) : "";
    const providerKey =
      buildProviderKey(mapping.gtin, variant?.supplierVariantId) ?? mapping?.providerKey ?? "";

    if (!providerKey || !price) continue;

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

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": rows.length.toString(),
      "X-Offset": offset.toString(),
    },
  });
}
