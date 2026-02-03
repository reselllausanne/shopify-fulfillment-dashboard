import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { toCsv } from "@/galaxus/exports/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ExportRow = Record<string, string>;

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

function buildProductTitle(payload: KickDbPayload | null, fallbackSku?: string | null): string {
  const brand = normalizeBrand(payload?.brand ?? "");
  const sku = sanitizeText(payload?.sku ?? "");
  const primary = sanitizeText(payload?.primary_title ?? "");
  const model = sanitizeText(payload?.model ?? "");
  const title = sanitizeText(payload?.title ?? "");
  const secondary = sanitizeText(payload?.secondary_title ?? "");

  let base = primary || model || title || fallbackSku || "";
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

function buildVariantName(payload: KickDbPayload | null, fallbackSku?: string | null): string {
  return buildProductTitle(payload, fallbackSku);
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

function cleanDescription(value?: string | null): string {
  if (!value) return "";
  let text = value.replace(/<[^>]*>/g, " ");
  text = text.replace(/https?:\/\/\S+/g, "");
  text = text.replace(/our team[^.]*\./gi, "");
  text = sanitizeText(text);
  return truncate(text, 4000);
}

function extractProductImages(
  payload: KickDbPayload | null,
  supplierImages: unknown,
  fallback?: string | null
): string[] {
  const list: string[] = [];
  if (payload?.image) list.push(payload.image);
  if (Array.isArray(payload?.gallery)) {
    for (const item of payload.gallery) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  if (fallback) list.push(fallback);
  if (Array.isArray(supplierImages)) {
    for (const item of supplierImages) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  return Array.from(new Set(list))
    .filter(Boolean)
    .filter((value) => isAbsoluteUrl(value));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
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

  const headers = [
    "ProviderKey",
    "Gtin",
    "ManufacturerKey",
    "BrandName",
    "ProductCategory",
    "ProductTitle_de",
    "VariantName",
    "LongDescription_de",
    "MainImageUrl",
    "ImageUrl_1",
    "ImageUrl_2",
    "ImageUrl_3",
    "ImageUrl_4",
    "ImageUrl_5",
    "ImageUrl_6",
    "ImageUrl_7",
    "ImageUrl_8",
  ];

  const rows: ExportRow[] = mappings.map((mapping) => {
    const supplierVariant = mapping.supplierVariant;
    const product = mapping.kickdbVariant?.product;
    const payload = product?.name || product?.brand
      ? ({
          title: product?.name ?? undefined,
          brand: product?.brand ?? undefined,
          sku: product?.styleId ?? supplierVariant?.supplierSku ?? undefined,
        } as KickDbPayload)
      : null;
    const providerKey = buildProviderKey(mapping.gtin, supplierVariant?.supplierVariantId) ?? "";
    const images = extractProductImages(payload, supplierVariant?.images, product?.imageUrl ?? null);
    const title = buildProductTitle(payload, supplierVariant?.supplierSku ?? null);
    const variantName = buildVariantName(payload, supplierVariant?.supplierSku ?? null);

    const manufacturerBase = sanitizeText(payload?.sku ?? product?.styleId ?? supplierVariant?.supplierSku ?? "");
    const manufacturerKey = truncate(
      manufacturerBase ? `${manufacturerBase}-${mapping.gtin ?? ""}` : mapping.gtin ?? "",
      50
    );

    return {
      ProviderKey: providerKey,
      Gtin: mapping.gtin ?? "",
      ManufacturerKey: manufacturerKey,
      BrandName: normalizeBrand(payload?.brand ?? product?.brand ?? ""),
      ProductCategory: buildProductCategory(payload) || "Sneakers",
      ProductTitle_de: title,
      VariantName: variantName,
      LongDescription_de: cleanDescription(payload?.description ?? ""),
      MainImageUrl: images[0] ?? "",
      ImageUrl_1: images[1] ?? "",
      ImageUrl_2: images[2] ?? "",
      ImageUrl_3: images[3] ?? "",
      ImageUrl_4: images[4] ?? "",
      ImageUrl_5: images[5] ?? "",
      ImageUrl_6: images[6] ?? "",
      ImageUrl_7: images[7] ?? "",
      ImageUrl_8: images[8] ?? "",
    };
  });

  const uniqueRows: ExportRow[] = [];
  const seenProviderKeys = new Set<string>();
  const seenGtins = new Set<string>();
  for (const row of rows) {
    const providerKey = row.ProviderKey;
    const gtin = row.Gtin;
    if (providerKey && seenProviderKeys.has(providerKey)) continue;
    if (gtin && seenGtins.has(gtin)) continue;
    if (providerKey) seenProviderKeys.add(providerKey);
    if (gtin) seenGtins.add(gtin);
    uniqueRows.push(row);
  }

  const csv = toCsv(headers, uniqueRows);
  const filename = `galaxus-master-${supplier ?? "all"}-${Date.now()}.csv`;

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "X-Total-Rows": uniqueRows.length.toString(),
      "X-Offset": offset.toString(),
    },
  });
}
