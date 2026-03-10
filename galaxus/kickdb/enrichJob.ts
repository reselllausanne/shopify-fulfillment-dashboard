import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";
import {
  fetchStockxProductByIdOrSlug,
  fetchStockxProductByIdOrSlugRaw,
  matchVariantsBySize,
  extractVariantGtin,
  searchStockxProducts,
} from "@/galaxus/kickdb/client";
import { Prisma } from "@prisma/client";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { shouldFetchKickDb } from "@/galaxus/kickdb/cache";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";

type KickdbEnrichOptions = {
  limit?: number;
  offset?: number;
  debug?: boolean;
  force?: boolean;
  forceMissing?: boolean;
  raw?: boolean;
  supplierVariantId?: string | null;
  supplierSku?: string | null;
  supplierVariantIdPrefix?: string | null;
  includeNotFound?: boolean;
};

type DebugInfo = {
  reason?: string;
  query?: string;
  force?: boolean;
  raw?: boolean;
  productRecordId?: string | null;
  kickdbProductId?: string | null;
  sizeRaw?: string | null;
  supplierSku?: string;
  productName?: string | null;
  rawSearch?: unknown;
  rawProduct?: unknown;
  searchMeta?: { total?: number };
  searchTop?: {
    id?: string;
    slug?: string;
    title?: string;
    sku?: string;
  } | null;
  productSummary?: {
    id?: string;
    slug?: string;
    title?: string;
    sku?: string;
    variantCount?: number;
  } | null;
  matchedVariant?: {
    id?: string;
    size?: string;
    size_us?: string;
    size_eu?: string;
    identifiers?: string[];
    gtin?: string | null;
    ean?: string | null;
  } | null;
  variantSizes?: string[];
  error?: string;
};

function summarizeIdentifiers(identifiers: unknown): string[] {
  if (Array.isArray(identifiers)) {
    return identifiers
      .map((item) => item?.identifier_type)
      .filter((value) => typeof value === "string");
  }
  if (identifiers && typeof identifiers === "object") {
    return Object.keys(identifiers as Record<string, string | string[]>);
  }
  return [];
}

function summarizeVariant(variant: any) {
  if (!variant) return null;
  return {
    id: variant.id,
    size: variant.size,
    size_us: variant.size_us,
    size_eu: variant.size_eu,
    identifiers: summarizeIdentifiers(variant.identifiers),
    gtin: variant.gtin ?? null,
    ean: variant.ean ?? null,
  };
}

function summarizeVariantSizes(variants: any[] = []) {
  const values = variants.slice(0, 8).flatMap((variant) => {
    const sizes: Array<string | undefined> = [
      variant?.size_eu,
      variant?.size_us,
      variant?.size,
    ];
    if (Array.isArray(variant?.sizes)) {
      for (const entry of variant.sizes) {
        sizes.push(entry?.size);
      }
    }
    return sizes;
  });
  return values.filter((value) => typeof value === "string");
}

function collectVariantSizes(variant: any): Array<{ type: string; size: string }> {
  const sizes: Array<{ type: string; size: string }> = [];
  if (variant?.size_eu) sizes.push({ type: "eu", size: String(variant.size_eu) });
  if (variant?.size_us) sizes.push({ type: "us", size: String(variant.size_us) });
  if (variant?.size) sizes.push({ type: "raw", size: String(variant.size) });
  if (Array.isArray(variant?.sizes)) {
    for (const entry of variant.sizes) {
      if (entry?.size) {
        sizes.push({ type: String(entry?.type ?? "raw").toLowerCase(), size: String(entry.size) });
      }
    }
  }
  return sizes;
}

function normalizeSizeForCompare(value?: string | null): string | null {
  const normalized = normalizeSize(value ?? null);
  if (!normalized) return null;
  return normalized.replace(/^EU/i, "").replace(/^US/i, "").trim();
}

function hasExactSizeMatch(variant: any, sizeRaw: string | null, targetType: "eu" | "us"): boolean {
  const target = normalizeSizeForCompare(sizeRaw ?? null);
  if (!target) return false;
  const sizes = collectVariantSizes(variant);
  return sizes.some((entry) => {
    const normalized = normalizeSizeForCompare(entry.size);
    if (!normalized) return false;
    if (targetType === "eu" && entry.type.includes("eu")) return normalized === target;
    if (targetType === "us" && entry.type.includes("us")) return normalized === target;
    return false;
  });
}

