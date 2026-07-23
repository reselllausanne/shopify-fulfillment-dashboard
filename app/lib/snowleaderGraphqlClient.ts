import { validateGtin } from "@/app/lib/normalize";
import { normalizeBvGtin } from "@/app/lib/snowleaderBvClient";
import {
  classifySnowleaderCategoryLabel,
  inferSnowleaderGender,
  SNOWLEADER_GALAXUS_CATEGORY_IDS,
} from "@/app/lib/snowleaderGalaxusCategories";
import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

const GRAPHQL_URL = "https://api.snowleader.com/graphql/";

/** Hardcoded — only `SCRAPER_SHOPS` env needed to register the shop. */
export const SNOWLEADER_GRAPHQL_STORE = "Store_View_CH_DE";
export const SNOWLEADER_GRAPHQL_CATEGORY_IDS = SNOWLEADER_GALAXUS_CATEGORY_IDS;
export const SNOWLEADER_GRAPHQL_PAGE_SIZE = 10;
export const SNOWLEADER_GRAPHQL_REQUEST_DELAY_MS = 300;

export type SnowleaderGqlCategory = {
  id: string;
  name: string;
  urlPath: string | null;
  level: number | null;
};

export type SnowleaderGqlVariant = {
  parentSku: string;
  parentName: string;
  urlKey: string | null;
  childSku: string | null;
  gtin: string;
  sizeLabel: string | null;
  stock: number;
  inStock: boolean;
  /** Snowleader website sell price (CHF TTC) — stored as supplier buy cost. */
  buyPriceChf: number;
  regularPriceChf: number | null;
  discountPercentOff: number | null;
  brand: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  color: string | null;
  gender: string | null;
  descriptionHtml: string | null;
  categories: SnowleaderGqlCategory[];
  productType: string | null;
  galaxusKind: GalaxusProductKind | null;
};

export type SnowleaderGqlProduct = {
  sku: string;
  name: string;
  urlKey: string | null;
  brand: string | null;
  imageUrl: string | null;
  categories: SnowleaderGqlCategory[];
  variants: SnowleaderGqlVariant[];
};

export type SnowleaderGqlProductsPage = {
  totalCount: number;
  currentPage: number;
  pageSize: number;
  products: SnowleaderGqlProduct[];
};

type GqlMoney = { value?: number | null };
type GqlPrice = {
  final_price?: GqlMoney | null;
  regular_price?: GqlMoney | null;
  discount?: { percent_off?: number | null; amount_off?: number | null } | null;
};

type GqlInventory = {
  is_in_stock?: boolean | null;
  total_qty?: string | number | null;
};

type GqlSimpleProduct = {
  sku?: string | null;
  ean?: string | null;
  inventory_status?: GqlInventory | null;
  price_range?: { minimum_price?: GqlPrice | null } | null;
};

type GqlConfigurableVariant = {
  attributes?: Array<{ label?: string | null; value_index?: number | null }> | null;
  product?: GqlSimpleProduct | null;
};

type GqlMedia = { url?: string | null; position?: number | null; disabled?: boolean | null };
type GqlHtml = { html?: string | null };

type GqlProductItem = {
  sku?: string | null;
  name?: string | null;
  url_key?: string | null;
  color?: string | null;
  brand?: { name?: string | null } | null;
  image?: { url?: string | null } | null;
  media_gallery?: GqlMedia[] | null;
  description?: GqlHtml | null;
  short_description?: GqlHtml | null;
  categories?: Array<{
    id?: number | string | null;
    name?: string | null;
    url_path?: string | null;
    level?: number | null;
  }> | null;
  variants?: GqlConfigurableVariant[] | null;
  ean?: string | null;
  inventory_status?: GqlInventory | null;
  price_range?: { minimum_price?: GqlPrice | null } | null;
};

