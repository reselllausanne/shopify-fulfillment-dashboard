import { validateGtin } from "@/app/lib/normalize";

const BV_BASE = "https://api.bazaarvoice.com/data";
const DEFAULT_PASSKEY = "p3o4rgw304c7mmo27hsfvjlvf";
const DEFAULT_DISPLAY = "14961-de_ch";
const DEFAULT_CATEGORY_SNEAKERS = "596";

export type BvProduct = {
  Id: string;
  Name?: string;
  ImageUrl?: string | null;
  CategoryId?: string;
  Active?: boolean;
  EANs?: string[];
  Brand?: { Id?: string; Name?: string };
  Attributes?: Record<
    string,
    {
      Values?: Array<{ Value?: string }>;
    }
  >;
};

export type BvProductsPage = {
  results: BvProduct[];
  totalResults: number;
  limit: number;
  offset: number;
};

export function snowleaderBvConfig() {
  return {
    passkey: DEFAULT_PASSKEY,
    displayCode: DEFAULT_DISPLAY,
    categoryId: DEFAULT_CATEGORY_SNEAKERS,
    pageSize: 100,
    requestDelayMs: 120,
  };
}

export function normalizeBvGtin(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const digits = String(value).replace(/\D/g, "");
  if (!digits || /^0+$/.test(digits)) return null;
  if (digits.length === 14 && digits.startsWith("0")) {
    const gtin13 = digits.slice(1);
    if (validateGtin(gtin13)) return gtin13;
  }
  if (validateGtin(digits)) return digits;
  return null;
}

export function extractBvGtins(product: BvProduct): string[] {
  const out = new Set<string>();
  for (const raw of product.EANs ?? []) {
    const gtin = normalizeBvGtin(raw);
    if (gtin) out.add(gtin);
  }
  const gtin14 = product.Attributes?.GTIN14?.Values ?? [];
  for (const entry of gtin14) {
    const gtin = normalizeBvGtin(entry?.Value);
    if (gtin) out.add(gtin);
  }
  return [...out];
}

function bvAvailable(product: BvProduct): boolean {
  const values = product.Attributes?.AVAILABILITY?.Values ?? [];
  for (const entry of values) {
    if (String(entry?.Value ?? "").toLowerCase() === "true") return true;
  }
  return Boolean(product.Active);
}

export type SnowleaderBvVariant = {
  bvProductId: string;
  gtin: string;
  brand: string | null;
  name: string;
  categoryId: string | null;
  imageUrl: string | null;
  available: boolean;
};

export function expandBvProduct(product: BvProduct): SnowleaderBvVariant[] {
  const gtins = extractBvGtins(product);
  if (!gtins.length) return [];
  const brand = String(product.Brand?.Name ?? "").trim() || null;
  const name = String(product.Name ?? product.Id ?? "").trim() || product.Id;
  const available = bvAvailable(product);
  return gtins.map((gtin) => ({
    bvProductId: product.Id,
    gtin,
    brand,
    name,
    categoryId: product.CategoryId ? String(product.CategoryId) : null,
    imageUrl: product.ImageUrl ? String(product.ImageUrl) : null,
    available,
  }));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function fetchBvProductsPage(options: {
  offset: number;
  limit?: number;
  categoryId?: string | null;
}): Promise<BvProductsPage> {
  const cfg = snowleaderBvConfig();
  const limit = options.limit ?? cfg.pageSize;
  const params = new URLSearchParams({
    passkey: cfg.passkey,
    apiversion: "5.5",
    displaycode: cfg.displayCode,
    Limit: String(limit),
    Offset: String(Math.max(0, options.offset)),
  });
  const categoryId = options.categoryId ?? cfg.categoryId;
  if (categoryId) params.set("filter", `CategoryId:eq:${categoryId}`);

  const res = await fetch(`${BV_BASE}/products.json?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Referer: "https://www.snowleader.ch/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Bazaarvoice HTTP ${res.status}: ${body.slice(0, 300)}`);
  }
  const json = (await res.json()) as {
    Results?: BvProduct[];
    TotalResults?: number;
    Limit?: number;
    Offset?: number;
    HasErrors?: boolean;
    Errors?: Array<{ Message?: string }>;
  };
  if (json.HasErrors && json.Errors?.length) {
    throw new Error(json.Errors.map((e) => e.Message).filter(Boolean).join("; ") || "Bazaarvoice error");
  }
  if (cfg.requestDelayMs) await sleep(cfg.requestDelayMs);
  return {
    results: json.Results ?? [],
    totalResults: Number(json.TotalResults ?? 0),
    limit: Number(json.Limit ?? limit),
    offset: Number(json.Offset ?? options.offset),
  };
}

export async function fetchBvProductById(productId: string): Promise<BvProduct | null> {
  const cfg = snowleaderBvConfig();
  const params = new URLSearchParams({
    passkey: cfg.passkey,
    apiversion: "5.5",
    displaycode: cfg.displayCode,
    filter: `Id:eq:${productId}`,
    Limit: "1",
  });
  const res = await fetch(`${BV_BASE}/products.json?${params.toString()}`, {
    headers: {
      Accept: "application/json",
      Referer: "https://www.snowleader.ch/",
    },
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) return null;
  const json = (await res.json()) as { Results?: BvProduct[] };
  return json.Results?.[0] ?? null;
}
