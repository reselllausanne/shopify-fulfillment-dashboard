// lib/shopifyAdmin.ts

import {
  missingShopifyAdminEnvKeys,
  resolveShopifyAdminEnv,
  type ShopifyTokenPurpose,
} from "@/lib/shopifyEnv";
import {
  computeAdmissionWaitMs,
  createThrottleStore,
  debitState,
  emptyShopifyApiMetrics,
  envReservePoints,
  formatShopifyApiMetrics,
  stateFromThrottleStatus,
  type ShopifyApiMetrics,
  type ShopifyThrottleStore,
} from "@/lib/shopifyThrottle";

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

export type ShopifyGraphQLOptions = {
  /** Points to admit the first attempt with; defaults to the last requestedQueryCost seen for this query. */
  estimatedQueryCost?: number;
  /**
   * Points left in the bucket after this request. Defaults to SHOPIFY_API_RESERVE_POINTS
   * (set on background workers, unset = 0 for web/interactive calls).
   */
  reservePoints?: number;
  /** "analytics" uses SHOPIFY_ANALYTICS_ACCESS_TOKEN (own bucket) when set. */
  tokenPurpose?: ShopifyTokenPurpose;
};

const UNKNOWN_QUERY_COST = 50;
const MAX_ADMISSION_SLEEP_MS = 5_000;

function sleepMs(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Admission against the shared bucket estimate: waits until
 * `projected available - cost >= reserve`, then debits `cost` optimistically.
 * Real `throttleStatus` from each response overwrites the estimate.
 */
export class ShopifyRateLimiter {
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly store: ShopifyThrottleStore,
    options: { now?: () => number; sleep?: (ms: number) => Promise<void> } = {}
  ) {
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? sleepMs;
  }

  /** Resolves once the request may be sent; returns ms waited. */
  async acquire(cost: number, reserve: number): Promise<number> {
    let waited = 0;
    for (;;) {
      const nowMs = this.now();
      const state = this.store.read();
      const waitMs = computeAdmissionWaitMs({ state, nowMs, cost, reserve });
      if (waitMs <= 0) {
        this.store.write(debitState(state, nowMs, cost));
        return waited;
      }
      // Re-read in chunks: other processes refresh the shared state meanwhile.
      const chunk = Math.min(waitMs + 25, MAX_ADMISSION_SLEEP_MS);
      await this.sleep(chunk);
      waited += chunk;
    }
  }

  observe(extensions: ShopifyGraphQLExtensions | undefined): void {
    const state = stateFromThrottleStatus(extensions?.cost?.throttleStatus, this.now());
    if (state) this.store.write(state);
  }
}

type LimiterSlot = { limiter: ShopifyRateLimiter; chain: Promise<unknown> };
const limiterSlots = new Map<string, LimiterSlot>();
const lastRequestedCostByQuery = new Map<string, number>();

let apiMetrics: ShopifyApiMetrics = emptyShopifyApiMetrics();
let metricsTimer: ReturnType<typeof setInterval> | null = null;

function limiterSlot(shop: string, token: string): LimiterSlot {
  const key = `${shop}|${token}`;
  let slot = limiterSlots.get(key);
  if (!slot) {
    slot = { limiter: new ShopifyRateLimiter(createThrottleStore(shop, token)), chain: Promise.resolve() };
    limiterSlots.set(key, slot);
  }
  return slot;
}

export function getShopifyApiMetrics(): ShopifyApiMetrics {
  return { ...apiMetrics };
}

export function resetShopifyApiMetrics(): void {
  apiMetrics = emptyShopifyApiMetrics();
}

/** One-line summary: points/s used, THROTTLED count, admission wait. */
export function formatShopifyApiMetricsLine(tag = "SHOPIFY_API"): string {
  return `[${tag}] ${formatShopifyApiMetrics(apiMetrics)}`;
}

/** SHOPIFY_API_METRICS_LOG_MS > 0 → periodic metrics line (unref'd timer). */
function ensureMetricsTimer(): void {
  if (metricsTimer) return;
  const everyMs = Number(process.env.SHOPIFY_API_METRICS_LOG_MS ?? 0);
  if (!(everyMs > 0)) return;
  metricsTimer = setInterval(() => console.info(formatShopifyApiMetricsLine()), everyMs);
  metricsTimer.unref?.();
}