const PRODUCTS_PAGE_QUERY = `
query SnowleaderProductsPage($page: Int!, $pageSize: Int!, $categoryId: String!) {
  products(
    pageSize: $pageSize
    currentPage: $page
    filter: { category_id: { eq: $categoryId } }
  ) {
    total_count
    items {
      sku
      name
      url_key
      color
      brand { name }
      image { url }
      media_gallery { url position disabled }
      description { html }
      short_description { html }
      categories { id name url_path level }
      ... on ConfigurableProduct {
        variants {
          attributes { label value_index }
          product {
            sku
            ... on SimpleProduct {
              ean
              inventory_status { is_in_stock total_qty supply_delay date_reappro }
              price_range {
                minimum_price {
                  final_price { value }
                  regular_price { value }
                  discount { percent_off amount_off }
                }
              }
            }
          }
        }
      }
      ... on SimpleProduct {
        ean
        inventory_status { is_in_stock total_qty }
        price_range {
          minimum_price {
            final_price { value }
            regular_price { value }
            discount { percent_off amount_off }
          }
        }
      }
    }
  }
}
`;

export function snowleaderGraphqlConfig() {
  return {
    store: SNOWLEADER_GRAPHQL_STORE,
    categoryIds: SNOWLEADER_GRAPHQL_CATEGORY_IDS,
    pageSize: SNOWLEADER_GRAPHQL_PAGE_SIZE,
    requestDelayMs: SNOWLEADER_GRAPHQL_REQUEST_DELAY_MS,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseMoney(value: unknown): number | null {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 100) / 100;
}

export function parseSnowleaderStock(inventory?: GqlInventory | null): {
  stock: number;
  inStock: boolean;
} {
  const inStock = Boolean(inventory?.is_in_stock);
  const raw = inventory?.total_qty;
  const parsed = Number.parseInt(String(raw ?? "").trim(), 10);
  const stock = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  return { stock: inStock ? stock : 0, inStock: inStock && stock > 0 };
}

function normalizeCategories(
  categories?: GqlProductItem["categories"]
): SnowleaderGqlCategory[] {
  if (!Array.isArray(categories)) return [];
  return categories
    .map((cat) => ({
      id: String(cat?.id ?? "").trim(),
      name: String(cat?.name ?? "").trim(),
      urlPath: cat?.url_path ? String(cat.url_path) : null,
      level: typeof cat?.level === "number" ? cat.level : null,
    }))
    .filter((cat) => cat.id || cat.name);
}

export function pickSnowleaderProductType(categories: SnowleaderGqlCategory[]): string | null {
  if (!categories.length) return null;
  const sorted = [...categories].sort((a, b) => (b.level ?? 0) - (a.level ?? 0));
  return sorted.find((cat) => cat.name)?.name ?? null;
}

function readPriceBlock(price?: GqlPrice | null) {
  const buyPriceChf = parseMoney(price?.final_price?.value);
  const regularPriceChf = parseMoney(price?.regular_price?.value);
  const discountPercentOff = Number(price?.discount?.percent_off);
  return {
    buyPriceChf,
    regularPriceChf,
    discountPercentOff: Number.isFinite(discountPercentOff) ? discountPercentOff : null,
  };
}

function extractImageUrls(item: GqlProductItem): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (raw?: string | null) => {
    const url = String(raw ?? "").trim();
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push(url);
  };
  const gallery = [...(item.media_gallery ?? [])].sort(
    (a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0)
  );
  for (const entry of gallery) {
    if (entry?.disabled) continue;
    push(entry?.url);
  }
  push(item.image?.url);
  return out.slice(0, 9);
}

function readDescriptionHtml(item: GqlProductItem): string | null {
  const html = String(item.description?.html ?? item.short_description?.html ?? "").trim();
  return html || null;
}

function variantFromSimpleProduct(input: {
  parentSku: string;
  parentName: string;
  urlKey: string | null;
  brand: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  color: string | null;
  gender: string | null;
  descriptionHtml: string | null;
  categories: SnowleaderGqlCategory[];
  productType: string | null;
  galaxusKind: GalaxusProductKind | null;
  childSku?: string | null;
  sizeLabel?: string | null;
  simple: GqlSimpleProduct;
}): SnowleaderGqlVariant | null {
  const gtin = normalizeBvGtin(input.simple.ean);
  if (!gtin || !validateGtin(gtin)) return null;

  const { buyPriceChf, regularPriceChf, discountPercentOff } = readPriceBlock(
    input.simple.price_range?.minimum_price
  );
  if (!buyPriceChf) return null;

  const { stock, inStock } = parseSnowleaderStock(input.simple.inventory_status);
  return {
    parentSku: input.parentSku,
    parentName: input.parentName,
    urlKey: input.urlKey,
    childSku: input.childSku ?? input.simple.sku ?? null,
    gtin,
    sizeLabel: input.sizeLabel ?? null,
    stock,
    inStock,
    buyPriceChf,
    regularPriceChf,
    discountPercentOff,
    brand: input.brand,
    imageUrl: input.imageUrl,
    imageUrls: input.imageUrls,
    color: input.color,
    gender: input.gender,
    descriptionHtml: input.descriptionHtml,
    categories: input.categories,
    productType: input.productType,
    galaxusKind: input.galaxusKind,
  };
}

