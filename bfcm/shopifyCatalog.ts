import { prisma } from "@/app/lib/prisma";
import {
  shopifyGraphQL,
  type ShopifyGraphQLResult,
} from "@/lib/shopifyAdmin";
import {
  canonicalSize,
  type OfferVariant,
} from "@/bfcm/offers";

const LIVE_SALE_PRODUCTS_QUERY = /* GraphQL */ `
query BfcmLiveSaleProducts($cursor: String) {
  products(
    first: 10
    after: $cursor
    query: "status:ACTIVE metafields.custom.soldes_48h:true"
  ) {
    pageInfo { hasNextPage endCursor }
    nodes {
      id
      handle
      title
      status
      featuredImage { url }
      variants(first: 50) {
        nodes {
          id
          title
          sku
          barcode
          availableForSale
          price
          compareAtPrice
          image { url }
          selectedOptions { name value }
          delivery48h: metafield(namespace: "custom", key: "delivery_48h") {
            value
          }
        }
      }
    }
  }
}
`;

type ShopifyVariantNode = {
  id: string;
  title: string;
  sku: string | null;
  barcode: string | null;
  availableForSale: boolean;
  price: string;
  compareAtPrice: string | null;
  image: { url: string } | null;
  selectedOptions: Array<{ name: string; value: string }>;
  delivery48h: { value: string | null } | null;
};

type ShopifyProductNode = {
  id: string;
  handle: string;
  title: string;
  status: string;
  featuredImage: { url: string } | null;
  variants: { nodes: ShopifyVariantNode[] };
};

type ProductsPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: ShopifyProductNode[];
  };
};

export type LiveSaleCatalogResult = {
  variants: OfferVariant[];
  fetchedAt: string;
  sourceProductCount: number;
  rejectedVariantCount: number;
};

function isTrue(value: string | null | undefined): boolean {
  return String(value ?? "").trim().toLowerCase() === "true";
}

function numericId(gid: string): string | null {
  const id = gid.split("/").pop()?.trim();
  return id && /^\d+$/.test(id) ? id : null;
}

function variantSize(node: ShopifyVariantNode): string | null {
  const option = node.selectedOptions.find((candidate) =>
    /^(taille|size|pointure)$/i.test(candidate.name.trim()),
  );
  return canonicalSize(option?.value ?? node.title);
}

function money(value: string | null): number | null {
  if (value === null || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

async function loadLiveSaleProducts(): Promise<ShopifyProductNode[]> {
  const products: ShopifyProductNode[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 100; page += 1) {
    const response: ShopifyGraphQLResult<ProductsPage> =
      await shopifyGraphQL<ProductsPage>(
        LIVE_SALE_PRODUCTS_QUERY,
        { cursor },
        { estimatedQueryCost: 100 },
      );
    if (response.errors?.length) {
      throw new Error(
        `BFCM Shopify catalog failed: ${response.errors
          .map((error) => error.message)
          .join("; ")}`,
      );
    }
    const connection: ProductsPage["products"] | undefined =
      response.data?.products;
    if (!connection) throw new Error("BFCM Shopify catalog returned no products");
    products.push(...connection.nodes);
    if (!connection.pageInfo.hasNextPage) return products;
    cursor = connection.pageInfo.endCursor;
    if (!cursor) throw new Error("BFCM Shopify pagination cursor missing");
  }
  throw new Error("BFCM Shopify catalog exceeded pagination limit");
}

/**
 * Live source for automatic cards:
 * active Shopify soldes_48h products + sale price + delivery_48h +
 * positive physical-location mirror stock on that exact variant.
 *
 * Dropship/online inventory never enters available_local_quantity.
 */
export async function loadAutomaticBfcmCatalog(
  now = new Date(),
): Promise<LiveSaleCatalogResult> {
  const products = await loadLiveSaleProducts();
  const allVariants = products.flatMap((product) =>
    product.variants.nodes.map((variant) => ({ product, variant })),
  );
  const variantIds = allVariants.map(({ variant }) => variant.id);
  const stockRows =
    variantIds.length === 0
      ? []
      : await prisma.shopifyVariantLocationStock.groupBy({
          by: ["shopifyVariantId"],
          where: {
            shopifyVariantId: { in: variantIds },
            sourceType: "physical",
            available: { gt: 0 },
          },
          _sum: { available: true },
        });
  const localByVariant = new Map(
    stockRows.map((row) => [
      row.shopifyVariantId,
      Math.max(0, Number(row._sum.available ?? 0)),
    ]),
  );

  const variants: OfferVariant[] = [];
  let rejectedVariantCount = 0;
  for (const { product, variant } of allVariants) {
    const size = variantSize(variant);
    const sale = money(variant.price);
    const reference = money(variant.compareAtPrice);
    const localQuantity = localByVariant.get(variant.id) ?? 0;
    const image = variant.image?.url ?? product.featuredImage?.url ?? "";
    const id = numericId(variant.id);
    if (
      product.status !== "ACTIVE" ||
      variant.availableForSale !== true ||
      !size ||
      !sale ||
      !reference ||
      sale * 2 > reference ||
      !isTrue(variant.delivery48h?.value) ||
      localQuantity <= 0 ||
      !id ||
      !image
    ) {
      rejectedVariantCount += 1;
      continue;
    }
    variants.push({
      variant_id: variant.id,
      model_id: product.id,
      title: product.title,
      size_eu: size,
      campaign_approved: true,
      local_stock_verified: true,
      available_local_quantity: localQuantity,
      delivery_48h_eligible: true,
      reference_validated: true,
      sale_price_chf: sale,
      reference_price_chf: reference,
      image_url: image,
      url: `https://www.resell-lausanne.ch/products/${encodeURIComponent(
        product.handle,
      )}?variant=${id}`,
    });
  }

  return {
    variants,
    fetchedAt: now.toISOString(),
    sourceProductCount: products.length,
    rejectedVariantCount,
  };
}
