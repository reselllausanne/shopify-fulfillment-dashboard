import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_FEED_INCLUDE_TRM } from "@/galaxus/config";
import { toCsv } from "@/galaxus/exports/csv";
import { accumulateBestCandidates } from "@/galaxus/exports/gtinSelection";
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

function buildVariantName(
  payload: KickDbPayload | null,
  fallbackSku?: string | null,
  fallbackName?: string | null
): string {
  return buildProductTitle(payload, fallbackSku, fallbackName);
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

function extractSupplierImages(supplierImages: unknown): string[] {
  const list: string[] = [];
  if (Array.isArray(supplierImages) && supplierImages.length) {
    for (const item of supplierImages) {
      if (typeof item === "string" && item.length) list.push(item);
    }
  }
  return Array.from(new Set(list)).filter((value) => isAbsoluteUrl(value));
}

function pickPrimaryImages(supplierImages: unknown, kickdbImageUrl?: string | null): string[] {
  const supplier = extractSupplierImages(supplierImages);
  if (supplier.length > 0) return supplier;
  const fallback =
    typeof kickdbImageUrl === "string" && kickdbImageUrl.trim() && isAbsoluteUrl(kickdbImageUrl)
      ? [kickdbImageUrl.trim()]
      : [];
  return fallback;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
  const minimal = ["1", "true", "yes"].includes((searchParams.get("minimal") ?? "").toLowerCase());
  const limit = Math.min(Number(searchParams.get("limit") ?? "100"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const supplier = searchParams.get("supplier")?.trim();
  const stage = searchParams.get("stage") ?? "1";
  const includeWeight = stage === "2";

  const mappingsWhere = buildFeedMappingsWhere(supplier, all);

  const headers = minimal
    ? ["ProviderKey", "Gtin", "BrandName"]
    : [
        "ProviderKey",
        "Gtin",
        "ManufacturerKey",
        "BrandName",
        "ProductCategory",
        "ProductTitle_de",
        "ProductTitle_en",
        "ProductTitle_ch",
        "VariantName",
        "LongDescription_de",
        "MainImageUrl",
      ];
  if (!minimal && includeWeight) headers.push("ProductWeight");

  const rows: ExportRow[] = [];
  const skippedProviderKeys: string[] = [];
  const trmExclusionStats = createTrmFeedExclusionStats();
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
  const parsePrice = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
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

  do {
    const mappings = await prismaAny.variantMapping.findMany({
      where: {
        ...mappingsWhere,
      },
      include: {
        supplierVariant: true,
        ...(minimal ? {} : { kickdbVariant: { include: { product: true } } }),
      },
      orderBy: { updatedAt: "desc" },
      take: pageSize,
      skip: currentOffset,
    });
    lastBatch = mappings.length;
    accumulateBestCandidates(mappings, bestByGtin, resolvePartnerOverrides, {
      includeTrm: GALAXUS_FEED_INCLUDE_TRM,
      keyBy: "providerKey",
      requireProductName: false,
      requireImage: false,
      onExclude: (payload) => {
        if (payload.supplierKey === "trm") {
          recordTrmFeedExclusion(trmExclusionStats, payload.reason);
        }
      },
    });
    currentOffset += pageSize;
  } while (all && lastBatch === pageSize);

  const candidates = Array.from(bestByGtin.values());
  candidates.forEach((candidate) => {
    const mapping = candidate.mapping;
    const supplierVariant = candidate.variant as any;
    const product = candidate.product as any;
    const providerKey = candidate.providerKey ?? "";
    const buyPrice = parsePrice(supplierVariant?.price);
    if (!buyPrice || !Number.isFinite(buyPrice) || buyPrice <= 0) {
      if (providerKey) skippedProviderKeys.push(providerKey);
      return;
    }
    const supplierName = sanitizeText(
      supplierVariant?.supplierProductName ?? supplierVariant?.productName ?? ""
    );
    const fallbackTitle = sanitizeText(
      supplierName ||
        supplierVariant?.supplierSku ||
        mapping.gtin ||
        providerKey ||
        supplierVariant?.supplierVariantId ||
        ""
    );
    const supplierBrand = normalizeBrand(
      supplierVariant?.supplierBrand ?? supplierVariant?.brand ?? product?.brand ?? ""
    );
    const images = pickPrimaryImages(supplierVariant?.images, product?.imageUrl ?? null);
    if (minimal) {
      rows.push({
        ProviderKey: providerKey,
        Gtin: mapping.gtin ?? "",
        BrandName: supplierBrand,
      });
      return;
    }
    const payload = product?.name || product?.brand || product?.description
      ? ({
          title: product?.name ?? undefined,
          brand: product?.brand ?? undefined,
          sku: product?.styleId ?? supplierVariant?.supplierSku ?? supplierVariant?.externalSku ?? undefined,
          description: product?.description ?? undefined,
        } as KickDbPayload)
      : null;
    const title = fallbackTitle;
    const variantName = fallbackTitle;
    const description = payload?.description ? cleanDescription(payload.description) : "";

    const manufacturerBase = sanitizeText(
      payload?.sku ?? product?.styleId ?? supplierVariant?.supplierSku ?? supplierVariant?.externalSku ?? ""
    );
    const manufacturerKey = truncate(
      manufacturerBase ? `${manufacturerBase}-${mapping.gtin ?? ""}` : mapping.gtin ?? "",
      50
    );

    const row: ExportRow = {
      ProviderKey: providerKey,
      Gtin: mapping.gtin ?? "",
      ManufacturerKey: manufacturerKey,
      BrandName: supplierBrand || normalizeBrand(payload?.brand ?? product?.brand ?? ""),
      ProductCategory: buildProductCategory(payload) || "Sneakers",
      ProductTitle_de: title,
      ProductTitle_en: title,
      ProductTitle_ch: title,
      VariantName: variantName,
      LongDescription_de: description,
      MainImageUrl: images[0] ?? "",
    };
    if (includeWeight) {
      const weightValue = supplierVariant?.weightGrams ?? 1000;
      row.ProductWeight = Number.isFinite(weightValue) ? String(weightValue) : "1000";
    }
    rows.push(row);
  });

  const csv = toCsv(headers, rows);
  const filename = `galaxus-master-${supplier ?? "all"}-${Date.now()}.csv`;
  const trmExcluded = totalTrmFeedExclusions(trmExclusionStats);
  if (trmExcluded > 0) {
    console.info("[GALAXUS][EXPORT][MASTER][TRM] Excluded rows", trmExclusionStats);
  }
  if (skippedProviderKeys.length > 0) {
    console.info("[GALAXUS][EXPORT][MASTER] Skipped invalid price", {
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
    },
  });
}