function scoreVariant(variant: any, sizeRaw: string | null): number {
  let score = 0;
  if (hasExactSizeMatch(variant, sizeRaw, "eu")) score += 30;
  else if (hasExactSizeMatch(variant, sizeRaw, "us")) score += 20;
  const gtin = extractVariantGtin(variant);
  if (validateGtin(gtin)) score += 10;
  return score;
}

function pickBestVariant(candidates: any[], sizeRaw: string | null): any | null {
  if (!candidates.length) return null;
  const scored = candidates
    .map((variant) => ({
      variant,
      score: scoreVariant(variant, sizeRaw),
      updatedAt: new Date(variant?.updated_at ?? variant?.updatedAt ?? 0).getTime(),
      id: String(variant?.id ?? ""),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.updatedAt !== a.updatedAt) return b.updatedAt - a.updatedAt;
      return a.id.localeCompare(b.id);
    });
  return scored[0]?.variant ?? null;
}

function pickString(...values: Array<unknown>) {
  for (const v of values) {
    if (typeof v === "string" && v.trim()) return v.trim();
  }
  return null;
}

function extractBrand(productRecord: any): string | null {
  const direct = pickString(productRecord?.brand, productRecord?.manufacturer, productRecord?.make);
  if (direct) return direct;
  const traits = productRecord?.traits;
  if (Array.isArray(traits)) {
    for (const t of traits) {
      const key = pickString(t?.key, t?.name, t?.trait, t?.type)?.toLowerCase();
      if (key && ["brand", "manufacturer"].includes(key)) {
        const value = pickString(t?.value, t?.label, t?.text);
        if (value) return value;
      }
    }
  }
  if (traits && typeof traits === "object") {
    return pickString(traits.brand, traits.Brand, traits.manufacturer, traits.Manufacturer);
  }
  return null;
}

function extractImageUrl(productRecord: any): string | null {
  return pickString(
    productRecord?.image,
    productRecord?.image_url,
    productRecord?.imageUrl,
    productRecord?.media?.image,
    productRecord?.media?.imageUrl
  );
}

function pickTraitValue(traits: unknown, keys: string[]): string | null {
  if (!traits) return null;
  const list = Array.isArray(traits) ? traits : (traits as any)?.traits ?? traits;
  const traitArray = Array.isArray(list) ? list : [];
  const lowerKeys = keys.map((key) => key.toLowerCase());
  for (const entry of traitArray) {
    const entryKey = pickString(entry?.key, entry?.name, entry?.trait, entry?.type)?.toLowerCase() ?? "";
    if (!entryKey) continue;
    if (lowerKeys.some((key) => entryKey.includes(key))) {
      return pickString(entry?.value, entry?.label, entry?.text, entry?.displayValue);
    }
  }
  return null;
}

function parseDateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeSkuForCompare(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

function extractSkuTokens(value: unknown): string[] {
  if (typeof value !== "string") return [];
  return value
    .split(/[\/,;|]/g)
    .map((token) => token.trim())
    .filter(Boolean);
}

function stripGtinSuffix(value: string): string {
  const trimmed = value.trim();
  const gtinMatch = trimmed.match(/^(.*?)-(\d{8,})$/);
  if (gtinMatch?.[1]) return gtinMatch[1].trim();
  return trimmed;
}

function stripSizeSuffix(value: string): string {
  const trimmed = value.trim();
  const sizeTokenMatch = trimmed.match(
    /^(.*?)-(XXXS|XXS|XS|S|M|L|XL|XXL|XXXL|OS|O\/S|ONE\s*SIZE)$/i
  );
  if (sizeTokenMatch?.[1]) return sizeTokenMatch[1].trim();
  const numericSizeMatch = trimmed.match(/^(.*?)-(EU|US|UK|ASIA)?\s*\d+(\.\d+)?$/i);
  if (numericSizeMatch?.[1]) return numericSizeMatch[1].trim();
  return trimmed;
}

function deriveSkuSearchQuery(value: string): string {
  const trimmed = value.trim();
  const noGtin = stripGtinSuffix(trimmed);
  if (noGtin !== trimmed) return noGtin;
  const noSize = stripSizeSuffix(trimmed);
  if (noSize !== trimmed) return noSize;
  return trimmed;
}

function buildSkuCandidates(value: string): string[] {
  const candidates = new Set<string>();
  const trimmed = value.trim();
  const add = (v: string) => {
    const normalized = normalizeSkuForCompare(v);
    if (normalized) candidates.add(normalized);
  };
  add(trimmed);
  const noGtin = stripGtinSuffix(trimmed);
  if (noGtin !== trimmed) add(noGtin);
  const noSize = stripSizeSuffix(trimmed);
  if (noSize !== trimmed) add(noSize);
  const noGtinNoSize = stripSizeSuffix(noGtin);
  if (noGtinNoSize !== noGtin) add(noGtinNoSize);
  return Array.from(candidates);
}

function selectBestKickdbHit(options: {
  hits: any[];
  supplierSku: string | null;
  supplierName: string | null;
  supplierBrand?: string | null;
}) {
  const hits = options.hits ?? [];
  if (!hits.length) return null;

  const supplierBrand = (options.supplierBrand ?? "").toLowerCase().trim();
  const brandFiltered = supplierBrand
    ? hits.filter((h) => String(h?.brand ?? "").toLowerCase().includes(supplierBrand))
    : hits;

  const supplierSku = options.supplierSku;
  if (supplierSku) {
    const candidates = buildSkuCandidates(supplierSku);
    const exact = brandFiltered.find((h) => {
      const rawValues = [
        h?.sku,
        h?.style_id,
        h?.styleId,
        h?.style,
        h?.style_code,
      ];
      const tokens = rawValues.flatMap((value) =>
        extractSkuTokens(value ?? null).map((token) => normalizeSkuForCompare(token))
      );
      return tokens.some((token) => candidates.includes(token));
    });
    if (exact) return exact;
    // Fallback when search results omit sku/style fields.
    return brandFiltered[0] ?? hits[0] ?? null;
  }

  // Fallback: if supplier name is available, pick first hit that shares strong token overlap.
  const name = (options.supplierName ?? "").toLowerCase();
  if (name) {
    const tokens = new Set(name.split(/[^a-z0-9]+/g).filter((t) => t.length >= 4));
    const scored = brandFiltered
      .map((h) => {
        const title = String(h?.title ?? "").toLowerCase();
        let score = 0;
        for (const t of tokens) {
          if (title.includes(t)) score += 1;
        }
        return { h, score };
      })
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.score > 0) return scored[0].h;
  }

  return brandFiltered[0] ?? hits[0] ?? null;
}

