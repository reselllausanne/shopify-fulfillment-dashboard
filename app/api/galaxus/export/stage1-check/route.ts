import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Issue = {
  row: number;
  field: "ProviderKey" | "Gtin" | "Price" | "Stock";
  message: string;
  value?: string;
};

type Stage1Report = {
  ok: boolean;
  total: number;
  valid: number;
  invalid: number;
  issues: Issue[];
};

function isAsciiPrintable(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 32 || code > 126) return false;
  }
  return true;
}

function isValidGtin(value: string): boolean {
  if (!/^\d+$/.test(value)) return false;
  if (![8, 12, 13, 14].includes(value.length)) return false;
  const digits = value.split("").map((d) => Number(d));
  const checkDigit = digits.pop() ?? 0;
  let sum = 0;
  let weight = 3;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    sum += digits[i] * weight;
    weight = weight === 3 ? 1 : 3;
  }
  const calculated = (10 - (sum % 10)) % 10;
  return calculated === checkDigit;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "200"), 1000);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();

  const whereSupplier = supplier
    ? { supplierVariant: { supplierVariantId: { startsWith: `${supplier}:` } } }
    : {};

  const issues: Issue[] = [];
  let valid = 0;
  let total = 0;
  const prismaAny = prisma as any;

  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  const bestByGtin = new Map<string, any>();
  const partners = await (prismaAny as any).partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners);

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
    total += mappings.length;
    accumulateBestCandidates(mappings, bestByGtin, {
      keyBy: "gtin",
      requireProductName: false,
      requireImage: false,
      galaxusPartnerKeysLower,
    });

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  total = candidates.length;
  candidates.forEach((candidate, index) => {
    const row = index + 1;
    const mapping = candidate.mapping;
    const variant = candidate.variant as any;
    const gtin = String(candidate?.gtin ?? mapping?.gtin ?? variant?.gtin ?? "").trim();
    const providerKey =
      String(candidate?.providerKey ?? "").trim() ||
      (buildProviderKey(gtin, variant?.supplierVariantId) ?? "");
    const priceRaw = variant?.price ?? null;
    const stockRaw = variant?.stock ?? null;
    const price = priceRaw === null || priceRaw === undefined ? NaN : Number(priceRaw);
    const stock = stockRaw === null || stockRaw === undefined ? NaN : Number(stockRaw);

    let rowValid = true;

    if (!providerKey || providerKey.length > 100 || !isAsciiPrintable(providerKey)) {
      rowValid = false;
      issues.push({
        row,
        field: "ProviderKey",
        message: "ProviderKey is missing, too long, or contains non-ASCII characters.",
        value: providerKey,
      });
    }

    if (!gtin || !isValidGtin(gtin)) {
      rowValid = false;
      issues.push({
        row,
        field: "Gtin",
        message: "GTIN is missing or invalid.",
        value: gtin,
      });
    }

    if (!Number.isFinite(price) || price <= 0) {
      rowValid = false;
      issues.push({
        row,
        field: "Price",
        message: "Price is missing or not greater than zero.",
        value: priceRaw === null || priceRaw === undefined ? "" : String(priceRaw),
      });
    }

    if (!Number.isFinite(stock) || stock < 0 || !Number.isInteger(stock)) {
      rowValid = false;
      issues.push({
        row,
        field: "Stock",
        message: "Stock is missing or not a non-negative integer.",
        value: stockRaw === null || stockRaw === undefined ? "" : String(stockRaw),
      });
    }

    if (rowValid) valid += 1;
  });

  const report: Stage1Report = {
    ok: issues.length === 0,
    total,
    valid,
    invalid: total - valid,
    issues: issues.slice(0, 200),
  };

  return NextResponse.json(report);
}
