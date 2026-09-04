// lib/shopifyAdmin.ts

import { missingShopifyAdminEnvKeys, resolveShopifyAdminEnv } from "@/lib/shopifyEnv";

type ShopifyGqlError = { message: string; extensions?: any };

export type ShopifyGraphQLExtensions = {
  cost?: {
    requestedQueryCost?: number;
    actualQueryCost?: number;
    throttleStatus?: {
      maximumAvailable?: number;
      currentlyAvailable?: number;
      restoreRate?: number;
    };
  };
};

export type ShopifyGraphQLResult<T> = {
  data: T;
  errors?: ShopifyGqlError[];
  extensions?: ShopifyGraphQLExtensions;
};

let shopifyGraphQLChain: Promise<unknown> = Promise.resolve();

type ThrottleSnapshot = {
  available: number;
  restoreRate: number;
  maximumAvailable: number;
  updatedAtMs: number;
};

let throttleSnapshot: ThrottleSnapshot | null = null;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}


function normalizeShopifyOrderIdValue(value: unknown): unknown {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!raw) return value;
  if (raw.startsWith("gid://")) return raw;
  if (/^\d+$/.test(raw)) return `gid://shopify/Order/${raw}`;
  return value;
}

function normalizeShopifyGraphQLVariables(input: unknown): unknown {
  if (Array.isArray(input)) {
    return input.map((item) => normalizeShopifyGraphQLVariables(item));
  }
  if (!input || typeof input !== "object") return input;

  const entries = Object.entries(input as Record<string, unknown>).map(([key, value]) => {
    if (key === "orderId") {
      return [key, normalizeShopifyOrderIdValue(value)];
    }
    return [key, normalizeShopifyGraphQLVariables(value)];
  });
  return Object.fromEntries(entries);
}

function applyThrottleExtensions(extensions: ShopifyGraphQLExtensions | undefined): void {
  const status = extensions?.cost?.throttleStatus;
  if (!status) return;
  throttleSnapshot = {
    available: Number(status.currentlyAvailable ?? 0),
    restoreRate: Number(status.restoreRate ?? 100),
    maximumAvailable: Number(status.maximumAvailable ?? 1000),
    updatedAtMs: Date.now(),
  };
}

function projectedShopifyCapacity(): number {
  if (!throttleSnapshot) return 1000;
  const elapsedMs = Date.now() - throttleSnapshot.updatedAtMs;
  return Math.min(
    throttleSnapshot.maximumAvailable,
    throttleSnapshot.available + (throttleSnapshot.restoreRate * elapsedMs) / 1000
  );
}

async function waitForShopifyCapacity(requiredCost: number): Promise<void> {
  const target = requiredCost + 80;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    if (projectedShopifyCapacity() >= target) return;
    const deficit = target - projectedShopifyCapacity();
    const restoreRate = throttleSnapshot?.restoreRate ?? 100;
    const waitMs = Math.ceil((deficit / restoreRate) * 1000) + 250;
    await sleepMs(Math.min(waitMs, 15000));
  }
}

export async function sleepForShopifyQueryCost(
  extensions: ShopifyGraphQLExtensions | undefined,
  bufferMs = 400
): Promise<void> {
  const spent = Number(
    extensions?.cost?.actualQueryCost ?? extensions?.cost?.requestedQueryCost ?? 100
  );
  const restoreRate = Number(extensions?.cost?.throttleStatus?.restoreRate ?? 100);
  const waitMs = Math.min(8000, Math.max(800, Math.ceil((spent / restoreRate) * 1000) + bufferMs));
  await sleepMs(waitMs);
}

function isRetryableShopifyGraphQLError(errors: ShopifyGqlError[] | undefined): boolean {
  return (errors ?? []).some((error) => {
    const code = String(error?.extensions?.code ?? "").toUpperCase();
    const message = String(error?.message ?? "").toUpperCase();
    return (
      code === "THROTTLED" ||
      code === "MAX_COST_EXCEEDED" ||
      message.includes("THROTTLED") ||
      message.includes("MAX_COST_EXCEEDED")
    );
  });
}