export async function runKickdbEnrich(options: KickdbEnrichOptions = {}) {
  const prismaAny = prisma as any;
  const limit =
    options.limit === null || options.limit === (undefined as unknown as number)
      ? null
      : Math.min(Number(options.limit ?? 50), 200);
  const offset = limit === null ? 0 : Math.max(Number(options.offset ?? 0), 0);
  const debug = Boolean(options.debug);
  const force = Boolean(options.force);
  const forceMissing = Boolean(options.forceMissing);
  const includeNotFound = Boolean(options.includeNotFound);
  const raw = Boolean(options.raw);
  const supplierVariantId = options.supplierVariantId?.trim() || null;
  const supplierSku = options.supplierSku?.trim() || null;
  const supplierVariantIdPrefix = options.supplierVariantIdPrefix?.trim() || null;

  let supplierVariants: any[] = [];

  if (supplierVariantId) {
    const match = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId },
    });
    if (!match) {
      throw new Error(`Supplier variant not found: ${supplierVariantId}`);
    }
    supplierVariants = [match];
  } else if (supplierSku) {
    const matches = await prisma.supplierVariant.findMany({
      where: { supplierSku },
      orderBy: { updatedAt: "desc" },
    });
    if (!matches.length) {
      throw new Error(`Supplier variant not found for SKU: ${supplierSku}`);
    }
    supplierVariants = matches;
  } else {
    const prefixFilter = supplierVariantIdPrefix
      ? Prisma.sql`AND sv."supplierVariantId" ILIKE ${`${supplierVariantIdPrefix}%`}`
      : Prisma.sql``;
    const statusFilter = includeNotFound
      ? Prisma.sql`(vm."supplierVariantId" IS NULL OR vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN','NOT_FOUND'))`
      : Prisma.sql`(vm."supplierVariantId" IS NULL OR vm."gtin" IS NULL OR vm."status" IN ('PENDING_GTIN','AMBIGUOUS_GTIN'))`;
    const limitClause = limit === null ? Prisma.sql`` : Prisma.sql`LIMIT ${limit} OFFSET ${offset}`;
    const candidates = await prisma.$queryRaw<Array<{ supplierVariantId: string }>>(Prisma.sql`
      SELECT sv."supplierVariantId"
      FROM "public"."SupplierVariant" sv
      LEFT JOIN "public"."VariantMapping" vm
        ON vm."supplierVariantId" = sv."supplierVariantId"
      WHERE ${statusFilter}
      ${prefixFilter}
      ORDER BY COALESCE(vm."updatedAt", sv."updatedAt") ASC
      ${limitClause}
    `);
    const candidateIds = candidates.map((row) => row.supplierVariantId).filter(Boolean);
    if (!candidateIds.length) {
      supplierVariants = [];
    } else {
      const fetched = await prisma.supplierVariant.findMany({
        where: { supplierVariantId: { in: candidateIds } },
      });
      const byId = new Map(fetched.map((variant) => [variant.supplierVariantId, variant]));
      supplierVariants = candidateIds
        .map((id) => byId.get(id))
        .filter((variant): variant is NonNullable<typeof variant> => Boolean(variant));
    }
  }

  const results: Array<{
    supplierVariantId: string;
    status: string;
    gtin?: string | null;
    gtinCandidates?: string[];
    error?: string;
    debug?: DebugInfo;
  }> = [];
  const needsProductName = supplierVariants.some((variant) => !variant.supplierSku);
  const productNameByVariantId = new Map<string, string>();
  if (needsProductName) {
    const supplierClient = createGoldenSupplierClient();
    const catalog = await supplierClient.fetchCatalog();
    for (const item of catalog) {
      if (item.sourcePayload.product_name) {
        productNameByVariantId.set(item.supplierVariantId, item.sourcePayload.product_name);
      }
    }
  }

  for (const variant of supplierVariants) {
    const variantId = variant.supplierVariantId;
    const variantSku = variant.supplierSku ?? null;
    const variantBrand = (variant as any)?.supplierBrand ?? null;
    const variantName =
      productNameByVariantId.get(variant.supplierVariantId) ?? variant?.supplierProductName ?? null;
    const mappingWhere = { supplierVariantId: variant.supplierVariantId };

    const mapping = await prismaAny.variantMapping.findUnique({
      where: mappingWhere as any,
    });
    const mappingStatus = String(mapping?.status ?? "");
    const mappingGtinRaw = mapping?.gtin ?? null;
    const mappingGtin = mappingGtinRaw && validateGtin(mappingGtinRaw) ? mappingGtinRaw : null;
    const variantGtinRaw = variant?.gtin ?? null;
    const variantGtin = variantGtinRaw && validateGtin(variantGtinRaw) ? variantGtinRaw : null;
    const supplierGtin =
      mappingGtin && mappingStatus === "SUPPLIER_GTIN" ? mappingGtin : null;
    const mappingCreateBase = { supplierVariantId: variant.supplierVariantId };
    const providerKeySourceId = variant.supplierVariantId;
    const existingGtin = mappingGtin ?? variantGtin ?? null;
    if (existingGtin) {
      const normalizedStatus = mappingStatus === "SUPPLIER_GTIN" ? "SUPPLIER_GTIN" : "MATCHED";
      const providerKey = buildProviderKey(existingGtin, providerKeySourceId);
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: existingGtin,
        providerKey,
        status: normalizedStatus,
      });
      const needsMappingUpdate =
        !mapping ||
        mapping.gtin !== existingGtin ||
        mapping.providerKey !== providerKey ||
        mappingStatus === "PENDING_GTIN" ||
        mappingStatus === "AMBIGUOUS_GTIN";
      if (needsMappingUpdate) {
        await prismaAny.variantMapping.upsert({
          where: mappingWhere as any,
          create: {
            ...(mappingCreateBase as any),
            gtin: existingGtin,
            providerKey,
            status: normalizedStatus,
          },
          update: {
            gtin: existingGtin,
            providerKey,
            status: normalizedStatus,
          },
        });
      }
      if (variant?.gtin !== existingGtin || variant?.providerKey !== providerKey) {
        await prismaAny.supplierVariant.update({
          where: { supplierVariantId: variant.supplierVariantId },
          data: {
            gtin: existingGtin,
            providerKey,
          },
        });
      }
      const hasKickdbVariant = Boolean(mapping?.kickdbVariantId);
      if (!force && hasKickdbVariant) {
        results.push({
          supplierVariantId: variant.supplierVariantId,
          status: "SKIPPED_HAS_GTIN",
          gtin: existingGtin,
          debug: debug
            ? {
                reason: "SKIPPED_HAS_GTIN",
                force,
                sizeRaw: variant.sizeRaw,
                supplierSku: variantSku ?? undefined,
              }
            : undefined,
        });
        continue;
      }
    }

    if (!existingGtin && mapping?.providerKey) {
      const normalizedStatus = mappingStatus === "AMBIGUOUS_GTIN" ? "AMBIGUOUS_GTIN" : "PENDING_GTIN";
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: null,
        providerKey: null,
        status: normalizedStatus,
      });
      await prismaAny.variantMapping.update({
        where: mappingWhere as any,
        data: { gtin: null, providerKey: null, status: normalizedStatus },
      });
    }

    const shouldBypassCache =
      force || (forceMissing && (!mappingGtin || mappingStatus === "PENDING_GTIN" || mappingStatus === "AMBIGUOUS_GTIN"));
    if (
      !shouldBypassCache
      && !shouldFetchKickDb({
        lastFetchedAt: mapping?.updatedAt ?? null,
        notFound: mapping?.status === "NOT_FOUND",
        missingGtin: !mappingGtin,
      })
    ) {
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "SKIPPED",
        debug: debug
          ? {
              reason: "SKIPPED_CACHE",
              force,
              sizeRaw: variant.sizeRaw,
              supplierSku: variantSku ?? undefined,
            }
          : undefined,
      });
      continue;
    }

    const supplierProductName = variantName ?? variant?.supplierProductName ?? null;
    const query = variantSku ? deriveSkuSearchQuery(variantSku) : supplierProductName;
    const debugInfo: DebugInfo | undefined = debug
      ? {
          query: query ?? undefined,
          force,
          raw,
          sizeRaw: variant.sizeRaw,
          supplierSku: variantSku ?? undefined,
          productName: supplierProductName ?? null,
        }
      : undefined;

    if (!query) {
      if (supplierGtin) {
        results.push({
          supplierVariantId: variant.supplierVariantId,
          status: "SUPPLIER_GTIN",
          gtin: supplierGtin,
          debug: debugInfo ? { ...debugInfo, reason: "NO_QUERY_SUPPLIER_GTIN" } : undefined,
        });
        continue;
      }
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: null,
        providerKey: null,
        status: "PENDING_GTIN",
      });
      await prismaAny.variantMapping.upsert({
        where: mappingWhere as any,
        create: {
          ...(mappingCreateBase as any),
          gtin: null,
          providerKey: null,
          status: "PENDING_GTIN",
        },
        update: {
          gtin: null,
          providerKey: null,
          status: "PENDING_GTIN",
        },
      });
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "PENDING_GTIN",
        debug: debugInfo ? { ...debugInfo, reason: "NO_QUERY" } : undefined,
      });
      continue;
    }

    let response: { data?: any[]; meta?: { total?: number } };
    try {
      response = await searchStockxProducts(query);
    } catch (error: any) {
      const message = error?.message ?? "KickDB search failed";
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "ERROR",
        error: message,
        debug: debugInfo ? { ...debugInfo, reason: "SEARCH_ERROR", error: message } : undefined,
      });
      continue;
    }

    const hits = response.data ?? [];
    const productHit = selectBestKickdbHit({
      hits,
      supplierSku: variantSku ?? null,
      supplierName: supplierProductName ?? null,
      supplierBrand: variantBrand ?? null,
    });
    const productIdOrSlug = productHit?.id ?? productHit?.slug;
    if (debugInfo) {
      debugInfo.searchMeta = response.meta;
      debugInfo.searchTop = productHit
        ? {
            id: productHit.id,
            slug: productHit.slug,
            title: productHit.title,
            sku: productHit.sku,
          }
        : null;
      if (raw) {
        debugInfo.rawSearch = response;
      }
    }

    if (!productIdOrSlug) {
      if (supplierGtin) {
        results.push({
          supplierVariantId: variant.supplierVariantId,
          status: "SUPPLIER_GTIN",
          gtin: supplierGtin,
          debug: debugInfo
            ? {
                ...debugInfo,
                reason: variantSku ? "SKU_NO_MATCH_SUPPLIER_GTIN" : "NO_RESULTS_SUPPLIER_GTIN",
              }
            : undefined,
        });
        continue;
      }
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: null,
        providerKey: null,
        status: "PENDING_GTIN",
      });
      await prismaAny.variantMapping.upsert({
        where: mappingWhere as any,
        create: {
          ...(mappingCreateBase as any),
          gtin: null,
          providerKey: null,
          status: "NOT_FOUND",
        },
        update: {
          gtin: null,
          providerKey: null,
          status: "NOT_FOUND",
        },
      });
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "NOT_FOUND",
        debug: debugInfo
          ? {
              ...debugInfo,
              reason: variantSku ? "SKU_NO_MATCH" : "NO_RESULTS",
            }
          : undefined,
      });
      continue;
    }

    let productResponse: any;
    try {
      productResponse = raw
        ? await fetchStockxProductByIdOrSlugRaw(productIdOrSlug)
        : await fetchStockxProductByIdOrSlug(productIdOrSlug);
    } catch (error: any) {
      const message = error?.message ?? "KickDB product fetch failed";
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "ERROR",
        error: message,
        debug: debugInfo ? { ...debugInfo, reason: "PRODUCT_ERROR", error: message } : undefined,
      });
      continue;
    }

    const productRecord = productResponse?.data ?? productResponse;
    if (!productRecord) {
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: null,
        providerKey: null,
        status: "NOT_FOUND",
      });
      await prismaAny.variantMapping.upsert({
        where: mappingWhere as any,
        create: {
          ...(mappingCreateBase as any),
          gtin: null,
          providerKey: null,
          status: "NOT_FOUND",
        },
        update: {
          gtin: null,
          providerKey: null,
          status: "NOT_FOUND",
        },
      });
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "NOT_FOUND",
        debug: debugInfo ? { ...debugInfo, reason: "PRODUCT_EMPTY" } : undefined,
      });
      continue;
    }

    if (debugInfo) {
      debugInfo.productRecordId = productRecord?.id ?? null;
      debugInfo.kickdbProductId = productRecord?.id ?? null;
      debugInfo.productSummary = productRecord
        ? {
            id: productRecord.id,
            slug: productRecord.slug,
            title: productRecord.title,
            sku: productRecord.sku,
            variantCount: productRecord?.variants?.length ?? 0,
          }
        : null;
      if (raw) {
        debugInfo.rawProduct = productResponse;
      }
    }

    const traits = productRecord?.traits ?? null;
    const matchBrand = extractBrand(productRecord);
    const matchGender =
      pickString(productRecord?.gender, productRecord?.sex) ?? pickTraitValue(traits, ["gender"]);
    const matchedVariants = matchVariantsBySize(productRecord?.variants ?? [], variant.sizeRaw ?? undefined, {
      brand: matchBrand,
      gender: matchGender,
    });
    const matchedVariant = pickBestVariant(matchedVariants, variant.sizeRaw ?? null);
    const gtinCandidates = Array.from(
      new Set(
        matchedVariants
          .map((item) => extractVariantGtin(item))
          .filter((value): value is string => Boolean(value && validateGtin(value)))
      )
    );
    if (debugInfo) {
      debugInfo.matchedVariant = summarizeVariant(matchedVariant);
      debugInfo.variantSizes = summarizeVariantSizes(productRecord?.variants ?? []);
    }

    const gtin = validateGtin(extractVariantGtin(matchedVariant ?? undefined))
      ? extractVariantGtin(matchedVariant ?? undefined)
      : null;
    const supplierGtinValid = supplierGtin && validateGtin(supplierGtin) ? supplierGtin : null;
    const resolvedGtin = supplierGtinValid ?? gtin ?? existingGtin ?? null;
    const isAmbiguous = !supplierGtinValid && !existingGtin && gtinCandidates.length > 1;
    const finalGtin = isAmbiguous ? null : resolvedGtin;
    const providerKey = buildProviderKey(finalGtin ?? null, providerKeySourceId);

    // Persist KickDB product + variant so Stage-2 exports can use brand/title/category/images.
    const now = new Date();
    const kickdbProductId = pickString(productRecord?.id, productIdOrSlug) ?? productIdOrSlug;
    const kickdbProductName = pickString(productRecord?.title, productRecord?.name);
    const styleId = pickString(productRecord?.sku, productRecord?.style_id, productRecord?.styleId);
    const urlKey = pickString(productRecord?.slug, productRecord?.url_key, productRecord?.urlKey);
    const brand = extractBrand(productRecord);
    const imageUrl = extractImageUrl(productRecord);

    const retailPriceRaw = pickTraitValue(traits, ["retail price", "rrp", "msrp"]);
    const releaseDateRaw = pickTraitValue(traits, ["release date"]);
    const colorway = pickTraitValue(traits, ["colorway", "colourway", "color"]);
    const countryOfManufacture =
      pickString(productRecord?.country_of_manufacture, productRecord?.countryOfManufacture) ??
      pickTraitValue(traits, ["country of manufacture", "country"]) ??
      null;
    const gender = pickString(productRecord?.gender, productRecord?.sex) ?? pickTraitValue(traits, ["gender"]);
    const description = pickString(
      productRecord?.description,
      productRecord?.short_description,
      productRecord?.product_description
    );
    const retailPrice = retailPriceRaw ? Number(retailPriceRaw) : null;
    const releaseDate = parseDateValue(releaseDateRaw);

    const savedProduct = await (prisma as any).kickDBProduct.upsert({
      where: { kickdbProductId },
      create: {
        kickdbProductId,
        urlKey,
        styleId,
        name: kickdbProductName,
        brand,
        imageUrl,
        traitsJson: traits,
        description,
        gender,
        colorway,
        countryOfManufacture,
        releaseDate,
        retailPrice: Number.isFinite(retailPrice ?? NaN) ? retailPrice : null,
        lastFetchedAt: now,
        notFound: false,
      },
      update: {
        urlKey,
        styleId,
        name: kickdbProductName,
        brand,
        imageUrl,
        traitsJson: traits,
        description,
        gender,
        colorway,
        countryOfManufacture,
        releaseDate,
        retailPrice: Number.isFinite(retailPrice ?? NaN) ? retailPrice : null,
        lastFetchedAt: now,
        notFound: false,
      },
    });

    // Backfill missing supplier fields from KickDB for partner CSVs.
    const updateSupplier: Record<string, unknown> = {};
    if (!variant.supplierProductName && kickdbProductName) {
      updateSupplier.supplierProductName = kickdbProductName;
    }
    if (!variant.supplierBrand && brand) {
      updateSupplier.supplierBrand = brand;
    }
    const hasImages =
      Array.isArray(variant.images) ? variant.images.length > 0 : Boolean(variant.images);
    if (!hasImages && imageUrl) {
      updateSupplier.images = [imageUrl];
    }
    if (Object.keys(updateSupplier).length > 0) {
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: variant?.gtin ?? null,
        providerKey: variant?.providerKey ?? null,
        status: variant?.gtin ? "MATCHED" : "PENDING_GTIN",
      });
      await prismaAny.supplierVariant.update({
        where: { supplierVariantId: variant.supplierVariantId },
        data: updateSupplier,
      });
    }

    const kickdbVariantExternalId =
      pickString(matchedVariant?.id) ??
      (kickdbProductId ? `${kickdbProductId}:${variantId}` : variantId);
    const savedVariant = await prisma.kickDBVariant.upsert({
      where: { kickdbVariantId: kickdbVariantExternalId },
      create: {
        kickdbVariantId: kickdbVariantExternalId,
        productId: savedProduct.id,
        sizeUs: pickString(matchedVariant?.size_us),
        sizeEu: pickString(matchedVariant?.size_eu),
        gtin: pickString(finalGtin),
        ean: pickString(matchedVariant?.ean),
        providerKey: providerKey ?? null,
        lastFetchedAt: now,
        notFound: false,
      },
      update: {
        productId: savedProduct.id,
        sizeUs: pickString(matchedVariant?.size_us),
        sizeEu: pickString(matchedVariant?.size_eu),
        gtin: pickString(finalGtin),
        ean: pickString(matchedVariant?.ean),
        providerKey: providerKey ?? null,
        lastFetchedAt: now,
        notFound: false,
      },
    });

    const resolvedStatus = supplierGtinValid
      ? "SUPPLIER_GTIN"
      : isAmbiguous
        ? "AMBIGUOUS_GTIN"
        : finalGtin
          ? "MATCHED"
          : "NOT_FOUND";
    assertMappingIntegrity({
      supplierVariantId: variant.supplierVariantId,
      gtin: finalGtin ?? null,
      providerKey: providerKey ?? null,
      status: resolvedStatus,
    });
    await prismaAny.variantMapping.upsert({
      where: mappingWhere as any,
      create: {
        ...(mappingCreateBase as any),
        kickdbVariantId: savedVariant.id,
        gtin: finalGtin ?? null,
        providerKey: providerKey ?? null,
        status: resolvedStatus,
      },
      update: {
        kickdbVariantId: savedVariant.id,
        gtin: finalGtin ?? null,
        providerKey: providerKey ?? null,
        status: resolvedStatus,
      },
    });

    if (finalGtin) {
      try {
        await prismaAny.supplierVariant.update({
          where: { supplierVariantId: variant.supplierVariantId },
          data: {
            gtin: finalGtin,
            providerKey: providerKey ?? null,
          },
        });
      } catch (error: any) {
        if (error?.code === "P2002" && providerKey) {
          const existing = await prismaAny.supplierVariant.findFirst({
            where: { providerKey, gtin: finalGtin },
            select: { supplierVariantId: true },
          });
          if (existing?.supplierVariantId && existing.supplierVariantId !== variant.supplierVariantId) {
            const targetMappingExists = await prismaAny.variantMapping.findUnique({
              where: { supplierVariantId: existing.supplierVariantId },
              select: { id: true },
            });
            if (targetMappingExists) {
              await prismaAny.variantMapping.deleteMany({
                where: { supplierVariantId: variant.supplierVariantId },
              });
            } else {
              await prismaAny.variantMapping.updateMany({
                where: { supplierVariantId: variant.supplierVariantId },
                data: { supplierVariantId: existing.supplierVariantId },
              });
            }
          }
        } else {
          throw error;
        }
      }
    } else if (variant?.providerKey) {
      assertMappingIntegrity({
        supplierVariantId: variant.supplierVariantId,
        gtin: null,
        providerKey: null,
        status: resolvedStatus === "AMBIGUOUS_GTIN" ? "AMBIGUOUS_GTIN" : "PENDING_GTIN",
      });
      await prismaAny.supplierVariant.update({
        where: { supplierVariantId: variant.supplierVariantId },
        data: {
          providerKey: null,
        },
      });
    }

    results.push({
      supplierVariantId: variant.supplierVariantId,
      status: resolvedStatus,
      gtin: finalGtin ?? null,
      gtinCandidates: gtinCandidates.length ? gtinCandidates : undefined,
      debug: debugInfo
        ? {
            ...debugInfo,
          reason: supplierGtinValid
            ? "SUPPLIER_GTIN_KEEP"
            : isAmbiguous
              ? "AMBIGUOUS_GTIN"
              : finalGtin
                ? "MATCHED"
                : "NO_GTIN",
          }
        : undefined,
    });
  }

  return { results, limit, offset };
}