export function expandSnowleaderGraphqlProduct(item: GqlProductItem): SnowleaderGqlVariant[] {
  const parentSku = String(item.sku ?? "").trim();
  const parentName = String(item.name ?? parentSku).trim() || parentSku;
  if (!parentSku) return [];

  const urlKey = item.url_key ? String(item.url_key) : null;
  const brand = item.brand?.name ? String(item.brand.name) : null;
  const imageUrls = extractImageUrls(item);
  const imageUrl = imageUrls[0] ?? (item.image?.url ? String(item.image.url) : null);
  const categories = normalizeCategories(item.categories);
  const productType = pickSnowleaderProductType(categories);
  const galaxusKind = classifySnowleaderCategoryLabel(productType);
  const color = item.color ? String(item.color).trim() || null : null;
  const gender = inferSnowleaderGender([parentName, ...categories.map((c) => c.name)]);
  const descriptionHtml = readDescriptionHtml(item);
  const shared = {
    parentSku,
    parentName,
    urlKey,
    brand,
    imageUrl,
    imageUrls,
    color,
    gender,
    descriptionHtml,
    categories,
    productType,
    galaxusKind,
  };
  const variants = Array.isArray(item.variants) ? item.variants : [];

  if (variants.length > 0) {
    const out: SnowleaderGqlVariant[] = [];
    for (const variant of variants) {
      const product = variant.product;
      if (!product) continue;
      const sizeLabel = String(variant.attributes?.[0]?.label ?? "").trim() || null;
      const parsed = variantFromSimpleProduct({
        ...shared,
        childSku: product.sku ? String(product.sku) : null,
        sizeLabel,
        simple: product,
      });
      if (parsed) out.push(parsed);
    }
    return out;
  }

  const simple = variantFromSimpleProduct({
    ...shared,
    childSku: parentSku,
    sizeLabel: null,
    simple: item,
  });
  return simple ? [simple] : [];
}

export async function fetchSnowleaderGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const cfg = snowleaderGraphqlConfig();
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Origin: "https://www.snowleader.ch",
      Referer: "https://www.snowleader.ch/",
      Store: cfg.store,
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Snowleader GraphQL HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    data?: T;
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).filter(Boolean).join("; ") || "GraphQL error");
  }
  if (!json.data) throw new Error("Snowleader GraphQL returned no data");
  if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
  return json.data;
}

export async function fetchSnowleaderProductsPage(options: {
  page: number;
  pageSize?: number;
  categoryId: string;
}): Promise<SnowleaderGqlProductsPage> {
  const cfg = snowleaderGraphqlConfig();
  const pageSize = options.pageSize ?? cfg.pageSize;
  const categoryId = options.categoryId;
  const data = await fetchSnowleaderGraphql<{
    products?: {
      total_count?: number;
      items?: GqlProductItem[];
    };
  }>(PRODUCTS_PAGE_QUERY, {
    page: Math.max(1, options.page),
    pageSize,
    categoryId,
  });

  const items = data.products?.items ?? [];
  return {
    totalCount: Number(data.products?.total_count ?? 0),
    currentPage: Math.max(1, options.page),
    pageSize,
    products: items.map((item) => ({
      sku: String(item.sku ?? ""),
      name: String(item.name ?? item.sku ?? ""),
      urlKey: item.url_key ? String(item.url_key) : null,
      brand: item.brand?.name ? String(item.brand.name) : null,
      imageUrl: item.image?.url ? String(item.image.url) : null,
      categories: normalizeCategories(item.categories),
      variants: expandSnowleaderGraphqlProduct(item),
    })),
  };
}
