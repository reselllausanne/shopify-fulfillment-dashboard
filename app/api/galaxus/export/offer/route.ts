import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { GALAXUS_PRICE_CURRENCY, GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

type PricingInput = {
  buyPriceExVatCHF: number;
  shippingPerPairCHF?: number;
  targetNetMargin?: number;
  bufferPerPairCHF?: number;
  roundTo?: number;
  vatRate?: number;
};

const DEFAULT_SHIPPING = 6;
const DEFAULT_TARGET_MARGIN = 0.08;
const DEFAULT_BUFFER = 0;
const DEFAULT_ROUND_TO = 0.05;
const DEFAULT_VAT_RATE = 0.081;
const DEFAULT_TARGET_MARGIN_KEYS = [
  "GALAXUS_TARGET_MARGIN",
  "GALAXUS_TARGET_NET_MARGIN",
  "GALAXUS_PRICE_TARGET_MARGIN",
];
const DEFAULT_SHIPPING_KEYS = ["GALAXUS_PRICE_SHIPPING_CHF", "GALAXUS_SHIPPING_CHF"];
const DEFAULT_BUFFER_KEYS = ["GALAXUS_PRICE_BUFFER_CHF", "GALAXUS_BUFFER_CHF"];
const DEFAULT_ROUND_TO_KEYS = ["GALAXUS_PRICE_ROUND_TO", "GALAXUS_ROUND_TO"];
const DEFAULT_VAT_RATE_KEYS = ["GALAXUS_PRICE_VAT_RATE", "GALAXUS_VAT_RATE"];

function decimalToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number") return value.toString();
  return String(value);
}

function roundUpToIncrement(value: number, increment: number): number {
  if (increment <= 0) return value;
  const scale = 1 / increment;
  return Math.ceil((value + 1e-12) * scale) / scale;
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

function readNumberEnv(keys: string[], fallback: number): number {
  for (const key of keys) {
    const raw = process.env[key];
    if (raw === undefined || raw === null || raw === "") continue;
    const parsed = Number.parseFloat(String(raw));
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function computeGalaxusSellPriceExVat(input: PricingInput) {
  const shipping = input.shippingPerPairCHF ?? DEFAULT_SHIPPING;
  const target = input.targetNetMargin ?? DEFAULT_TARGET_MARGIN;
  const buffer = input.bufferPerPairCHF ?? DEFAULT_BUFFER;
  const roundTo = input.roundTo ?? DEFAULT_ROUND_TO;
  const vatRate = input.vatRate ?? DEFAULT_VAT_RATE;

  if (!Number.isFinite(input.buyPriceExVatCHF) || input.buyPriceExVatCHF <= 0) {
    throw new Error("buyPriceExVatCHF must be > 0");
  }
  if (!Number.isFinite(shipping) || shipping < 0) {
    throw new Error("shippingPerPairCHF must be >= 0");
  }
  if (!Number.isFinite(buffer) || buffer < 0) {
    throw new Error("bufferPerPairCHF must be >= 0");
  }
  if (!Number.isFinite(target) || target <= 0 || target >= 0.5) {
    throw new Error("targetNetMargin must be in (0, 0.5)");
  }
  if (!Number.isFinite(roundTo) || roundTo <= 0) {
    throw new Error("roundTo must be > 0");
  }
  if (!Number.isFinite(vatRate) || vatRate < 0) {
    throw new Error("vatRate must be >= 0");
  }

  const totalCost = input.buyPriceExVatCHF + shipping + buffer;
  const rawSellPrice = totalCost / (1 - target);
  const sellPriceExVat = roundUpToIncrement(rawSellPrice, roundTo);

  return {
    sellPriceExVatCHF: sellPriceExVat,
    sellPriceIncVatCHF: sellPriceExVat * (1 + vatRate),
    impliedNetMargin: (sellPriceExVat - totalCost) / sellPriceExVat,
    markupOnBuyPricePct:
      ((sellPriceExVat - input.buyPriceExVatCHF) / input.buyPriceExVatCHF) * 100,
  };
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
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

  const rows: ExportRow[] = [];
  const seenGtins = new Set<string>();
  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;

  const currency = GALAXUS_PRICE_CURRENCY.toUpperCase();
  const isMerchant = GALAXUS_PRICE_MODEL.toLowerCase() === "merchant";
  const targetMargin = readNumberEnv(DEFAULT_TARGET_MARGIN_KEYS, DEFAULT_TARGET_MARGIN);
  const shippingPerPair = readNumberEnv(DEFAULT_SHIPPING_KEYS, DEFAULT_SHIPPING);
  const bufferPerPair = readNumberEnv(DEFAULT_BUFFER_KEYS, DEFAULT_BUFFER);
  const roundTo = readNumberEnv(DEFAULT_ROUND_TO_KEYS, DEFAULT_ROUND_TO);
  const vatRateDefault = readNumberEnv(DEFAULT_VAT_RATE_KEYS, DEFAULT_VAT_RATE);
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

  do {
    const mappings = await prisma.variantMapping.findMany({
      where: {
        status: { in: ["MATCHED", "SUPPLIER_GTIN"] },
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

      const supplierVariant = mapping.supplierVariant as any;
      if (!supplierVariant?.supplierProductName || !hasSupplierImage(supplierVariant?.images)) {
        continue;
      }
      const product = (mapping as any).kickdbVariant?.product as any;
      const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
      const buyPrice = parseNumber(supplierVariant?.price);
      const computedPrice =
        buyPrice && !isMerchant
          ? computeGalaxusSellPriceExVat({
              buyPriceExVatCHF: buyPrice,
              shippingPerPairCHF: shippingPerPair,
              targetNetMargin: targetMargin,
              bufferPerPairCHF: bufferPerPair,
              roundTo,
              vatRate: vatRateDefault,
            })
          : null;
      const price = computedPrice
        ? computedPrice.sellPriceExVatCHF.toFixed(2)
        : decimalToString(supplierVariant?.price ?? "");
      const vatRate = supplierVariant?.vatRate ?? 8.1;
      const rrp = product?.retailPrice ?? "";

      if (isMerchant) {
        rows.push({
          ProviderKey: providerKey,
          [priceHeader]: price,
          VatRatePercentage: vatRate ? String(vatRate) : "8.1",
        });
        continue;
      }

      rows.push({
        ProviderKey: providerKey,
        [priceHeader]: price,
        SuggestedRetailPriceInclVat_CHF: rrp ? String(rrp) : "",
        VatRatePercentage: vatRate ? String(vatRate) : "8.1",
      });
    }

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

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
