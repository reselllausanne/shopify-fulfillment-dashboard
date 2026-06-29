import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { extractVariantGtin, fetchStockxProductByIdOrSlugRaw } from "@/galaxus/kickdb/client";
import {
  bulkInsertSupplierVariants,
  bulkUpdateSupplierVariants,
  bulkUpsertVariantMappings,
  remapRowsToExistingProviderKeyGtin,
} from "@/galaxus/jobs/bulkSql";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { estimatedStockxBuyChfFromList } from "@/galaxus/stx/chfStockxBuyPrice";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";
import { calcSuggestedRetailFromStxOffer } from "@/galaxus/pricing/suggestedSellPrice";
import { isStxForceImportSlug } from "@/galaxus/stx/forceImportSlugs";
import { selectStxOfferForImport, type StxDeliveryType } from "@/galaxus/stx/offerSelection";

type ImportPreviewVariant = {
  supplierVariantId: string;
  size: string | null;
  deliveryType: StxDeliveryType;
  price: number;
  stock: number;
};

type ImportProductSummary = {
  input: string;
  normalizedInput: string;
  kickdbProductId: string | null;
  slug: string | null;
  styleId: string | null;
  name: string | null;
  brand: string | null;
  image: string | null;
};

export type StxImportDiagnostics = {
  kickdbFetchOk: boolean;
  kickdbHttpStatus?: number | null;
  kickdbError?: string | null;
  variantsTotal: number;
  variantsParsed: number;
  variantsEligible: number;
  forceImport: boolean;
  skipReasons: {
    missingVariantId: number;
    noUsablePrice: number;
    invalidGtin: number;
    missingImages: number;
  };
  samplePriceRows?: string[];
};

export type StxImportResult = {
  ok: boolean;
  productSummary: ImportProductSummary;
  importedVariantsCount: number;
  eligibleVariantsCount: number;
  warnings: string[];
  errors: string[];
  diagnostics: StxImportDiagnostics;
  variantsPreview: ImportPreviewVariant[];
};

type ParsedVariantRow = {
  supplierVariantId: string;
  supplierSku: string;
  providerKey: string | null;
  gtin: string | null;
  price: number;
  stock: number;
  sizeRaw: string | null;
  supplierBrand: string | null;
  supplierProductName: string | null;
  images: unknown;
  leadTimeDays: number | null;
  deliveryType: StxDeliveryType;
  suggestedRetailPriceInclVat: number | null;
  kickdbVariantExternalId: string;
  sizeUs: string | null;
  sizeEu: string | null;
  ean: string | null;
};

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

function pickImages(product: any): string[] | null {
  const images: string[] = [];
  if (Array.isArray(product?.gallery)) {
    for (const image of product.gallery) {
      const value = pickString(image);
      if (value) images.push(value);
    }
  }
  const fallback = pickString(product?.image, product?.image_url, product?.imageUrl);
  if (images.length === 0 && fallback) images.push(fallback);
  return images.length > 0 ? Array.from(new Set(images)) : null;
}

function pickSizeRawEuFirst(variant: any): string | null {
  const directEu = pickString(variant?.size_eu);
  if (directEu) return directEu;
  const sizes = Array.isArray(variant?.sizes) ? variant.sizes : [];
  for (const entry of sizes) {
    const type = String(entry?.type ?? "").toLowerCase();
    if (type === "eu") {
      const size = pickString(entry?.size);
      if (size) return size;
    }
  }
  return pickString(variant?.size);
}

