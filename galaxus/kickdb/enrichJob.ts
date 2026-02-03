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

    const productName = productNameByVariantId.get(variant.supplierVariantId) ?? null;
    const query = variant.supplierSku || productName;
    const debugInfo: DebugInfo | undefined = debug
      ? {
          query: query ?? undefined,
          force,
          raw,
          sizeRaw: variant.sizeRaw,
          supplierSku: variant.supplierSku,
          productName: productName ?? null,
        }
      : undefined;

    if (!query) {
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

    const productHit = response.data?.[0];
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
        debug: debugInfo ? { ...debugInfo, reason: "NO_RESULTS" } : undefined,
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

    const matchedVariant = matchVariantBySize(productRecord?.variants ?? [], variant.sizeRaw ?? undefined);
    if (debugInfo) {
      debugInfo.matchedVariant = summarizeVariant(matchedVariant);
      debugInfo.variantSizes = summarizeVariantSizes(productRecord?.variants ?? []);
    }

    const gtin = extractVariantGtin(matchedVariant ?? undefined);
    const providerKey = buildProviderKey(gtin ?? null, variant.supplierVariantId);

    await prisma.variantMapping.upsert({
      where: { supplierVariantId: variant.supplierVariantId },
      create: {
        supplierVariantId: variant.supplierVariantId,
        gtin: gtin ?? null,
        providerKey: providerKey ?? null,
        status: gtin ? "MATCHED" : "NOT_FOUND",
      },
      update: {
        gtin: gtin ?? null,
        providerKey: providerKey ?? null,
        status: gtin ? "MATCHED" : "NOT_FOUND",
      },
    });

    results.push({
      supplierVariantId: variant.supplierVariantId,
      status: gtin ? "MATCHED" : "NOT_FOUND",
      gtin: gtin ?? null,
      debug: debugInfo ? { ...debugInfo, reason: gtin ? "MATCHED" : "NO_GTIN" } : undefined,
    });
  }

  return { results, limit, offset };
}
