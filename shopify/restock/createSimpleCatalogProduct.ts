import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { prisma } from "@/app/lib/prisma";
import { createProductWithVariant } from "@/shopify/catalog/graphql";
import { isPartnerCatalogSupplierVariantId } from "@/galaxus/supplier/supplierKeyGuards";
import { gtinCandidates } from "@/shopify/restock/gtinNormalize";

/**
 * Minimal Shopify product create for NON-StockX catalog items (Pokémon / TCG /
 * card games / accessories) that live only in our DB SupplierVariant table.
 *
 * The StockX/Kicks Python pipeline (createProductFullFlow) can only build
 * sneaker products (it fetches size variants from kicks.dev). Supplier catalog
 * goods have no StockX equivalent and no size matrix — a single default variant
 * is correct. All product data (title, brand, type, image, price, GTIN) comes
 * from the SupplierVariant row we already synced.
 */

export type SimpleCatalogSource = {
  gtin: string;
  providerKey: string;
  title: string;
  brand: string | null;
  productType: string | null;
  imageUrl: string | null;
  price: number | null;
};

/**
 * Load a SupplierVariant that should be created as a simple (sizeless) product.
 * Returns null for StockX rows, partner-catalog rows, or rows with a size
 * (those belong to the sneaker pipeline, not here).
 */
export async function loadSimpleCatalogSourceByGtin(
  gtin: string
): Promise<SimpleCatalogSource | null> {
  const cands = gtinCandidates(gtin);
  if (!cands.length) return null;
  const p = prisma as any;

  const sv = await p.supplierVariant.findFirst({
    where: { gtin: { in: cands } },
    select: {
      supplierVariantId: true,
      providerKey: true,
      supplierSku: true,
      gtin: true,
      price: true,
      manualPrice: true,
      sizeNormalized: true,
      sizeRaw: true,
      supplierBrand: true,
      supplierProductName: true,
      supplierProductType: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
    },
    orderBy: { updatedAt: "desc" },
  });
  if (!sv) return null;

  // StockX rows (stx_*) and partner-catalog rows are handled elsewhere.
  const svId = String(sv.supplierVariantId ?? "");
  if (svId.startsWith("stx_")) return null;
  if (isPartnerCatalogSupplierVariantId(svId)) return null;
  // A size present means this is a sneaker/apparel matrix — not a simple good.
  if (String(sv.sizeNormalized ?? sv.sizeRaw ?? "").trim()) return null;

  const title = String(sv.supplierProductName ?? "").trim();
  if (!title) return null;

  const manualPrice = sv.manualPrice != null ? Number(sv.manualPrice) : null;
  const basePrice = sv.price != null ? Number(sv.price) : null;
  const price =
    manualPrice != null && Number.isFinite(manualPrice) && manualPrice > 0
      ? manualPrice
      : basePrice != null && Number.isFinite(basePrice) && basePrice > 0
        ? basePrice
        : null;

  return {
    gtin: String(sv.gtin ?? gtin),
    providerKey: String(sv.providerKey ?? sv.supplierVariantId ?? sv.supplierSku ?? gtin),
    title,
    brand: sv.supplierBrand ? String(sv.supplierBrand) : null,
    productType: sv.supplierProductType ? String(sv.supplierProductType) : null,
    imageUrl: sv.hostedImageUrl
      ? String(sv.hostedImageUrl)
      : sv.sourceImageUrl
        ? String(sv.sourceImageUrl)
        : null,
    price,
  };
}

async function setProductType(productId: string, productType: string): Promise<void> {
  const { data, errors } = await shopifyGraphQL<{
    productUpdate: { userErrors: Array<{ message: string }> };
  }>(
    /* GraphQL */ `
    mutation SimpleCatalogProductType($product: ProductUpdateInput!) {
      productUpdate(product: $product) {
        userErrors { field message }
      }
    }`,
    { product: { id: productId, productType } }
  );
  if (errors?.length) throw new Error(`productUpdate(type) failed: ${errors.map((e) => e.message).join("; ")}`);
  const ue = data?.productUpdate?.userErrors ?? [];
  if (ue.length) throw new Error(`productUpdate(type): ${ue.map((e) => e.message).join("; ")}`);
}

