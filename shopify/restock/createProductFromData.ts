import { prisma } from "@/app/lib/prisma";
import { normalizeSize, validateGtin } from "@/app/lib/normalize";
import { assertMappingIntegrity, buildProviderKey } from "@/galaxus/supplier/providerKey";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { updateVariantPricingAndIdentity } from "@/shopify/catalog/graphql";
import { buildShopifyListing } from "@/shopify/restock/buildShopifyListing";
import { publishToSalesChannels } from "@/shopify/restock/createSimpleCatalogProduct";
import {
  activateInventoryAtLocation,
  adjustInventoryAtLocation,
  resolvePhysicalLocationId,
} from "@/shopify/restock/shopifyRestockInventory";

/**
 * Create a physical (non-StockX) product from data scraped off a brand page
 * (Nike, ...). No KickDB involved: brand / name / images / GTIN per size come
 * from the page, sell price + stock are typed by the operator.
 *
 * Galaxus: rows are written as `ner:` SupplierVariants (same shape as
 * physicalStockRecovery) so the NEXT regular feed run (02h stock/price, 04h master/specs)
 * picks them up. No push is triggered here.
 */

const VAT_DIVISOR = 1.081;

export type ProductFromDataSize = {
  /** EU size label as shown on Shopify / Galaxus (e.g. "22", "27.5"). */
  size: string;
  gtin: string;
  /** Units on the shelf, typed by operator. */
  stock: number;
};

export type ProductFromData = {
  brand: string;
  name: string;
  /** Style / model reference (e.g. "FJ4668-100"). */
  sku: string;
  color?: string | null;
  images: string[];
  sizes: ProductFromDataSize[];
  /** Sell price, CHF incl. VAT, typed by operator. */
  sellPrice: number;
  productType?: string | null;
  sourceUrl?: string | null;
  subtitle?: string | null;
  genders?: string[];
};

export type NerRow = {
  /** Deterministic KickDB-style ids (no StockX): one product per style-color, one variant per EU size. */
  kickdbProductId: string;
  kickdbVariantId: string;
  providerKey: string;
  gtin: string;
  sku: string;
  sizeRaw: string;
  sizeNormalized: string;
  priceExVat: number;
  sellPrice: number;
  stock: number;
  productName: string;
  brand: string;
  color: string | null;
  images: string[];
};

function sanitizeIdPart(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
}