function recordResponse(extensions: ShopifyGraphQLExtensions | undefined): void {
  const cost = extensions?.cost;
  if (!cost) return;
  apiMetrics.pointsRequested += Number(cost.requestedQueryCost ?? 0);
  apiMetrics.pointsActual += Number(cost.actualQueryCost ?? 0);
  const available = cost.throttleStatus?.currentlyAvailable;
  if (available != null) {
    const n = Number(available);
    apiMetrics.minAvailableSeen = apiMetrics.minAvailableSeen == null ? n : Math.min(apiMetrics.minAvailableSeen, n);
  }
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

/**
 * Transient transport failures (DNS blips, connection resets, gateway/rate-limit
 * HTTP statuses) throw out of `shopifyGraphQLOnce` before we ever see a GraphQL
 * error body. Left unhandled they abort an entire price-sync batch. Retry them
 * with backoff so the worker and the one-shot reprice survive a flaky network.
 */
function isTransientShopifyTransportError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toUpperCase();
  return (
    /FETCH FAILED|ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|SOCKET HANG UP|NETWORK|UND_ERR|TIMEOUT/.test(
      message
    ) ||
    /HTTP 429|HTTP 500|HTTP 502|HTTP 503|HTTP 504/.test(message) ||
    /NOT JSON \(STATUS 5\d\d\)|NOT JSON \(STATUS 429\)/.test(message)
  );
}

function isThrottledShopifyGraphQLError(errors: ShopifyGqlError[] | undefined): boolean {
  return (errors ?? []).some((error) => {
    const code = String(error?.extensions?.code ?? "").toUpperCase();
    const message = String(error?.message ?? "").toUpperCase();
    return code === "THROTTLED" || message.includes("THROTTLED");
  });
}

async function shopifyGraphQLOnce<T>(
  env: { shop: string; token: string; version: string },
  query: string,
  variables: Record<string, any> = {}
): Promise<ShopifyGraphQLResult<T>> {
  const url = `https://${env.shop}/admin/api/${env.version}/graphql.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "X-Shopify-Access-Token": env.token,
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
  options?: ShopifyGraphQLOptions
): Promise<ShopifyGraphQLResult<T>> {
  const env = resolveShopifyAdminEnv(options?.tokenPurpose ?? "admin");
  if (!env.shop || !env.token) {
    const missing = missingShopifyAdminEnvKeys(env);
    throw new Error(`Missing Shopify admin env vars: ${missing.join(", ")}`);
  }

  const normalizedVariables = normalizeShopifyGraphQLVariables(variables) as Record<string, any>;
  const slot = limiterSlot(env.shop, env.token);
  const reserve = options?.reservePoints ?? envReservePoints();
  ensureMetricsTimer();

  const run = async (): Promise<ShopifyGraphQLResult<T>> => {
    let lastResult: ShopifyGraphQLResult<T> | null = null;
    const estimatedCost = Number(options?.estimatedQueryCost ?? 0);

    for (let attempt = 0; attempt < 15; attempt += 1) {
      const requiredCost =
        Number(lastResult?.extensions?.cost?.requestedQueryCost ?? 0) ||
        (estimatedCost > 0 ? estimatedCost : lastRequestedCostByQuery.get(query) ?? UNKNOWN_QUERY_COST);
      apiMetrics.admissionWaitMs += await slot.limiter.acquire(requiredCost, reserve);

      let result: ShopifyGraphQLResult<T>;
      try {
        apiMetrics.requests += 1;
        result = await shopifyGraphQLOnce<T>(env, query, normalizedVariables);
      } catch (error) {
        if (isTransientShopifyTransportError(error) && attempt < 14) {
          apiMetrics.transportRetries += 1;
          const delayMs = Math.min(20000, 1000 + attempt * 1200);
          console.warn(
            `[SHOPIFY] transport retry ${attempt + 1}/15 in ${delayMs}ms`,
            error instanceof Error ? error.message : String(error)
          );
          await sleepMs(delayMs);
          continue;
        }
        throw error;
      }
      lastResult = result;
      slot.limiter.observe(result.extensions);
      recordResponse(result.extensions);
      const requested = Number(result.extensions?.cost?.requestedQueryCost ?? 0);
      if (requested > 0) {
        // Some callers interpolate values into the query text: keep the cache bounded.
        if (lastRequestedCostByQuery.size >= 500) lastRequestedCostByQuery.clear();
        lastRequestedCostByQuery.set(query, requested);
      }

      if (!result.errors?.length) {
        return result;
      }

      if (!isThrottledShopifyGraphQLError(result.errors) || attempt >= 14) {
        return result;
      }

      apiMetrics.throttled += 1;
      console.warn(
        `[SHOPIFY] THROTTLED retry ${attempt + 1}/15 (requested=${requested}, available=${
          result.extensions?.cost?.throttleStatus?.currentlyAvailable ?? "?"
        })`
      );
      // Next acquire() waits for the bucket to refill; small floor avoids a hot loop.
      await sleepMs(250 + attempt * 250);
    }

    return lastResult as ShopifyGraphQLResult<T>;
  };

  const resultPromise = slot.chain.then(run, run);
  slot.chain = resultPromise.then(
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
