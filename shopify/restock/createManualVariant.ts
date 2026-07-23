import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { applyVariantSalePrice } from "@/shopify/restock/shopifyRestockInventory";
import { resolvePhysicalRestockPricing } from "@/shopify/restock/physicalRestockPricing";
import { sizeTitlesMatch, isValidEuSizeForCreate } from "@/shopify/restock/shopifyExistingProduct";

const PRODUCT_FOR_MANUAL_VARIANT_QUERY = /* GraphQL */ `
query ProductForManualVariant($id: ID!) {
  product(id: $id) {
    id
    options(first: 5) {
      id
      name
    }
    variants(first: 50) {
      nodes {
        id
        title
        sku
        price
        inventoryItem {
          id
        }
      }
    }
  }
}
`;

const PRODUCT_VARIANTS_BULK_CREATE_MUTATION = /* GraphQL */ `
mutation ManualVariantBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkCreate(productId: $productId, variants: $variants) {
    productVariants {
      id
      title
      price
      inventoryItem {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
`;

function styleSkuBase(existingSkus: Array<string | null | undefined>): string | null {
  for (const raw of existingSkus) {
    const sku = String(raw ?? "").trim();
    if (!sku.includes("-")) continue;
    return sku.split("-").slice(0, -1).join("-");
  }
  return null;
}

/** KickDB size known but no StockX ask — operator must supply sell price. */
export class ManualPriceRequiredError extends Error {
  readonly code = "MANUAL_PRICE_REQUIRED";

  constructor(
    public readonly sizeTitle: string,
    public readonly gtin: string,
    public readonly pricingSource: string
  ) {
    super(
      `Prix StockX introuvable pour GTIN ${gtin} (${pricingSource}) — saisir un prix manuel`
    );
    this.name = "ManualPriceRequiredError";
  }
}

export function isManualPriceRequiredError(err: unknown): err is ManualPriceRequiredError {
  return err instanceof ManualPriceRequiredError;
}

/**
 * Find an existing variant by EU size title, or create one with liquidation pricing:
 * sell = cost − 30%, compareAt = normal website price, inventory cost = StockX touch price.
 */
export async function ensureManualSizeVariant(input: {
  productId: string;
  sizeTitle: string;
  gtin: string;
  dryRun?: boolean;
  /** When StockX pricing missing — liquidation sell price (CHF). */
  manualSellPrice?: number | null;
  /** Optional compare-at for sale badge when pricing is manual. */
  manualCompareAtPrice?: number | null;
}): Promise<{
  variantId: string;
  inventoryItemId: string | null;
  created: boolean;
  price: number;
  compareAt: number | null;
  cost: number | null;
  sizeTitle: string;
}> {
  const sizeTitle = String(input.sizeTitle ?? "").trim();
  if (!isValidEuSizeForCreate(sizeTitle)) {
    throw new Error(`Taille EU invalide: "${sizeTitle || "(vide)"}"`);
  }

  const { data, errors } = await shopifyGraphQL<{
    product: {
      options: Array<{ id: string; name: string }>;
      variants: {
        nodes: Array<{
          id: string;
          title: string | null;
          sku: string | null;
          price: string | null;
          inventoryItem: { id: string } | null;
        }>;
      };
    } | null;
  }>(PRODUCT_FOR_MANUAL_VARIANT_QUERY, { id: input.productId });

  if (errors?.length) {
    throw new Error(`Shopify product read failed: ${errors.map((e) => e.message).join("; ")}`);
  }
  const product = data?.product;
  if (!product) throw new Error("Produit Shopify introuvable");

  const optionId = product.options[0]?.id;
  if (!optionId) throw new Error("Produit sans option taille");

  const siblings = product.variants.nodes;
  const existing = siblings.find((v) => sizeTitlesMatch(v.title, sizeTitle));
  if (existing) {
    const price = Number(existing.price);
    return {
      variantId: existing.id,
      inventoryItemId: existing.inventoryItem?.id ?? null,
      created: false,
      price: Number.isFinite(price) && price > 0 ? price : 149,
      compareAt: null,
      cost: null,
      sizeTitle: existing.title ?? sizeTitle,
    };
  }

  const pricing = await resolvePhysicalRestockPricing(input.gtin);
  let sellPrice = pricing.sellPrice;
  let compareAt = pricing.compareAt;
  let cost = pricing.cost;

  const manualSell = input.manualSellPrice != null ? Number(input.manualSellPrice) : null;
  const manualCompare =
    input.manualCompareAtPrice != null ? Number(input.manualCompareAtPrice) : null;

  if ((!sellPrice || sellPrice <= 0) && manualSell != null && manualSell > 0) {
    sellPrice = manualSell;
    compareAt =
      manualCompare != null && manualCompare > manualSell ? manualCompare : compareAt;
    cost = cost ?? Math.round(manualSell * 0.8 * 100) / 100;
  }

  if (!sellPrice || sellPrice <= 0) {
    throw new ManualPriceRequiredError(sizeTitle, input.gtin, pricing.source);
  }

  if (input.dryRun) {
    return {
      variantId: "dry-run",
      inventoryItemId: null,
      created: true,
      price: sellPrice,
      compareAt,
      cost,
      sizeTitle,
    };
  }

  const styleBase = styleSkuBase(siblings.map((v) => v.sku)) ?? "MANUAL";
  const sku = `${styleBase}-${sizeTitle}`;

  const { data: createData, errors: createErrors } = await shopifyGraphQL<{
    productVariantsBulkCreate: {
      productVariants: Array<{
        id: string;
        title: string | null;
        price: string | null;
        inventoryItem: { id: string } | null;
      }>;
      userErrors: Array<{ field?: string[] | null; message: string }>;
    };
  }>(PRODUCT_VARIANTS_BULK_CREATE_MUTATION, {
    productId: input.productId,
    variants: [
      {
        price: sellPrice.toFixed(2),
        barcode: input.gtin,
        optionValues: [{ optionId, name: sizeTitle }],
        inventoryItem: {
          sku,
          tracked: true,
          cost: (cost ?? sellPrice * 0.8).toFixed(2),
        },
      },
    ],
  });

  if (createErrors?.length) {
    throw new Error(
      `Shopify variant create failed: ${createErrors.map((e) => e.message).join("; ")}`
    );
  }

  const userErrors = createData?.productVariantsBulkCreate?.userErrors ?? [];
  if (userErrors.length) {
    throw new Error(
      `productVariantsBulkCreate: ${userErrors.map((e) => e.message).join("; ")}`
    );
  }

  const created = createData?.productVariantsBulkCreate?.productVariants?.[0];
  if (!created?.id) {
    throw new Error("Variante créée mais id manquant");
  }

  if (compareAt != null && compareAt > sellPrice) {
    await applyVariantSalePrice({
      productId: input.productId,
      variantId: created.id,
      salePrice: sellPrice,
      compareAtPrice: compareAt,
    });
  }

  return {
    variantId: created.id,
    inventoryItemId: created.inventoryItem?.id ?? null,
    created: true,
    price: sellPrice,
    compareAt,
    cost,
    sizeTitle: created.title ?? sizeTitle,
  };
}
