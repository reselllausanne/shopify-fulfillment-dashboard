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
import { selectStxActiveOffer, type StxDeliveryType } from "@/galaxus/stx/offerSelection";

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

export type StxImportResult = {
  ok: boolean;
  productSummary: ImportProductSummary;
  importedVariantsCount: number;
  eligibleVariantsCount: number;
  warnings: string[];
  errors: string[];
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
  kickdbVariantExternalId: string;
  sizeUs: string | null;
  sizeEu: string | null;
  ean: string | null;
};

const LEGO_CUSTOM_ADDON_BY_SLUG: Record<string, number> = {
  "lego-pet-shop-set-10218": 45,
  "lego-grand-emporium-set-10211": 25,
};

const LEGO_LARGE_SET_SLUGS = new Set([
  "lego-eiffel-tower-set-10307",
  "lego-titanic-set-10294",
  "lego-palace-cinema-set-10232",
  "lego-marvel-studios-infinity-saga-hulkbuster-set-76210",
]);

const LEGO_MEDIUM_SET_SLUGS = new Set([
  "lego-creator-fairgrounds-mixer-set-10244",
  "lego-stranger-things-the-upside-down-set-75810",
  "lego-tower-bridge-set-10214",
  "lego-technic-land-rover-defender-set-42110",
  "lego-creator-ferris-wheel-2015-set-10247",
  "lego-architecture-taj-mahal-set-21056",
]);

const LEGO_SMALL_SET_SLUGS = new Set([
  "lego-star-wars-tie-fighter-set-75095",
  "lego-creator-horizon-express-set-10233",
  "lego-creator-santas-workshop-set-10245",
]);

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

function normalizeSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function resolveStxShippingCHF(product: any): number {
  const baseShipping = 20;
  const slug = normalizeSlug(product?.slug ?? product?.url_key ?? product?.urlKey);
  const title = normalizeSlug(product?.title ?? product?.primary_title ?? product?.name);
  const isLego = slug.includes("lego") || title.includes("lego");
  if (!isLego) return baseShipping;

  const customAddon = LEGO_CUSTOM_ADDON_BY_SLUG[slug];
  if (Number.isFinite(customAddon)) return baseShipping + customAddon;
  if (LEGO_LARGE_SET_SLUGS.has(slug)) return 60;
  if (LEGO_MEDIUM_SET_SLUGS.has(slug)) return 45;
  if (LEGO_SMALL_SET_SLUGS.has(slug)) return 35;
  return baseShipping;
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

  if (!normalizedInput) {
    return {
      ok: false,
      productSummary: {
        input,
        normalizedInput,
        kickdbProductId: null,
        slug: null,
        styleId: null,
        name: null,
        brand: null,
        image: null,
      },
      importedVariantsCount: 0,
      eligibleVariantsCount: 0,
      warnings,
      errors: ["Input is required (slug, URL, or product id)."],
      variantsPreview: [],
    };
  }

  const response = await fetchStockxProductByIdOrSlugRaw(normalizedInput);
  const product = response.product as any;
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
    return {
      ok: false,
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
      importedVariantsCount: 0,
      eligibleVariantsCount: 0,
      warnings,
      errors,
      variantsPreview: [],
    };
  }

  const variants = Array.isArray(product?.variants) ? product.variants : [];
  const supplierSkuFallback = pickString(styleId, product?.sku, slug, product?.id) ?? `stx_${normalizedInput}`;
  const parsedRows: ParsedVariantRow[] = [];
  let eligibleVariantsCount = 0;

  for (const variant of variants) {
    const variantId = pickString(variant?.id);
    if (!variantId) {
      warnings.push("Skipped one variant because id is missing.");
      continue;
    }

    const selected = selectStxActiveOffer(variant?.prices);
    if (!selected) {
      warnings.push(`Variant ${variantId}: no express price found (standard-only or invalid).`);
      continue;
    }
    if (selected.asks >= 2) eligibleVariantsCount += 1;

    const supplierVariantId = `stx_${variantId}`;
    const gtinRaw = pickString(extractVariantGtin(variant));
    const gtin = gtinRaw && validateGtin(gtinRaw) ? gtinRaw : null;
    if (!gtin) {
      warnings.push(`Variant ${variantId}: missing/invalid GTIN (skipped).`);
      continue;
    }
    if (!images || images.length === 0) {
      warnings.push(`Variant ${variantId}: missing product images (skipped).`);
      continue;
    }
    const providerKey = buildProviderKey(gtin, supplierVariantId);

    const stxBasePrice = Number(selected.price);
    const shippingCHF = resolveStxShippingCHF(product);
    const stxSellPrice = estimatedStockxBuyChfFromList(stxBasePrice, shippingCHF);

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
      kickdbVariantExternalId: variantId,
      sizeUs: pickString(variant?.size_us),
      sizeEu: pickString(variant?.size_eu),
      ean: pickString(variant?.ean),
    });
  }

  if (parsedRows.length === 0) {
    errors.push("No importable variants were found on this product.");
  }
  if (eligibleVariantsCount === 0) {
    errors.push("No eligible express variants found");
  }
  if (errors.length > 0) {
    return {
      ok: false,
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
      importedVariantsCount: 0,
      eligibleVariantsCount,
      warnings,
      errors,
      variantsPreview: parsedRows.slice(0, 5).map((row) => ({
        supplierVariantId: row.supplierVariantId,
        size: row.sizeRaw,
        deliveryType: row.deliveryType,
        price: row.price,
        stock: row.stock,
      })),
    };
  }

  const now = new Date();
  const remappedRowsResult = await remapRowsToExistingProviderKeyGtin(parsedRows);
  const rows = remappedRowsResult.rows;

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
    variantsPreview: rows.slice(0, 5).map((row) => ({
      supplierVariantId: row.supplierVariantId,
      size: row.sizeRaw,
      deliveryType: row.deliveryType,
      price: row.price,
      stock: row.stock,
    })),
  };
}