async function attachImageFromUrl(productId: string, url: string, alt: string): Promise<void> {
  const { errors } = await shopifyGraphQL<{
    productCreateMedia: { mediaUserErrors: Array<{ message: string }> };
  }>(
    /* GraphQL */ `
    mutation SimpleCatalogMedia($productId: ID!, $media: [CreateMediaInput!]!) {
      productCreateMedia(productId: $productId, media: $media) {
        media { id }
        mediaUserErrors { field message }
      }
    }`,
    {
      productId,
      media: [{ originalSource: url, mediaContentType: "IMAGE", alt }],
    }
  );
  if (errors?.length) throw new Error(`productCreateMedia failed: ${errors.map((e) => e.message).join("; ")}`);
}

async function publishToSalesChannels(productId: string): Promise<void> {
  const pubs = await shopifyGraphQL<{
    publications: { nodes: Array<{ id: string; name: string }> };
  }>(/* GraphQL */ `query SimpleCatalogPublications { publications(first: 20) { nodes { id name } } }`);
  for (const pub of pubs.data?.publications?.nodes ?? []) {
    if (!/online store|facebook|instagram|tiktok|shop|pos|google/i.test(pub.name)) continue;
    await shopifyGraphQL(
      /* GraphQL */ `
      mutation SimpleCatalogPublish($id: ID!, $input: [PublicationInput!]!) {
        publishablePublish(id: $id, input: $input) { userErrors { message } }
      }`,
      { id: productId, input: [{ publicationId: pub.id }] }
    );
  }
}

export type CreateSimpleCatalogResult = {
  ok: boolean;
  productId: string | null;
  variantId: string | null;
  inventoryItemId: string | null;
  created: boolean;
  priceUsed: number | null;
  warnings: string[];
  error?: string;
};

/**
 * Create a simple (sizeless) Shopify product from DB catalog data.
 *
 * @param gtin scanned GTIN
 * @param options.manualSellPrice operator-typed sell price (CHF); wins over DB price
 * @param options.dryRun resolve + report only, no writes
 */
export async function createSimpleCatalogProduct(
  gtin: string,
  options: { manualSellPrice?: number | null; dryRun?: boolean } = {}
): Promise<CreateSimpleCatalogResult> {
  const warnings: string[] = [];
  const base: CreateSimpleCatalogResult = {
    ok: false,
    productId: null,
    variantId: null,
    inventoryItemId: null,
    created: false,
    priceUsed: null,
    warnings,
  };

  const source = await loadSimpleCatalogSourceByGtin(gtin);
  if (!source) {
    return { ...base, error: "no_simple_catalog_source" };
  }

  const manual =
    options.manualSellPrice != null ? Number(options.manualSellPrice) : null;
  const price =
    manual != null && Number.isFinite(manual) && manual > 0 ? manual : source.price;
  if (price == null || !(price > 0)) {
    return {
      ...base,
      error: "manual_price_required",
      warnings: [
        ...warnings,
        `Produit catalogue "${source.title}" sans prix DB — saisir un prix de vente`,
      ],
    };
  }

  if (options.dryRun) {
    return {
      ...base,
      ok: true,
      created: true,
      priceUsed: price,
      warnings: [
        ...warnings,
        `Dry-run: créerait "${source.title}" (${source.brand ?? "?"}) à ${price.toFixed(2)} CHF, GTIN ${source.gtin}`,
      ],
    };
  }

  let productId: string;
  let variantId: string | null;
  let inventoryItemId: string | null;
  try {
    const created = await createProductWithVariant({
      title: source.title,
      brand: source.brand,
      providerKey: source.providerKey,
      gtin: source.gtin,
      price,
    });
    productId = created.productId;
    variantId = created.variantId;
    inventoryItemId = created.inventoryItemId;
  } catch (err: any) {
    return { ...base, error: `product_create_failed: ${err?.message ?? err}` };
  }

  if (source.productType) {
    try {
      await setProductType(productId, source.productType);
    } catch (err: any) {
      warnings.push(`Type produit non défini: ${err?.message ?? err}`);
    }
  }

  if (source.imageUrl) {
    try {
      await attachImageFromUrl(productId, source.imageUrl, source.title);
    } catch (err: any) {
      warnings.push(`Image non attachée: ${err?.message ?? err}`);
    }
  }

  try {
    await publishToSalesChannels(productId);
  } catch (err: any) {
    warnings.push(`Publication canaux échouée: ${err?.message ?? err}`);
  }

  warnings.push(`Produit catalogue simple créé: "${source.title}" à ${price.toFixed(2)} CHF`);
  return {
    ok: true,
    productId,
    variantId,
    inventoryItemId,
    created: true,
    priceUsed: price,
    warnings,
  };
}
