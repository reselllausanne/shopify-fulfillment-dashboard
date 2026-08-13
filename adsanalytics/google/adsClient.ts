import type { AdsConfig } from "@/adsanalytics/config";
import { getAccessToken } from "@/adsanalytics/google/oauth";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1_000;
const DEFAULT_TIMEOUT_MS = 120_000;

export type GoogleAdsRow = Record<string, unknown>;

type SearchResponse = {
  results?: GoogleAdsRow[];
  nextPageToken?: string;
  totalResultsCount?: string;
  fieldMask?: string;
};

export type SearchStats = {
  /** One per HTTP call to googleAds:search, i.e. one per page. */
  requests: number;
  pages: number;
  rows: number;
  retries: number;
};

export class GoogleAdsApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`Google Ads API error (HTTP ${status}): ${body}`);
    this.name = "GoogleAdsApiError";
    this.status = status;
    this.body = body;
  }
}

export function buildSearchUrl(config: AdsConfig): string {
  return `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/googleAds:search`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, so parallel retries do not resynchronise. */
export function backoffDelayMs(attempt: number, baseMs = DEFAULT_BASE_DELAY_MS): number {
  const ceiling = baseMs * 2 ** (attempt - 1);
  return Math.floor(Math.random() * ceiling);
}

export type SearchOptions = {
  maxAttempts?: number;
  timeoutMs?: number;
  onStats?: (stats: SearchStats) => void;
  /** Stop after this many rows (probe uses it to avoid pulling a full year). */
  maxRows?: number;
};

async function postSearch(
  config: AdsConfig,
  query: string,
  pageToken: string | null,
  options: SearchOptions,
  stats: SearchStats
): Promise<SearchResponse> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildSearchUrl(config);

  // `pageSize` is deliberately absent: Google Ads Search returns fixed 10 000-row
  // pages and now rejects the field with PAGE_SIZE_NOT_SUPPORTED.
  const payload: { query: string; pageToken?: string } = { query };
  if (pageToken) payload.pageToken = pageToken;

  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const accessToken = await getAccessToken(config);
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "developer-token": config.developerToken,
      "content-type": "application/json",
    };
    if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
      stats.requests += 1;
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();

      if (res.ok) return JSON.parse(text) as SearchResponse;

      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        stats.retries += 1;
        lastError = new GoogleAdsApiError(res.status, text.slice(0, 1000));
        await sleep(backoffDelayMs(attempt));
        continue;
      }

      throw new GoogleAdsApiError(res.status, text.slice(0, 2000));
    } catch (err) {
      if (err instanceof GoogleAdsApiError) throw err;
      // Network error or timeout.
      if (attempt < maxAttempts) {
        stats.retries += 1;
        lastError = err;
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Google Ads search failed");
}

/**
 * Stream every row of a GAQL query, following `nextPageToken` until exhausted.
 * Rows are yielded page by page so callers never hold the whole result set.
 */
export async function* searchRows(
  config: AdsConfig,
  query: string,
  options: SearchOptions = {}
): AsyncGenerator<GoogleAdsRow, SearchStats, void> {
  const stats: SearchStats = { requests: 0, pages: 0, rows: 0, retries: 0 };
  let pageToken: string | null = null;

  do {
    const response: SearchResponse = await postSearch(config, query, pageToken, options, stats);
    stats.pages += 1;

    const results = response.results ?? [];
    for (const row of results) {
      stats.rows += 1;
      yield row;
      if (options.maxRows && stats.rows >= options.maxRows) {
        options.onStats?.(stats);
        return stats;
      }
    }

    pageToken = response.nextPageToken ?? null;
  } while (pageToken);

  options.onStats?.(stats);
  return stats;
}

/** Convenience for small queries where buffering is safe (auth check, campaigns). */
export async function searchAll(
  config: AdsConfig,
  query: string,
  options: SearchOptions = {}
): Promise<{ rows: GoogleAdsRow[]; stats: SearchStats }> {
  const rows: GoogleAdsRow[] = [];
  let stats: SearchStats = { requests: 0, pages: 0, rows: 0, retries: 0 };
  const iterator = searchRows(config, query, { ...options, onStats: (s) => (stats = s) });

  let next = await iterator.next();
  while (!next.done) {
    rows.push(next.value);
    next = await iterator.next();
  }
  if (next.value) stats = next.value;

  return { rows, stats };
}

export type MutateOptions = {
  validateOnly?: boolean;
  maxAttempts?: number;
  timeoutMs?: number;
  /** Partial failure mode for googleAds:mutate (default true). */
  partialFailure?: boolean;
};

export type MutateResponse = {
  results: Array<Record<string, unknown>>;
  partialFailureError: unknown | null;
};

export function buildMutateUrl(config: AdsConfig, service: string): string {
  return `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}/${service}:mutate`;
}

async function postMutate(
  config: AdsConfig,
  service: string,
  body: Record<string, unknown>,
  options: MutateOptions
): Promise<MutateResponse> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildMutateUrl(config, service);
  const payload = options.validateOnly ? { ...body, validateOnly: true } : body;

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const accessToken = await getAccessToken(config);
    const headers: Record<string, string> = {
      authorization: `Bearer ${accessToken}`,
      "developer-token": config.developerToken,
      "content-type": "application/json",
    };
    if (config.loginCustomerId) headers["login-customer-id"] = config.loginCustomerId;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text) as {
          results?: Array<Record<string, unknown>>;
          mutateOperationResponses?: Array<Record<string, unknown>>;
          partialFailureError?: unknown;
        };
        const mutateResults =
          parsed.results ??
          parsed.mutateOperationResponses ??
          [];
        return {
          results: mutateResults,
          partialFailureError: parsed.partialFailureError ?? null,
        };
      }
      if (RETRYABLE_STATUS.has(res.status) && attempt < maxAttempts) {
        lastError = new GoogleAdsApiError(res.status, text.slice(0, 1000));
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw new GoogleAdsApiError(res.status, text.slice(0, 2000));
    } catch (err) {
      if (err instanceof GoogleAdsApiError) throw err;
      if (attempt < maxAttempts) {
        lastError = err;
        await sleep(backoffDelayMs(attempt));
        continue;
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("Google Ads mutate failed");
}

/** Mutate a single Google Ads resource service (e.g. campaigns, assetGroupListingGroupFilters). */
export async function mutateResource(
  config: AdsConfig,
  service: string,
  operations: unknown[],
  options: MutateOptions = {}
): Promise<MutateResponse> {
  if (operations.length === 0) return { results: [], partialFailureError: null };
  return postMutate(config, service, { operations }, options);
}

/** Atomic cross-resource mutate via googleAds:mutate. */
export async function googleAdsMutate(
  config: AdsConfig,
  mutateOperations: unknown[],
  options: MutateOptions = {}
): Promise<MutateResponse> {
  if (mutateOperations.length === 0) return { results: [], partialFailureError: null };
  const body: Record<string, unknown> = { mutateOperations };
  if (options.partialFailure !== false) body.partialFailure = true;
  return postMutate(config, "googleAds", body, options);
}