/** Missing fields that would keep the product out of the Galaxus feed ("À compléter"). */
export function validateProductFromData(data: ProductFromData): string[] {
  const missing: string[] = [];
  if (!data.brand?.trim()) missing.push("brand");
  if (!data.name?.trim()) missing.push("name");
  if (!data.sku?.trim()) missing.push("sku");
  if (!(data.images ?? []).some((u) => /^https?:\/\//i.test(String(u ?? "")))) missing.push("images");
  if (!(data.sellPrice > 0)) missing.push("sellPrice");
  if (!data.sizes?.length) missing.push("sizes");
  const seenGtin = new Set<string>();
  const seenSize = new Set<string>();
  for (const s of data.sizes ?? []) {
    const label = normalizeSize(s.size);
    if (!label) missing.push("size:(empty)");
    else if (seenSize.has(label)) missing.push(`size:${label}:duplicate`);
    else seenSize.add(label);
    const gtin = String(s.gtin ?? "").trim();
    if (!validateGtin(gtin)) missing.push(`gtin:${label ?? "?"}`);
    else if (seenGtin.has(gtin)) missing.push(`gtin:${gtin}:duplicate`);
    else seenGtin.add(gtin);
    if (!Number.isInteger(s.stock) || s.stock < 0) missing.push(`stock:${label ?? "?"}`);
  }
  return missing;
}

/** Pure: rows mirrored into the KickDB tables + stx_ SupplierVariant (same shape as a StockX product). */
export function buildNerRows(data: ProductFromData): NerRow[] {
  const priceExVat = Math.round((data.sellPrice / VAT_DIVISOR) * 100) / 100;
  const images = data.images.filter((u) => /^https?:\/\//i.test(u));
  const style = sanitizeIdPart(data.sku);
  return data.sizes.map((s) => {
    const sizeNormalized = normalizeSize(s.size) ?? s.size;
    const gtin = s.gtin.trim();
    const providerKey = buildProviderKey(gtin, "stx_x");
    if (!providerKey) throw new Error(`providerKey introuvable pour GTIN ${gtin}`);
    return {
      kickdbProductId: `nike-${style}`,
      kickdbVariantId: `nike-${style}-${sanitizeIdPart(sizeNormalized)}`,
      providerKey,
      gtin,
      sku: data.sku.trim(),
      sizeRaw: s.size.trim(),
      sizeNormalized,
      priceExVat,
      sellPrice: data.sellPrice,
      stock: s.stock,
      productName: data.name.trim(),
      brand: data.brand.trim(),
      color: data.color?.trim() || null,
      images,
    };
  });
}

const BULK_CREATE = /* GraphQL */ `
mutation FromDataBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants { id title inventoryItem { id } }
    userErrors { field message }
  }
}`;

const PRODUCT_CREATE = /* GraphQL */ `
mutation FromDataProductCreate($product: ProductCreateInput!) {
  productCreate(product: $product) {
    product { id }
    userErrors { field message }
  }
}`;

const PRODUCT_MEDIA = /* GraphQL */ `
mutation FromDataMedia($productId: ID!, $media: [CreateMediaInput!]!) {
  productCreateMedia(productId: $productId, media: $media) {
    mediaUserErrors { field message }
  }
}`;

export type CreateProductFromDataResult = {
  ok: boolean;
  dryRun: boolean;
  missing: string[];
  productId: string | null;
  rows: NerRow[];
  warnings: string[];
  error?: string;
};

/**
 * Persist like a StockX product: KickDBProduct + KickDBVariant, `stx_<kickdbVariant.id>`
 * SupplierVariant (providerKey STX_<gtin>), VariantMapping. `manualLock` + `manualPrice`
 * keep convergence from repricing it (same as liquidation restock).
 */
export async function upsertNerRows(rows: NerRow[]): Promise<void> {
  const now = new Date();
  const p = prisma as any;
  const first = rows[0];
  const product = await p.kickDBProduct.upsert({
    where: { kickdbProductId: first.kickdbProductId },
    update: { name: first.productName, brand: first.brand, imageUrl: first.images[0], colorway: first.color, lastFetchedAt: now },
    create: {
      kickdbProductId: first.kickdbProductId,
      urlKey: first.kickdbProductId,
      styleId: first.sku,
      name: first.productName,
      brand: first.brand,
      imageUrl: first.images[0],
      colorway: first.color,
      lastFetchedAt: now,
    },
  });
  for (const r of rows) {
    const kv = await p.kickDBVariant.upsert({
      where: { kickdbVariantId: r.kickdbVariantId },
      update: { gtin: r.gtin, providerKey: r.providerKey, sizeEu: r.sizeRaw, lastFetchedAt: now },
      create: {
        kickdbVariantId: r.kickdbVariantId,
        productId: product.id,
        sizeEu: r.sizeRaw,
        gtin: r.gtin,
        providerKey: r.providerKey,
        lastFetchedAt: now,
      },
    });
    const supplierVariantId = `stx_${kv.id}`;
    assertMappingIntegrity({ supplierVariantId, gtin: r.gtin, providerKey: r.providerKey, status: "SUPPLIER_GTIN" });
    const data = {
      gtin: r.gtin,
      providerKey: r.providerKey,
      price: r.priceExVat,
      stock: r.stock,
      supplierSku: r.sku,
      sizeRaw: `EU ${r.sizeRaw}`,
      sizeNormalized: r.sizeNormalized,
      supplierProductName: r.productName,
      supplierBrand: r.brand,
      images: r.images,
      sourceImageUrl: r.images[0],
      imageSyncStatus: "PENDING",
      manualLock: true,
      manualPrice: r.sellPrice,
      manualUpdatedAt: now,
      manualNote: "restock:from-url",
      lastSyncAt: now,
      updatedAt: now,
    };
    await p.supplierVariant.upsert({
      where: { supplierVariantId },
      update: data,
      create: { supplierVariantId, ...data },
    });
    await p.variantMapping.upsert({
      where: { supplierVariantId },
      update: { gtin: r.gtin, providerKey: r.providerKey, kickdbVariantId: kv.id, supplierKey: "stx", status: "SUPPLIER_GTIN", updatedAt: now },
      create: { supplierVariantId, gtin: r.gtin, providerKey: r.providerKey, kickdbVariantId: kv.id, supplierKey: "stx", status: "SUPPLIER_GTIN" },
    });
  }
}

export async function createProductFromData(
  data: ProductFromData,
  options: { dryRun?: boolean; locationId?: string | null } = {}
): Promise<CreateProductFromDataResult> {
  const dryRun = Boolean(options.dryRun);
  const warnings: string[] = [];
  const missing = validateProductFromData(data);
  const base = { dryRun, missing, productId: null, rows: [] as NerRow[], warnings };
  if (missing.length) {
    return { ...base, ok: false, error: "incomplete_product_data" };
  }

  const rows = buildNerRows(data);
  if (dryRun) {
    warnings.push(
      `Dry-run: créerait "${data.brand} ${data.name}" (${rows.length} tailles) à ${data.sellPrice.toFixed(2)} CHF`
    );
    return { ...base, ok: true, rows };
  }

  // Refuse duplicates: a GTIN already on Shopify means the product exists.
  const existing = await prisma.supplierVariant.findMany({
    where: {
      gtin: { in: rows.map((r) => r.gtin) },
      supplierVariantId: { startsWith: "stx_" },
      NOT: { manualNote: "restock:from-url" },
    },
    select: { gtin: true },
    take: 1,
  });
  if (existing.length) {
    warnings.push(`GTIN ${existing[0].gtin} existe déjà côté StockX — utiliser le Restock normal`);
    return { ...base, rows, ok: false, error: "gtin_already_in_catalog" };
  }

  const loc = await resolvePhysicalLocationId(options.locationId ?? null);
  if (!loc.locationId) {
    return { ...base, rows, ok: false, error: "physical_location_not_found" };
  }

  const first = rows[0];
  const listing = buildShopifyListing(data);

  // Product shell identical to the StockX pipeline: tags ["New"], type, taxonomy category,
  // French description, SEO, option "Taille", custom.* metafields.
  const pc = await shopifyGraphQL<{
    productCreate: { product: { id: string } | null; userErrors: Array<{ message: string }> };
  }>(PRODUCT_CREATE, {
    product: {
      title: listing.title,
      handle: listing.handle,
      vendor: data.brand,
      productType: listing.productType,
      tags: listing.tags,
      descriptionHtml: listing.descriptionHtml,
      category: listing.category,
      status: "ACTIVE",
      seo: { title: listing.seoTitle, description: listing.seoDescription },
      productOptions: [{ name: listing.option, values: [{ name: first.sizeRaw }] }],
      metafields: listing.productMetafields,
    },
  });
  const pcErr =
    pc.errors?.map((e) => e.message) ?? pc.data?.productCreate?.userErrors?.map((e) => e.message) ?? [];
  if (pcErr.length) throw new Error(`productCreate: ${pcErr.join("; ")}`);
  const productId = pc.data!.productCreate.product!.id;

  if (rows.length > 1) {
    const bulk = await shopifyGraphQL<{
      productVariantsBulkCreate: {
        productVariants: Array<{ id: string; title: string; inventoryItem: { id: string } | null }>;
        userErrors: Array<{ message: string }>;
      };
    }>(BULK_CREATE, {
      productId,
      variants: rows.slice(1).map((r) => ({
        price: data.sellPrice.toFixed(2),
        barcode: r.gtin,
        optionValues: [{ optionName: listing.option, name: r.sizeRaw }],
        inventoryItem: { sku: listing.variantSku(r.sizeRaw), tracked: true },
      })),
    });
    const bErr = bulk.errors?.map((e) => e.message) ?? bulk.data?.productVariantsBulkCreate?.userErrors?.map((e) => e.message) ?? [];
    if (bErr.length) throw new Error(`productVariantsBulkCreate: ${bErr.join("; ")}`);
  }

  // Stock per size at the physical location (match by barcode, not by order).
  const { data: vdata } = await shopifyGraphQL<{
    product: {
      variants: { nodes: Array<{ id: string; title: string; barcode: string | null; inventoryItem: { id: string } | null }> };
    } | null;
  }>(
    /* GraphQL */ `query FromDataVariants($id: ID!) {
      product(id: $id) { variants(first: 100) { nodes { id title barcode inventoryItem { id } } } }
    }`,
    { id: productId }
  );
  const byBarcode = new Map(
    (vdata?.product?.variants.nodes ?? []).map((v) => [String(v.barcode ?? "").trim(), v])
  );
  for (const r of rows) {
    const v = byBarcode.get(r.gtin) ?? (r === first ? (vdata?.product?.variants.nodes ?? []).find((n) => n.title === r.sizeRaw) : undefined);
    if (!v?.inventoryItem?.id) {
      warnings.push(`Variante Shopify introuvable pour GTIN ${r.gtin}`);
      continue;
    }
    if (r === first) {
      await updateVariantPricingAndIdentity({
        productId,
        variantId: v.id,
        sku: listing.variantSku(r.sizeRaw),
        barcode: r.gtin,
        price: data.sellPrice,
      }).catch((e) => warnings.push(`Variante 1: ${e?.message ?? e}`));
    }
    if (r.stock > 0) {
      await activateInventoryAtLocation({ inventoryItemId: v.inventoryItem.id, locationId: loc.locationId });
      await adjustInventoryAtLocation({
        inventoryItemId: v.inventoryItem.id,
        locationId: loc.locationId,
        delta: r.stock,
        reason: "received",
        allowWhenCommitted: true,
      });
    }
  }

  const images = rows[0].images;
  const media = await shopifyGraphQL<{
    productCreateMedia: { mediaUserErrors: Array<{ message: string }> };
  }>(PRODUCT_MEDIA, {
    productId,
    media: images.map((u) => ({ originalSource: u, mediaContentType: "IMAGE", alt: data.name })),
  });
  if (media.errors?.length) warnings.push(`Images: ${media.errors.map((e) => e.message).join("; ")}`);

  await publishToSalesChannels(productId).catch((e) => warnings.push(`Publication canaux: ${e?.message ?? e}`));

  await upsertNerRows(rows);
  warnings.push(
    "Lignes stx_ écrites (KickDB + SupplierVariant). Galaxus: prochain feed (02h stock/prix, 04h master/specs) — aucun push déclenché."
  );
  return { ...base, productId, rows, ok: true };
}
