import { prisma } from "@/app/lib/prisma";
import { createGoldenSupplierClient } from "@/galaxus/supplier/client";
import {
  fetchStockxProductByIdOrSlug,
  fetchStockxProductByIdOrSlugRaw,
  matchVariantBySize,
  extractVariantGtin,
  searchStockxProducts,
} from "@/galaxus/kickdb/client";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";
import { shouldFetchKickDb } from "@/galaxus/kickdb/cache";

export type KickdbEnrichOptions = {
  limit?: number;
  offset?: number;
  debug?: boolean;
  force?: boolean;
  raw?: boolean;
  supplierVariantId?: string | null;
  supplierSku?: string | null;
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
}) {
  const hits = options.hits ?? [];
  if (!hits.length) return null;

  const supplierSku = options.supplierSku;
  if (supplierSku) {
    const candidates = buildSkuCandidates(supplierSku);
    const exact = hits.find((h) => candidates.includes(normalizeSkuForCompare(h?.sku)));
    return exact ?? null;
  }

  // Fallback: if supplier name is available, pick first hit that shares strong token overlap.
  const name = (options.supplierName ?? "").toLowerCase();
  if (name) {
    const tokens = new Set(name.split(/[^a-z0-9]+/g).filter((t) => t.length >= 4));
    const scored = hits
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

  return hits[0];
}

export async function runKickdbEnrich(options: KickdbEnrichOptions = {}) {
  const limit = Math.min(Number(options.limit ?? 50), 200);
  const offset = Math.max(Number(options.offset ?? 0), 0);
  const debug = Boolean(options.debug);
  const force = Boolean(options.force);
  const raw = Boolean(options.raw);
  const supplierVariantId = options.supplierVariantId?.trim() || null;
  const supplierSku = options.supplierSku?.trim() || null;

  let supplierVariants = [];
  if (supplierVariantId) {
    const match = await prisma.supplierVariant.findUnique({
      where: { supplierVariantId },
    });
    if (!match) {
      throw new Error(`Supplier variant not found: ${supplierVariantId}`);
    }
    supplierVariants = [match];
  } else if (supplierSku) {
    const match = await prisma.supplierVariant.findFirst({
      where: { supplierSku },
      orderBy: { updatedAt: "desc" },
    });
    if (!match) {
      throw new Error(`Supplier variant not found for SKU: ${supplierSku}`);
    }
    supplierVariants = [match];
  } else {
    supplierVariants = await prisma.supplierVariant.findMany({
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });
  }

  const results: Array<{
    supplierVariantId: string;
    status: string;
    gtin?: string | null;
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
    const mapping = await prisma.variantMapping.findUnique({
      where: { supplierVariantId: variant.supplierVariantId },
    });
    const supplierGtin =
      mapping?.status === "SUPPLIER_GTIN" && mapping?.gtin ? mapping.gtin : null;

    if (
      !force
      && !shouldFetchKickDb({ lastFetchedAt: mapping?.updatedAt ?? null, notFound: mapping?.status === "NOT_FOUND" })
    ) {
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "SKIPPED",
        debug: debug
          ? {
              reason: "SKIPPED_CACHE",
              force,
              sizeRaw: variant.sizeRaw,
              supplierSku: variant.supplierSku,
            }
          : undefined,
      });
      continue;
    }

    const supplierProductName = productNameByVariantId.get(variant.supplierVariantId) ?? null;
    const query = variant.supplierSku
      ? deriveSkuSearchQuery(variant.supplierSku)
      : supplierProductName;
    const debugInfo: DebugInfo | undefined = debug
      ? {
          query: query ?? undefined,
          force,
          raw,
          sizeRaw: variant.sizeRaw,
          supplierSku: variant.supplierSku,
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
      await prisma.variantMapping.upsert({
        where: { supplierVariantId: variant.supplierVariantId },
        create: {
          supplierVariantId: variant.supplierVariantId,
          gtin: null,
          status: "NOT_FOUND",
        },
        update: {
          gtin: null,
          status: "NOT_FOUND",
        },
      });
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "NOT_FOUND",
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
      supplierSku: variant.supplierSku ?? null,
      supplierName: supplierProductName ?? null,
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
                reason: variant.supplierSku ? "SKU_NO_MATCH_SUPPLIER_GTIN" : "NO_RESULTS_SUPPLIER_GTIN",
              }
            : undefined,
        });
        continue;
      }
      await prisma.variantMapping.upsert({
        where: { supplierVariantId: variant.supplierVariantId },
        create: {
          supplierVariantId: variant.supplierVariantId,
          gtin: null,
          status: "NOT_FOUND",
        },
        update: {
          gtin: null,
          status: "NOT_FOUND",
        },
      });
      results.push({
        supplierVariantId: variant.supplierVariantId,
        status: "NOT_FOUND",
        debug: debugInfo
          ? {
              ...debugInfo,
              reason: variant.supplierSku ? "SKU_NO_MATCH" : "NO_RESULTS",
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
    const matchedVariant = matchVariantBySize(productRecord?.variants ?? [], variant.sizeRaw ?? undefined, {
      brand: matchBrand,
      gender: matchGender,
    });
    if (debugInfo) {
      debugInfo.matchedVariant = summarizeVariant(matchedVariant);
      debugInfo.variantSizes = summarizeVariantSizes(productRecord?.variants ?? []);
    }

    const gtin = extractVariantGtin(matchedVariant ?? undefined);
    const resolvedGtin = supplierGtin ?? gtin ?? null;
    const providerKey = buildProviderKey(resolvedGtin ?? null, variant.supplierVariantId);

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

    const kickdbVariantExternalId =
      pickString(matchedVariant?.id) ??
      (kickdbProductId ? `${kickdbProductId}:${variant.supplierVariantId}` : variant.supplierVariantId);
    const savedVariant = await prisma.kickDBVariant.upsert({
      where: { kickdbVariantId: kickdbVariantExternalId },
      create: {
        kickdbVariantId: kickdbVariantExternalId,
        productId: savedProduct.id,
        sizeUs: pickString(matchedVariant?.size_us),
        sizeEu: pickString(matchedVariant?.size_eu),
        gtin: pickString(gtin),
        ean: pickString(matchedVariant?.ean),
        providerKey: providerKey ?? null,
        lastFetchedAt: now,
        notFound: false,
      },
      update: {
        productId: savedProduct.id,
        sizeUs: pickString(matchedVariant?.size_us),
        sizeEu: pickString(matchedVariant?.size_eu),
        gtin: pickString(gtin),
        ean: pickString(matchedVariant?.ean),
        providerKey: providerKey ?? null,
        lastFetchedAt: now,
        notFound: false,
      },
    });

    await prisma.variantMapping.upsert({
      where: { supplierVariantId: variant.supplierVariantId },
      create: {
        supplierVariantId: variant.supplierVariantId,
        kickdbVariantId: savedVariant.id,
        gtin: resolvedGtin ?? null,
        providerKey: providerKey ?? null,
        status: supplierGtin ? "SUPPLIER_GTIN" : gtin ? "MATCHED" : "NOT_FOUND",
      },
      update: {
        kickdbVariantId: savedVariant.id,
        gtin: resolvedGtin ?? null,
        providerKey: providerKey ?? null,
        status: supplierGtin ? "SUPPLIER_GTIN" : gtin ? "MATCHED" : "NOT_FOUND",
      },
    });

    results.push({
      supplierVariantId: variant.supplierVariantId,
      status: supplierGtin ? "SUPPLIER_GTIN" : gtin ? "MATCHED" : "NOT_FOUND",
      gtin: resolvedGtin ?? null,
      debug: debugInfo
        ? { ...debugInfo, reason: supplierGtin ? "SUPPLIER_GTIN_KEEP" : gtin ? "MATCHED" : "NO_GTIN" }
        : undefined,
    });
  }

  return { results, limit, offset };
}
