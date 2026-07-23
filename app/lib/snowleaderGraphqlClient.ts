import { validateGtin } from "@/app/lib/normalize";
import { normalizeBvGtin } from "@/app/lib/snowleaderBvClient";
import {
  classifySnowleaderCategoryLabel,
  inferSnowleaderGender,
  SNOWLEADER_GALAXUS_CATEGORY_IDS,
} from "@/app/lib/snowleaderGalaxusCategories";
import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";
import { resolveSnowleaderVariantEuSize } from "@/app/lib/footwearSizeEu";

const GRAPHQL_URL = "https://api.snowleader.com/graphql/";

/** Hardcoded — only `SCRAPER_SHOPS` env needed to register the shop. */
export const SNOWLEADER_GRAPHQL_STORE = "Store_View_CH_DE";
export const SNOWLEADER_GRAPHQL_CATEGORY_IDS = SNOWLEADER_GALAXUS_CATEGORY_IDS;
/** Small list pages — heavy variant/gallery payload is fetched per SKU. */
export const SNOWLEADER_GRAPHQL_PAGE_SIZE = 5;
export const SNOWLEADER_GRAPHQL_REQUEST_DELAY_MS = 800;
export const SNOWLEADER_GRAPHQL_REQUEST_TIMEOUT_MS = 45_000;
export const SNOWLEADER_GRAPHQL_MAX_RETRIES = 5;

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
  sizeSourceLabel: string | null;
  sizeConversion: "eu" | "us" | "uk" | "raw" | null;
  stock: number;
  inStock: boolean;
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

export type SnowleaderGqlProductSkusPage = {
  totalCount: number;
  currentPage: number;
  pageSize: number;
  skus: string[];
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
  attributes?: Array<{ label?: string | null; code?: string | null; value_index?: number | null }> | null;
  product?: GqlSimpleProduct | null;
};

type GqlMedia = { url?: string | null; position?: number | null; disabled?: boolean | null };

