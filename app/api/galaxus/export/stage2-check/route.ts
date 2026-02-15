import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Issue = {
  row: number;
  field:
    | "ProviderKey"
    | "Gtin"
    | "Price"
    | "Stock"
    | "BrandName"
    | "ProductTitle_de"
    | "ProductCategory"
    | "MainImageUrl"
    | "ProductWeight";
  message: string;
  value?: string;
};

type KickDbPayload = {
  title?: string;
  primary_title?: string;
  secondary_title?: string;
  description?: string;
  brand?: string;
  model?: string;
  sku?: string;
  category?: string;
  secondary_category?: string;
  product_type?: string;
  breadcrumbs?: Array<{ value?: string }>;
  gallery?: string[];
  image?: string;
};

type Stage2Report = {
  ok: boolean;
  total: number;
  valid: number;
  invalid: number;
  issues: Issue[];
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return value.replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function normalizeBrand(value?: string | null): string {
  const trimmed = sanitizeText(value);
  if (!trimmed) return "";
  return trimmed[0].toUpperCase() + trimmed.slice(1);
}

function stripBrandPrefix(name: string, brand: string): string {
  if (!name || !brand) return name;
  const lowerName = name.toLowerCase();
  const lowerBrand = brand.toLowerCase();
  if (lowerName.startsWith(lowerBrand)) {
    const remaining = name.slice(brand.length).trim();
    return remaining.replace(/^[\-–—:]+/, "").trim();
  }
  return name;
}

function stripToken(name: string, token: string): string {
  if (!name || !token) return name;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return name.replace(new RegExp(`\\b${escaped}\\b`, "gi"), "").replace(/\s+/g, " ").trim();
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function stripParenthetical(text: string): string {
  return text.replace(/\s*\([^)]*\)\s*$/g, "").trim();
}

function stripGenderTokens(text: string): string {
  return text
    .replace(/\b(women's|womens|women|men's|mens|men|gs|youth|kids)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildProductTitle(
  payload: KickDbPayload | null,
  fallbackSku?: string | null,
  fallbackName?: string | null
): string {
  const brand = normalizeBrand(payload?.brand ?? "");
  const sku = sanitizeText(payload?.sku ?? "");
  const fallbackTitle = sanitizeText(fallbackName ?? "");
  const primary = sanitizeText(payload?.primary_title ?? "");
  const model = sanitizeText(payload?.model ?? "");
  const title = sanitizeText(payload?.title ?? "");
  const secondary = sanitizeText(payload?.secondary_title ?? "");

  let base = primary || model || title || fallbackTitle || fallbackSku || "";
  if (!base) return "";

  if (secondary && base.toLowerCase().endsWith(secondary.toLowerCase())) {
    base = base.slice(0, base.length - secondary.length).trim();
  }

  base = stripBrandPrefix(base, brand);
  base = stripParenthetical(base);
  base = stripGenderTokens(base);
  base = stripToken(base, brand);
  base = stripToken(base, secondary);
  base = stripToken(base, payload?.product_type ?? "");
  base = stripToken(base, payload?.category ?? "");
  if (sku) base = stripToken(base, sku);
  return truncate(base, 100);
}

function buildProductCategory(payload: KickDbPayload | null): string {
  if (!payload) return "";
  const breadcrumb = payload.breadcrumbs
    ?.map((item) => sanitizeText(item.value ?? ""))
    .filter(Boolean);
  if (breadcrumb && breadcrumb.length) {
    return truncate(breadcrumb.join(" > "), 200);
  }
  const category = sanitizeText(payload.category ?? "");
  const secondary = sanitizeText(payload.secondary_category ?? "");
  if (category && secondary) return truncate(`${category} > ${secondary}`, 200);
  return truncate(category || sanitizeText(payload.product_type ?? ""), 200);
}

function extractProductImages(
  payload: KickDbPayload | null,
  supplierImages: unknown,
  fallback?: string | null
): string[] {
  const list: string[] = [];
  if (Array.isArray(supplierImages)) {
    for (const item of supplierImages) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  if (payload?.image) list.push(payload.image);
  if (Array.isArray(payload?.gallery)) {
    for (const item of payload.gallery) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  if (fallback) list.push(fallback);
  return Array.from(new Set(list))
    .filter(Boolean)
    .filter((value) => isAbsoluteUrl(value));
}

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

  const pageSize = all ? 500 : limit;
  let currentOffset = all ? 0 : offset;
  let lastBatch = 0;
  const bestByGtin = new Map<string, any>();

  do {
    const mappings = await prisma.variantMapping.findMany({
      where: {
        status: { in: ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] },
        gtin: { not: null },
        ...whereSupplier,
      },
      include: {
        supplierVariant: true,
        partnerVariant: { include: { partner: true } },
        kickdbVariant: { include: { product: true } },
      },
      orderBy: { updatedAt: "desc" },
      take: pageSize,
      skip: currentOffset,
    });
    lastBatch = mappings.length;
    total += mappings.length;

    accumulateBestCandidates(mappings, bestByGtin);

    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  total = candidates.length;
  candidates.forEach((candidate, index) => {
    const row = index + 1;
    const mapping = candidate.mapping;
    const supplierVariant = candidate.variant as any;
    const supplierVariantAny = supplierVariant as any;
    const product = candidate.product ?? mapping.kickdbVariant?.product;
    const payload = product?.name || product?.brand
      ? ({
          title: product?.name ?? undefined,
          brand: product?.brand ?? undefined,
          sku: product?.styleId ?? supplierVariant?.supplierSku ?? supplierVariant?.externalSku ?? undefined,
        } as KickDbPayload)
      : null;
    const providerKey =
      mapping?.providerKey ??
      buildProviderKey(
        mapping.gtin,
        candidate.source === "supplier"
          ? supplierVariant?.supplierVariantId
          : `${mapping?.partnerVariant?.partner?.key ?? "PRT"}:${mapping?.partnerVariant?.partnerVariantId ?? mapping?.partnerVariant?.id}`
      ) ??
      "";
    const gtin = String(mapping.gtin ?? "");
    const priceRaw = supplierVariant?.price ?? null;
    const stockRaw = supplierVariant?.stock ?? null;
    const price = priceRaw === null || priceRaw === undefined ? NaN : Number(priceRaw);
    const stock = stockRaw === null || stockRaw === undefined ? NaN : Number(stockRaw);
    const brand = normalizeBrand(
      payload?.brand ?? product?.brand ?? supplierVariantAny?.supplierBrand ?? supplierVariantAny?.brand ?? ""
    );
    const title = buildProductTitle(
      payload,
      supplierVariant?.supplierSku ?? supplierVariant?.externalSku ?? null,
      supplierVariantAny?.supplierProductName ?? supplierVariantAny?.productName ?? null
    );
    const category = buildProductCategory(payload) || "Sneakers";
    const images = extractProductImages(payload, supplierVariant?.images, product?.imageUrl ?? null);
    const weightRaw = supplierVariantAny?.weightGrams ?? 1000;
    const weight = weightRaw === null || weightRaw === undefined ? NaN : Number(weightRaw);

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

    if (!brand) {
      rowValid = false;
      issues.push({
        row,
        field: "BrandName",
        message: "Brand name is missing.",
        value: brand,
      });
    }

    if (!title) {
      rowValid = false;
      issues.push({
        row,
        field: "ProductTitle_de",
        message: "Product title is missing.",
        value: title,
      });
    }

    if (!category) {
      rowValid = false;
      issues.push({
        row,
        field: "ProductCategory",
        message: "Product category is missing.",
        value: category,
      });
    }

    if (!images[0]) {
      rowValid = false;
      issues.push({
        row,
        field: "MainImageUrl",
        message: "Main image URL is missing.",
        value: images[0] ?? "",
      });
    }

    if (!Number.isFinite(weight) || weight <= 0) {
      rowValid = false;
      issues.push({
        row,
        field: "ProductWeight",
        message: "Product weight (grams) is missing or not greater than zero.",
        value: weightRaw === null || weightRaw === undefined ? "" : String(weightRaw),
      });
    }

    if (rowValid) valid += 1;
  });

  const report: Stage2Report = {
    ok: issues.length === 0,
    total,
    valid,
    invalid: total - valid,
    issues: issues.slice(0, 200),
  };

  return NextResponse.json(report);
}