export function normalizeStxImportInput(input: string): string {
  const value = input.trim();
  if (!value) return "";
  if (!/^https?:\/\//i.test(value)) return value;
  try {
    const parsed = new URL(value);
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return value;
    const productIdx = parts.findIndex((item) => item.toLowerCase() === "products");
    if (productIdx >= 0 && parts[productIdx + 1]) return decodeURIComponent(parts[productIdx + 1]);
    return decodeURIComponent(parts[parts.length - 1]);
  } catch {
    return value;
  }
}

export function emptyDiagnostics(overrides: Partial<StxImportDiagnostics> = {}): StxImportDiagnostics {
  return {
    kickdbFetchOk: false,
    kickdbHttpStatus: null,
    kickdbError: null,
    variantsTotal: 0,
    variantsParsed: 0,
    variantsEligible: 0,
    forceImport: false,
    skipReasons: {
      missingVariantId: 0,
      noUsablePrice: 0,
      invalidGtin: 0,
      missingImages: 0,
    },
    samplePriceRows: [],
    ...overrides,
  };
}

function summarizePriceRows(prices: unknown, limit = 4): string {
  const list = Array.isArray(prices) ? prices : [];
  return list
    .slice(0, limit)
    .map((row) => {
      const item = row as Record<string, unknown>;
      const type = String(item?.type ?? "?");
      const price = item?.price ?? "?";
      const asks = item?.asks ?? "?";
      return `${type}:${price}/${asks}asks`;
    })
    .join("; ");
}

function formatImportFailureSummary(diagnostics: StxImportDiagnostics): string {
  const parts = [
    `variants ${diagnostics.variantsParsed}/${diagnostics.variantsTotal} parsed`,
    `eligible ${diagnostics.variantsEligible}`,
  ];
  const skips = diagnostics.skipReasons;
  if (skips.noUsablePrice > 0) parts.push(`${skips.noUsablePrice} no express/usable price`);
  if (skips.invalidGtin > 0) parts.push(`${skips.invalidGtin} invalid/missing GTIN`);
  if (skips.missingImages > 0) parts.push(`${skips.missingImages} missing images`);
  if (skips.missingVariantId > 0) parts.push(`${skips.missingVariantId} missing variant id`);
  if (diagnostics.forceImport) parts.push("force-import slug");
  return parts.join(" · ");
}

function failedImportResult(input: {
  input: string;
  normalizedInput: string;
  productSummary: Partial<ImportProductSummary>;
  warnings: string[];
  errors: string[];
  diagnostics: StxImportDiagnostics;
  eligibleVariantsCount?: number;
  variantsPreview?: ImportPreviewVariant[];
}): StxImportResult {
  const errors = [...input.errors];
  if (errors.length === 0) errors.push("STX import failed.");
  errors.unshift(`Summary: ${formatImportFailureSummary(input.diagnostics)}`);

  return {
    ok: false,
    productSummary: {
      input: input.input,
      normalizedInput: input.normalizedInput,
      kickdbProductId: input.productSummary.kickdbProductId ?? null,
      slug: input.productSummary.slug ?? null,
      styleId: input.productSummary.styleId ?? null,
      name: input.productSummary.name ?? null,
      brand: input.productSummary.brand ?? null,
      image: input.productSummary.image ?? null,
    },
    importedVariantsCount: 0,
    eligibleVariantsCount: input.eligibleVariantsCount ?? 0,
    warnings: input.warnings,
    errors,
    diagnostics: input.diagnostics,
    variantsPreview: input.variantsPreview ?? [],
  };
}

function parseDateValue(value: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pickTraitValue(traits: unknown, keys: string[]): string | null {
  if (!Array.isArray(traits)) return null;
  const wanted = keys.map((key) => key.toLowerCase());
  for (const item of traits) {
    const key = pickString((item as any)?.key, (item as any)?.name, (item as any)?.trait)?.toLowerCase();
    if (!key) continue;
    if (wanted.some((value) => key.includes(value))) {
      return pickString((item as any)?.value, (item as any)?.label, (item as any)?.text);
    }
  }
  return null;
}

function runRegionHook(
  product: any,
  options?: { forcedMarket?: string }
): { blocked: boolean; warnings: string[]; errors: string[] } {
  const warnings: string[] = [];
  const errors: string[] = [];
  const forced = options?.forcedMarket?.toUpperCase().trim() || null;
  const market = pickString(product?.market, product?.region, product?.country, product?.countryCode);

  if (!market) {
    if (!forced) {
      warnings.push("Region/market not detected from KickDB payload (no blocking applied).");
    }
    return { blocked: false, warnings, errors };
  }

  const normalized = market.toUpperCase();
  if (forced && normalized !== forced) {
    errors.push(`Blocked by region hook: expected market ${forced}, got "${market}".`);
    return { blocked: true, warnings, errors };
  }
  const blocked =
    normalized === "US" ||
    normalized === "USA" ||
    normalized === "CA" ||
    normalized.includes("NORTH_AMERICA");
  if (blocked) {
    errors.push(`Blocked by region hook: market/country "${market}" is not eligible.`);
  }
  return { blocked, warnings, errors };
}

export async function importStxProductByInput(input: string): Promise<StxImportResult> {
  const warnings: string[] = [];
  const errors: string[] = [];
  const normalizedInput = normalizeStxImportInput(input);
  const diagnostics = emptyDiagnostics();

  if (!normalizedInput) {
    return failedImportResult({
      input,
      normalizedInput,
      productSummary: {},
      warnings,
      errors: ["Input is required (slug, URL, or product id)."],
      diagnostics,
    });
  }

  let product: any;
  try {
    const response = await fetchStockxProductByIdOrSlugRaw(normalizedInput);
    product = response.product as any;
    diagnostics.kickdbFetchOk = true;
  } catch (error: any) {
    const message = String(error?.message ?? "KickDB fetch failed");
    const statusMatch = message.match(/KickDB request failed \((\d+)\)/i);
    diagnostics.kickdbFetchOk = false;
    diagnostics.kickdbHttpStatus = statusMatch ? Number(statusMatch[1]) : null;
    diagnostics.kickdbError = message;
    return failedImportResult({
      input,
      normalizedInput,
      productSummary: {},
      warnings,
      errors: [
        diagnostics.kickdbHttpStatus === 404
          ? `KickDB: product not found for "${normalizedInput}" (404). Check slug/URL.`
          : message,
      ],
      diagnostics,
    });
  }

  const kickdbProductId = pickString(product?.id, normalizedInput);
  const slug = pickString(product?.slug, product?.url_key, product?.urlKey);
  const styleId = pickString(product?.sku, product?.style_id, product?.styleId);
  const name = pickString(product?.title, product?.name, product?.primary_title, product?.secondary_title);
  const brand = pickString(product?.brand);
  const image = pickString(product?.image, product?.image_url, product?.imageUrl);
  const images = pickImages(product);
  const traits = Array.isArray(product?.traits) ? product.traits : [];

  if (!brand) warnings.push("Missing product brand in KickDB payload.");
  if (!name) warnings.push("Missing product title/name in KickDB payload.");
  if (!image) warnings.push("Missing product image in KickDB payload.");
  if (!images || images.length === 0) {
    warnings.push("Missing product gallery/image list in KickDB payload.");
  }

  const regionCheck = runRegionHook(product, { forcedMarket: "CH" });
  warnings.push(...regionCheck.warnings);
  errors.push(...regionCheck.errors);
  if (regionCheck.blocked) {
    return failedImportResult({
      input,
      normalizedInput,
      productSummary: { kickdbProductId, slug, styleId, name, brand, image },
      warnings,
      errors,
      diagnostics,
    });
  }

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  diagnostics.variantsTotal = variants.length;
  const supplierSkuFallback = pickString(styleId, product?.sku, slug, product?.id) ?? `stx_${normalizedInput}`;
  const forceImport = isStxForceImportSlug(slug ?? normalizedInput);
  diagnostics.forceImport = forceImport;
  const parsedRows: ParsedVariantRow[] = [];
  let eligibleVariantsCount = 0;

  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    const sizeLabel = pickSizeRawEuFirst(variant) ?? pickString(variant?.size) ?? "?";
    if (!variantId) {
      diagnostics.skipReasons.missingVariantId += 1;
      warnings.push(`Skipped size ${sizeLabel}: missing variant id.`);
      continue;
    }

    const selected = selectStxOfferForImport(variant?.prices, { forceImport });
    if (!selected) {
      diagnostics.skipReasons.noUsablePrice += 1;
      const priceHint = summarizePriceRows(variant?.prices);
      if (!diagnostics.samplePriceRows?.includes(priceHint) && diagnostics.samplePriceRows!.length < 3) {
        diagnostics.samplePriceRows!.push(`size ${sizeLabel}: ${priceHint || "no price rows"}`);
      }
      warnings.push(
        forceImport
          ? `Size ${sizeLabel} (${variantId}): no usable price. Prices: ${priceHint || "none"}.`
          : `Size ${sizeLabel} (${variantId}): no express price (need express_standard/expedited). Prices: ${priceHint || "none"}.`
      );
      continue;
    }
    if (forceImport || selected.asks >= 2) eligibleVariantsCount += 1;

    const supplierVariantId = `stx_${variantId}`;
    const gtinRaw = pickString(extractVariantGtin(variant));
    const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
    if (!gtin) {
      diagnostics.skipReasons.invalidGtin += 1;
      warnings.push(`Size ${sizeLabel} (${variantId}): missing/invalid GTIN (got ${gtinRaw ?? "none"}).`);
      continue;
    }
    if (!images || images.length === 0) {
      diagnostics.skipReasons.missingImages += 1;
      warnings.push(`Size ${sizeLabel} (${variantId}): missing product images.`);
      continue;
    }
    const providerKey = buildProviderKey(gtin, supplierVariantId);

    const stxBasePrice = Number(selected.price);
    const shippingCHF = resolveStxShippingCHF(product);
    const stxSellPrice = estimatedStockxBuyChfFromList(stxBasePrice, shippingCHF);
    const suggestedRetailPriceInclVat = calcSuggestedRetailFromStxOffer({
      stockxRaw: stxBasePrice,
      productHandle: slug,
      productName: name,
      deliveryType: selected.deliveryType,
    });

    parsedRows.push({
      supplierVariantId,
      supplierSku: supplierSkuFallback,
      providerKey,
      gtin,
      price: stxSellPrice,
      stock: selected.asks,
      sizeRaw: pickSizeRawEuFirst(variant),
      supplierBrand: brand,
      supplierProductName: name,
      images,
      leadTimeDays: null,
      deliveryType: selected.deliveryType,
      suggestedRetailPriceInclVat,
      kickdbVariantExternalId: variantId,
      sizeUs: pickString(variant?.size_us),
      sizeEu: pickString(variant?.size_eu),
      ean: pickString(variant?.ean),
    });
  }

  diagnostics.variantsParsed = parsedRows.length;
  diagnostics.variantsEligible = eligibleVariantsCount;

  if (parsedRows.length === 0) {
    errors.push("No importable variants were found on this product.");
  }
  if (!forceImport && eligibleVariantsCount === 0) {
    errors.push(
      "No eligible express variants (need express_standard or express_expedited with price>0 and asks≥2)."
    );
  }
  if (errors.length > 0) {
    return failedImportResult({
      input,
      normalizedInput,
      productSummary: { kickdbProductId, slug, styleId, name, brand, image },
      warnings,
      errors,
      diagnostics,
      eligibleVariantsCount,
      variantsPreview: parsedRows.slice(0, 5).map((row) => ({
        supplierVariantId: row.supplierVariantId,
        size: row.sizeRaw,
        deliveryType: row.deliveryType,
        price: row.price,
        stock: row.stock,
      })),
    });
  }

  const now = new Date();
  let rows = parsedRows;
  try {
  const remappedRowsResult = await remapRowsToExistingProviderKeyGtin(parsedRows);
  rows = remappedRowsResult.rows;

  const retailPriceRaw = pickTraitValue(traits, ["retail price", "rrp", "msrp"]);
  const releaseDateRaw = pickTraitValue(traits, ["release date"]);
  const retailPrice = retailPriceRaw ? Number(retailPriceRaw) : null;
  const releaseDate = parseDateValue(releaseDateRaw);
  const gender = pickString(product?.gender, product?.sex) ?? pickTraitValue(traits, ["gender"]);
  const colorway = pickTraitValue(traits, ["colorway", "colourway", "color"]);
  const countryOfManufacture =
    pickString(product?.country_of_manufacture, product?.countryOfManufacture) ??
    pickTraitValue(traits, ["country of manufacture", "country"]);
  const description = pickString(product?.description, product?.short_description, product?.product_description);

  const savedProduct = await (prisma as any).kickDBProduct.upsert({
    where: { kickdbProductId: kickdbProductId ?? normalizedInput },
    create: {
      kickdbProductId: kickdbProductId ?? normalizedInput,
      urlKey: slug,
      styleId,
      name,
      brand,
      imageUrl: image,
      traitsJson: traits,
      description,
      gender,
      colorway,
      countryOfManufacture,
      releaseDate,
      retailPrice: Number.isFinite(retailPrice ?? Number.NaN) ? retailPrice : null,
      lastFetchedAt: now,
      notFound: false,
    },
    update: {
      urlKey: slug,
      styleId,
      name,
      brand,
      imageUrl: image,
      traitsJson: traits,
      description,
      gender,
      colorway,
      countryOfManufacture,
      releaseDate,
      retailPrice: Number.isFinite(retailPrice ?? Number.NaN) ? retailPrice : null,
      lastFetchedAt: now,
      notFound: false,
    },
  });

  for (const row of rows) {
    assertMappingIntegrity({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin,
      providerKey: row.providerKey,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
    });
  }

  await bulkInsertSupplierVariants(rows, now);
  await bulkUpdateSupplierVariants(rows, now, { updateGtinWhenProvided: true });

  const mappingRows: Array<{
    supplierVariantId: string;
    gtin: string | null;
    providerKey: string | null;
    status: string;
    kickdbVariantId: string | null;
  }> = [];

  for (const row of rows) {
    const savedVariant = await prisma.kickDBVariant.upsert({
      where: { kickdbVariantId: row.kickdbVariantExternalId },
      create: {
        kickdbVariantId: row.kickdbVariantExternalId,
        productId: savedProduct.id,
        sizeUs: row.sizeUs,
        sizeEu: row.sizeEu,
        gtin: row.gtin,
        ean: row.ean,
        providerKey: row.providerKey,
        lastFetchedAt: now,
        notFound: false,
      },
      update: {
        productId: savedProduct.id,
        sizeUs: row.sizeUs,
        sizeEu: row.sizeEu,
        gtin: row.gtin,
        ean: row.ean,
        providerKey: row.providerKey,
        lastFetchedAt: now,
        notFound: false,
      },
    });
    mappingRows.push({
      supplierVariantId: row.supplierVariantId,
      gtin: row.gtin,
      providerKey: row.providerKey,
      status: row.gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
      kickdbVariantId: savedVariant.id,
    });
  }

  await bulkUpsertVariantMappings(mappingRows, now, {
    doNotDowngradeFromMatched: true,
    onlySetPendingIfMissing: true,
  });
  } catch (error: any) {
    const message = String(error?.message ?? "Database write failed");
    return failedImportResult({
      input,
      normalizedInput,
      productSummary: { kickdbProductId, slug, styleId, name, brand, image },
      warnings,
      errors: [`Database error while saving import: ${message}`],
      diagnostics,
      eligibleVariantsCount,
      variantsPreview: parsedRows.slice(0, 5).map((row) => ({
        supplierVariantId: row.supplierVariantId,
        size: row.sizeRaw,
        deliveryType: row.deliveryType,
        price: row.price,
        stock: row.stock,
      })),
    });
  }

  return {
    ok: true,
    productSummary: {
      input,
      normalizedInput,
      kickdbProductId,
      slug,
      styleId,
      name,
      brand,
      image,
    },
    importedVariantsCount: rows.length,
    eligibleVariantsCount,
    warnings,
    errors: [],
    diagnostics,
    variantsPreview: rows.slice(0, 5).map((row) => ({
      supplierVariantId: row.supplierVariantId,
      size: row.sizeRaw,
      deliveryType: row.deliveryType,
      price: row.price,
      stock: row.stock,
    })),
  };
}