type GqlProductItem = {
  sku?: string | null;
  name?: string | null;
  url_key?: string | null;
  color?: string | null;
  brand?: { name?: string | null } | null;
  image?: { url?: string | null } | null;
  media_gallery?: GqlMedia[] | null;
  description?: { html?: string | null } | null;
  short_description?: { html?: string | null } | null;
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

const PRODUCT_LIST_QUERY = `
query SnowleaderProductList($page: Int!, $pageSize: Int!, $categoryId: String!) {
  products(
    pageSize: $pageSize
    currentPage: $page
    filter: { category_id: { eq: $categoryId } }
  ) {
    total_count
    items {
      sku
    }
  }
}
`;

const PRODUCT_DETAIL_QUERY = `
query SnowleaderProductDetail($sku: String!) {
  products(filter: { sku: { eq: $sku } }) {
    items {
      sku
      name
      url_key
      color
      brand { name }
      image { url }
      media_gallery { url position disabled }
      categories { id name url_path level }
      ... on ConfigurableProduct {
        variants {
          attributes { label code value_index }
          product {
            sku
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
    requestTimeoutMs: SNOWLEADER_GRAPHQL_REQUEST_TIMEOUT_MS,
    maxRetries: SNOWLEADER_GRAPHQL_MAX_RETRIES,
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(max = 400) {
  return Math.floor(Math.random() * max);
}

export function isRetryableSnowleaderGraphqlError(err: unknown): boolean {
  const msg = String((err as Error)?.message ?? err ?? "").toLowerCase();
  return (
    msg.includes("http 429") ||
    msg.includes("http 502") ||
    msg.includes("http 503") ||
    msg.includes("http 504") ||
    msg.includes("gateway time-out") ||
    msg.includes("timeout") ||
    msg.includes("aborted") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed")
  );
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

function variantFromSimpleProduct(input: {
  parentSku: string;
  parentName: string;
  urlKey: string | null;
  brand: string | null;
  imageUrl: string | null;
  imageUrls: string[];
  color: string | null;
  gender: string | null;
  categories: SnowleaderGqlCategory[];
  productType: string | null;
  galaxusKind: GalaxusProductKind | null;
  childSku?: string | null;
  sizeLabel?: string | null;
  sizeSourceLabel?: string | null;
  sizeConversion?: "eu" | "us" | "uk" | "raw" | null;
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
    sizeSourceLabel: input.sizeSourceLabel ?? input.sizeLabel ?? null,
    sizeConversion: input.sizeConversion ?? null,
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
    descriptionHtml: null,
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
  const shared = {
    parentSku,
    parentName,
    urlKey,
    brand,
    imageUrl,
    imageUrls,
    color,
    gender,
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
      const sizeResolved = resolveSnowleaderVariantEuSize({
        attributes: variant.attributes,
        brand: shared.brand,
        gender: shared.gender,
        galaxusKind: shared.galaxusKind,
      });
      const parsed = variantFromSimpleProduct({
        ...shared,
        childSku: product.sku ? String(product.sku) : null,
        sizeLabel: sizeResolved.sizeLabel,
        sizeSourceLabel: sizeResolved.sourceLabel,
        sizeConversion: sizeResolved.conversion,
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
    sizeSourceLabel: null,
    sizeConversion: null,
    simple: item,
  });
  return simple ? [simple] : [];
}

function mapProductItem(item: GqlProductItem): SnowleaderGqlProduct {
  return {
    sku: String(item.sku ?? ""),
    name: String(item.name ?? item.sku ?? ""),
    urlKey: item.url_key ? String(item.url_key) : null,
    brand: item.brand?.name ? String(item.brand.name) : null,
    imageUrl: item.image?.url ? String(item.image.url) : null,
    categories: normalizeCategories(item.categories),
    variants: expandSnowleaderGraphqlProduct(item),
  };
}

async function fetchSnowleaderGraphqlOnce<T>(
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
    signal: AbortSignal.timeout(cfg.requestTimeoutMs),
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
  return json.data;
}

export async function fetchSnowleaderGraphql<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const cfg = snowleaderGraphqlConfig();
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < cfg.maxRetries; attempt++) {
    try {
      const data = await fetchSnowleaderGraphqlOnce<T>(query, variables);
      if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs + jitterMs(250));
      return data;
    } catch (err) {
      lastErr = err;
      if (!isRetryableSnowleaderGraphqlError(err) || attempt >= cfg.maxRetries - 1) break;
      const backoff = cfg.requestDelayMs * Math.pow(2, attempt + 1) + jitterMs(500);
      await sleep(backoff);
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

export async function fetchSnowleaderProductSkusPage(options: {
  page: number;
  pageSize?: number;
  categoryId: string;
}): Promise<SnowleaderGqlProductSkusPage> {
  const cfg = snowleaderGraphqlConfig();
  const pageSize = options.pageSize ?? cfg.pageSize;
  const data = await fetchSnowleaderGraphql<{
    products?: { total_count?: number; items?: Array<{ sku?: string | null }> };
  }>(PRODUCT_LIST_QUERY, {
    page: Math.max(1, options.page),
    pageSize,
    categoryId: options.categoryId,
  });

  const items = data.products?.items ?? [];
  return {
    totalCount: Number(data.products?.total_count ?? 0),
    currentPage: Math.max(1, options.page),
    pageSize,
    skus: items.map((item) => String(item.sku ?? "").trim()).filter(Boolean),
  };
}

export async function fetchSnowleaderProductBySku(sku: string): Promise<SnowleaderGqlProduct | null> {
  const trimmed = String(sku ?? "").trim();
  if (!trimmed) return null;
  const data = await fetchSnowleaderGraphql<{
    products?: { items?: GqlProductItem[] };
  }>(PRODUCT_DETAIL_QUERY, { sku: trimmed });
  const item = data.products?.items?.[0];
  if (!item) return null;
  return mapProductItem(item);
}

/** @deprecated Use fetchSnowleaderProductSkusPage + fetchSnowleaderProductBySku. */
export async function fetchSnowleaderProductsPage(options: {
  page: number;
  pageSize?: number;
  categoryId: string;
}): Promise<{
  totalCount: number;
  currentPage: number;
  pageSize: number;
  products: SnowleaderGqlProduct[];
}> {
  const list = await fetchSnowleaderProductSkusPage(options);
  const products: SnowleaderGqlProduct[] = [];
  for (const sku of list.skus) {
    const product = await fetchSnowleaderProductBySku(sku);
    if (product) products.push(product);
  }
  return {
    totalCount: list.totalCount,
    currentPage: list.currentPage,
    pageSize: list.pageSize,
    products,
  };
}