function computeShopifyRetryDelayMs(
  extensions: ShopifyGraphQLExtensions | undefined,
  attempt: number
): number {
  const requested = Number(extensions?.cost?.requestedQueryCost ?? 0);
  const available = Number(extensions?.cost?.throttleStatus?.currentlyAvailable ?? 0);
  const restoreRate = Number(extensions?.cost?.throttleStatus?.restoreRate ?? 100);
  const deficit = Math.max(0, requested - available);
  const restoreWaitMs =
    deficit > 0 && restoreRate > 0 ? Math.ceil((deficit / restoreRate) * 1000) : 0;
  const backoffMs = 1000 + attempt * 800;
  return Math.min(20000, Math.max(backoffMs, restoreWaitMs + 600));
}

async function shopifyGraphQLOnce<T>(
  query: string,
  variables: Record<string, any> = {}
): Promise<ShopifyGraphQLResult<T>> {
  const { shop, token, version } = resolveShopifyAdminEnv();

  if (!shop || !token) {
    const missing = missingShopifyAdminEnvKeys({ shop, token, version });
    throw new Error(`Missing Shopify admin env vars: ${missing.join(", ")}`);
  }

  const url = `https://${shop}/admin/api/${version}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
  });

  const text = await res.text();
  let json: any;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`Shopify response not JSON (status ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${JSON.stringify(json).slice(0, 500)}`);
  }

  return {
    data: json.data as T,
    errors: json.errors as ShopifyGqlError[] | undefined,
    extensions: json.extensions as ShopifyGraphQLExtensions | undefined,
  };
}

export async function shopifyGraphQL<T>(
  query: string,
  variables: Record<string, any> = {},
  options?: { estimatedQueryCost?: number }
): Promise<ShopifyGraphQLResult<T>> {
  const normalizedVariables = normalizeShopifyGraphQLVariables(variables) as Record<string, any>;

  const run = async (): Promise<ShopifyGraphQLResult<T>> => {
    let lastResult: ShopifyGraphQLResult<T> | null = null;
    const estimatedCost = Number(options?.estimatedQueryCost ?? 0);

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const requiredCost =
        estimatedCost > 0
          ? estimatedCost
          : Number(lastResult?.extensions?.cost?.requestedQueryCost ?? 0);
      if (requiredCost > 0) {
        await waitForShopifyCapacity(requiredCost);
      }

      const result = await shopifyGraphQLOnce<T>(query, normalizedVariables);
      lastResult = result;
      applyThrottleExtensions(result.extensions);

      if (!result.errors?.length) {
        return result;
      }

      if (!isRetryableShopifyGraphQLError(result.errors) || attempt >= 14) {
        return result;
      }

      const delayMs = computeShopifyRetryDelayMs(result.extensions, attempt);
      console.warn(
        `[SHOPIFY] GraphQL retry ${attempt + 1}/15 in ${delayMs}ms`,
        result.errors?.[0]?.extensions?.code ?? result.errors?.[0]?.message
      );
      await sleepMs(delayMs);
    }

    return lastResult as ShopifyGraphQLResult<T>;
  };

  const resultPromise = shopifyGraphQLChain.then(run, run);
  shopifyGraphQLChain = resultPromise.then(
    () => undefined,
    () => undefined
  );
  return resultPromise;
}

export function extractEUSize(input?: string | null): string | null {
  if (!input) return null;

  const euMatch = input.match(/EU\s*([0-9]{1,2}(?:\.[0-9])?)/i);
  if (euMatch?.[1]) return `EU ${euMatch[1]}`;

  const plainNumberMatch = input.trim().match(/^([0-9]{1,2}(?:\.[0-9])?)$/);
  if (plainNumberMatch?.[1]) {
    const size = parseFloat(plainNumberMatch[1]);
    if (size >= 35 && size <= 50) {
      return `EU ${plainNumberMatch[1]}`;
    }
  }

  const widthSizeMatch = input.trim().match(/^([0-9]{1,2}(?:\.[0-9])?)([NRMW])$/i);
  if (widthSizeMatch?.[1]) {
    return `EU ${widthSizeMatch[1]}${widthSizeMatch[2].toUpperCase()}`;
  }

  return null;
}
