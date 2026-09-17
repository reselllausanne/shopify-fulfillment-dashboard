/**
 * Read-only Google Merchant Reports adapter for price competitiveness + price insights.
 *
 * Uses Merchant Reports API (`reports/v1`, fallback `reports/v1beta`).
 * Never imports or calls product insert/update/delete endpoints.
 */
import { resolveMerchantOauthConfig } from "@/adsanalytics/config";
import { backoffDelayMs } from "@/adsanalytics/google/adsClient";
import { getAccessTokenForOAuth, GoogleAuthError } from "@/adsanalytics/google/oauth";
import {
  computeBenchmarkGap,
  parseGooglePrice,
  parseMerchantProductId,
} from "@/adsanalytics/merchant/pricingNormalize";
import type {
  MerchantConnectionStatus,
  MerchantQueryStatus,
  MerchantReportResult,
  PriceCompetitivenessRow,
  PriceInsightsRow,
  PriceReportOptions,
} from "@/adsanalytics/merchant/pricingTypes";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const HTTP_TIMEOUT_MS = 45_000;
const DEFAULT_LIMIT = 50;
const DEFAULT_PAGE_SIZE = 50;
const MAX_ATTEMPTS = 5;

const REPORTS_V1 = "https://merchantapi.googleapis.com/reports/v1";
const ACCOUNTS_V1 = "https://merchantapi.googleapis.com/accounts/v1";
const DATASOURCES_V1 = "https://merchantapi.googleapis.com/datasources/v1";

const CONTENT_SCOPE = "https://www.googleapis.com/auth/content";

export class MerchantPricingApiError extends Error {
  readonly status: number;
  readonly body: string;
  readonly classified: MerchantQueryStatus;

  constructor(status: number, body: string, classified: MerchantQueryStatus) {
    super(`Merchant pricing API error (HTTP ${status}): ${body.slice(0, 400)}`);
    this.name = "MerchantPricingApiError";
    this.status = status;
    this.body = body;
    this.classified = classified;
  }
}

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : null;
}

export function classifyMerchantPricingError(status: number, body: string): MerchantQueryStatus {
  const lc = body.toLowerCase();
  if (status === 401) return "auth_failed";
  if (status === 429) return "quota_exceeded";
  if (
    lc.includes("access_token_scope_insufficient") ||
    lc.includes("insufficient authentication scopes") ||
    lc.includes("insufficientpermissions") ||
    (lc.includes("scope") && lc.includes("insufficient"))
  ) {
    return "scope_insufficient";
  }
  if (
    lc.includes("service_disabled") ||
    lc.includes("api has not been used") ||
    lc.includes("access not configured") ||
    (lc.includes("merchantapi.googleapis.com") && lc.includes("disabled"))
  ) {
    return "api_not_enabled";
  }
  if (
    lc.includes("price competitiveness") ||
    lc.includes("price insights") ||
    lc.includes("market insights") ||
    lc.includes("not eligible") ||
    lc.includes("insights are not available") ||
    lc.includes("competitiveness is not available")
  ) {
    return "market_insights_unavailable";
  }
  if (lc.includes("gtin") && (lc.includes("match") || lc.includes("required") || lc.includes("missing"))) {
    return "no_gtin_matches";
  }
  if (status === 403 || status === 404) return "permission_denied";
  return "error";
}

type ReportSearchResponse = {
  results?: Array<Record<string, unknown>>;
  nextPageToken?: string;
};

async function requestJson(
  url: string,
  method: "GET" | "POST",
  body: unknown = null,
  maxAttempts = MAX_ATTEMPTS
): Promise<{ status: number; json: Record<string, unknown> }> {
  const oauth = resolveMerchantOauthConfig();
  let lastErr: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let token: string;
    try {
      token = await getAccessTokenForOAuth(oauth);
    } catch (err) {
      if (err instanceof GoogleAuthError) {
        throw new MerchantPricingApiError(
          err.status,
          err.message,
          err.status === 401 || err.status === 400 ? "auth_failed" : "error"
        );
      }
      throw err;
    }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), HTTP_TIMEOUT_MS);
    let res: Response;
    let text = "";
    try {
      res = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: body == null ? undefined : JSON.stringify(body),
        signal: ctl.signal,
      });
      text = await res.text();
    } catch (err) {
      clearTimeout(timer);
      const isAbort = err instanceof Error && err.name === "AbortError";
      if (isAbort || attempt < maxAttempts) {
        lastErr = isAbort
          ? new MerchantPricingApiError(408, `timeout after ${HTTP_TIMEOUT_MS}ms`, "timeout")
          : err;
        if (attempt < maxAttempts) {
          await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
          continue;
        }
      }
      if (isAbort) {
        throw new MerchantPricingApiError(408, `timeout after ${HTTP_TIMEOUT_MS}ms`, "timeout");
      }
      throw err;
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) {
      try {
        return { status: res.status, json: text ? (JSON.parse(text) as Record<string, unknown>) : {} };
      } catch {
        return { status: res.status, json: { rawText: text } };
      }
    }

    const classified = classifyMerchantPricingError(res.status, text);
    // Never retry auth / permission / scope / eligibility failures.
    const retryable =
      RETRYABLE_STATUS.has(res.status) &&
      classified !== "auth_failed" &&
      classified !== "scope_insufficient" &&
      classified !== "permission_denied" &&
      classified !== "api_not_enabled" &&
      classified !== "market_insights_unavailable" &&
      classified !== "no_gtin_matches";

    if (retryable && attempt < maxAttempts) {
      lastErr = new MerchantPricingApiError(res.status, text, classified);
      await new Promise((r) => setTimeout(r, backoffDelayMs(attempt)));
      continue;
    }
    throw new MerchantPricingApiError(res.status, text, classified);
  }

  throw lastErr instanceof Error ? lastErr : new Error("Merchant pricing API failed");
}

async function searchReports(
  merchantId: string,
  query: string,
  pageSize: number,
  pageToken: string | null
): Promise<ReportSearchResponse> {
  const payload: { query: string; pageSize: number; pageToken?: string } = { query, pageSize };
  if (pageToken) payload.pageToken = pageToken;

  const url = `${REPORTS_V1}/accounts/${merchantId}/reports:search`;
  const { json } = await requestJson(url, "POST", payload);
  return json as ReportSearchResponse;
}

function unwrapView(
  row: Record<string, unknown>,
  camelKey: string,
  snakeKey: string
): Record<string, unknown> {
  const nested = (row[camelKey] ?? row[snakeKey]) as Record<string, unknown> | undefined;
  if (nested && typeof nested === "object") return nested;
  return row;
}

function matchesCountry(parsedFeedLabel: string | null, countryCode: string, reportCountry?: string): boolean {
  const want = countryCode.trim().toUpperCase();
  if (!want) return true;
  if (reportCountry && reportCountry.trim().toUpperCase() === want) return true;
  if (parsedFeedLabel && parsedFeedLabel.trim().toUpperCase() === want) return true;
  return false;
}

export function mapCompetitivenessRow(
  raw: Record<string, unknown>,
  countryFilter: string
): PriceCompetitivenessRow | null {
  const view = unwrapView(raw, "priceCompetitivenessProductView", "price_competitiveness_product_view");
  const id = asString(view.id);
  const parsed = parseMerchantProductId(id);
  const reportCountry = asString(view.reportCountryCode || view.report_country_code || countryFilter);
  if (!matchesCountry(parsed.feedLabel, countryFilter, reportCountry)) return null;

  const price = parseGooglePrice(
    (view.price as Parameters<typeof parseGooglePrice>[0]) ?? null
  );
  const benchmark = parseGooglePrice(
    (view.benchmarkPrice as Parameters<typeof parseGooglePrice>[0]) ??
      (view.benchmark_price as Parameters<typeof parseGooglePrice>[0]) ??
      null
  );
  const offerId =
    asString(view.offerId || view.offer_id) || parsed.offerId || null;

  return {
    merchantProductId: id || offerId || "",
    offerId: offerId || null,
    title: asString(view.title) || null,
    brand: asString(view.brand) || null,
    countryCode: (reportCountry || countryFilter || "CH").toUpperCase(),
    currentPrice: price.amount,
    currency: price.currency,
    benchmarkPrice: benchmark.amount,
    benchmarkCurrency: benchmark.currency,
  };
}

export function mapInsightsRow(
  raw: Record<string, unknown>,
  countryFilter: string
): PriceInsightsRow | null {
  const view = unwrapView(raw, "priceInsightsProductView", "price_insights_product_view");
  const id = asString(view.id);
  const parsed = parseMerchantProductId(id);
  if (countryFilter && !matchesCountry(parsed.feedLabel, countryFilter)) return null;

  const price = parseGooglePrice((view.price as Parameters<typeof parseGooglePrice>[0]) ?? null);
  const suggested = parseGooglePrice(
    (view.suggestedPrice as Parameters<typeof parseGooglePrice>[0]) ??
      (view.suggested_price as Parameters<typeof parseGooglePrice>[0]) ??
      null
  );
  const offerId = asString(view.offerId || view.offer_id) || parsed.offerId || null;

  return {
    merchantProductId: id || offerId || "",
    offerId: offerId || null,
    title: asString(view.title) || null,
    brand: asString(view.brand) || null,
    currentPrice: price.amount,
    currency: price.currency,
    suggestedPrice: suggested.amount,
    suggestedCurrency: suggested.currency,
    predictedImpressionsChange: asNumber(
      view.predictedImpressionsChangeFraction ?? view.predicted_impressions_change_fraction
    ),
    predictedClicksChange: asNumber(
      view.predictedClicksChangeFraction ?? view.predicted_clicks_change_fraction
    ),
    predictedConversionsChange: asNumber(
      view.predictedConversionsChangeFraction ?? view.predicted_conversions_change_fraction
    ),
  };
}

function buildCompetitivenessQuery(countryCode: string, limit: number): string {
  const country = countryCode.trim().toUpperCase() || "CH";
  // Merchant Reports MCQL (stable): flat fields on price_competitiveness_product_view.
  // Equivalent intent to legacy Content nested product_view.* / price_competitiveness.* paths.
  return [
    "SELECT id, offer_id, title, brand, price, report_country_code, benchmark_price",
    "FROM price_competitiveness_product_view",
    `WHERE report_country_code = '${country}'`,
    `LIMIT ${Math.max(1, limit)}`,
  ].join(" ");
}

function buildInsightsQuery(limit: number): string {
  return [
    "SELECT id, offer_id, title, brand, price, suggested_price,",
    "predicted_impressions_change_fraction, predicted_clicks_change_fraction,",
    "predicted_conversions_change_fraction",
    "FROM price_insights_product_view",
    `LIMIT ${Math.max(1, limit)}`,
  ].join(" ");
}

async function paginateMapped<T>(
  merchantId: string,
  query: string,
  limit: number,
  pageSize: number,
  mapRow: (raw: Record<string, unknown>) => T | null
): Promise<MerchantReportResult<T>> {
  const rows: T[] = [];
  let pageToken: string | null = null;
  let pages = 0;
  const maxPages = Math.max(1, Math.ceil(limit / Math.max(1, pageSize)) + 2);

  try {
    while (rows.length < limit && pages < maxPages) {
      const remaining = limit - rows.length;
      const size = Math.min(pageSize, Math.max(remaining, 1));
      const page = await searchReports(merchantId, query, size, pageToken);
      pages += 1;
      const results = Array.isArray(page.results) ? page.results : [];
      for (const raw of results) {
        if (rows.length >= limit) break;
        const mapped = mapRow(raw);
        if (mapped) rows.push(mapped);
      }
      pageToken = page.nextPageToken ? String(page.nextPageToken) : null;
      if (!pageToken || results.length === 0) break;
    }
    return {
      status: rows.length === 0 ? "empty" : "ok",
      rows,
      detail: rows.length === 0 ? "report accessible but empty" : null,
      httpStatus: 200,
    };
  } catch (err) {
    if (err instanceof MerchantPricingApiError) {
      return {
        status: err.classified,
        rows: [],
        detail: err.message.slice(0, 400),
        httpStatus: err.status,
      };
    }
    return {
      status: "error",
      rows: [],
      detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
      httpStatus: null,
    };
  }
}

export type MerchantPricingClient = {
  testConnection(): Promise<MerchantConnectionStatus>;
  getPriceCompetitiveness(options?: PriceReportOptions): Promise<MerchantReportResult<PriceCompetitivenessRow>>;
  getPriceCompetitivenessForOffers(options: {
    countryCode?: string;
    offerIds: string[];
    concurrency?: number;
  }): Promise<MerchantReportResult<PriceCompetitivenessRow>>;
  getPriceInsights(options?: PriceReportOptions): Promise<MerchantReportResult<PriceInsightsRow>>;
};

export function createMerchantPricingClient(merchantId: string): MerchantPricingClient {
  const accountId = merchantId.replace(/[^0-9]/g, "") || merchantId;

  return {
    async testConnection(): Promise<MerchantConnectionStatus> {
      let accessTokenObtained = false;
      let contentScopePresent: boolean | null = null;
      let tokenScopes: string[] = [];
      try {
        const oauth = resolveMerchantOauthConfig();
        const token = await getAccessTokenForOAuth(oauth);
        accessTokenObtained = true;

        try {
          const infoUrl = `https://www.googleapis.com/oauth2/v3/tokeninfo?access_token=${encodeURIComponent(token)}`;
          const ctl = new AbortController();
          const timer = setTimeout(() => ctl.abort(), 15_000);
          const res = await fetch(infoUrl, { signal: ctl.signal });
          clearTimeout(timer);
          const text = await res.text();
          if (res.ok) {
            const parsed = JSON.parse(text) as { scope?: string };
            tokenScopes = (parsed.scope ?? "")
              .split(" ")
              .map((s) => s.trim())
              .filter(Boolean);
            contentScopePresent = tokenScopes.includes(CONTENT_SCOPE);
          }
        } catch {
          contentScopePresent = null;
        }

        if (contentScopePresent === false) {
          return {
            ok: false,
            accountId,
            accountAccessible: false,
            accessTokenObtained,
            contentScopePresent,
            tokenScopes,
            status: "scope_insufficient",
            detail: `missing ${CONTENT_SCOPE}`,
          };
        }

        try {
          const { json } = await requestJson(
            `${ACCOUNTS_V1}/accounts/${accountId}`,
            "GET",
            null,
            2
          );
          const returned =
            asString(json.accountId) ||
            asString(json.account) ||
            asString(json.name).split("/").pop() ||
            accountId;
          return {
            ok: true,
            accountId: returned,
            accountAccessible: true,
            accessTokenObtained,
            contentScopePresent,
            tokenScopes,
            status: "ok",
            detail: null,
          };
        } catch (accountErr) {
          // Fallback probe used by existing merchantAuthCheck when accounts GET differs.
          const { json } = await requestJson(
            `${DATASOURCES_V1}/accounts/${accountId}/dataSources?pageSize=1`,
            "GET",
            null,
            1
          );
          void json;
          return {
            ok: true,
            accountId,
            accountAccessible: true,
            accessTokenObtained,
            contentScopePresent,
            tokenScopes,
            status: "ok",
            detail:
              accountErr instanceof Error
                ? `accounts.v1 probe failed; datasources.v1 reachable (${accountErr.message.slice(0, 120)})`
                : "accounts.v1 probe failed; datasources.v1 reachable",
          };
        }
      } catch (err) {
        if (err instanceof MerchantPricingApiError) {
          return {
            ok: false,
            accountId,
            accountAccessible: false,
            accessTokenObtained,
            contentScopePresent,
            tokenScopes,
            status: err.classified,
            detail: err.message.slice(0, 400),
          };
        }
        if (err instanceof GoogleAuthError) {
          return {
            ok: false,
            accountId,
            accountAccessible: false,
            accessTokenObtained: false,
            contentScopePresent,
            tokenScopes,
            status: "auth_failed",
            detail: err.message.slice(0, 400),
          };
        }
        return {
          ok: false,
          accountId,
          accountAccessible: false,
          accessTokenObtained,
          contentScopePresent,
          tokenScopes,
          status: "error",
          detail: (err instanceof Error ? err.message : String(err)).slice(0, 400),
        };
      }
    },

    async getPriceCompetitiveness(
      options: PriceReportOptions = {}
    ): Promise<MerchantReportResult<PriceCompetitivenessRow>> {
      const country = (options.countryCode ?? "CH").trim().toUpperCase() || "CH";
      const limit = options.limit ?? DEFAULT_LIMIT;
      const pageSize = options.pageSize ?? Math.min(DEFAULT_PAGE_SIZE, limit);
      const query = buildCompetitivenessQuery(country, limit);
      return paginateMapped(accountId, query, limit, pageSize, (raw) =>
        mapCompetitivenessRow(raw, country)
      );
    },

    /**
     * Look up CH competitiveness for specific Merchant/Ads offer ids (both casings tried).
     * Read-only. Bounded concurrency. Empty per-offer is OK.
     */
    async getPriceCompetitivenessForOffers(options: {
      countryCode?: string;
      offerIds: string[];
      concurrency?: number;
    }): Promise<MerchantReportResult<PriceCompetitivenessRow>> {
      const country = (options.countryCode ?? "CH").trim().toUpperCase() || "CH";
      const concurrency = Math.max(1, Math.min(options.concurrency ?? 6, 12));
      const unique = Array.from(
        new Set(
          options.offerIds
            .flatMap((id) => {
              const raw = id.trim();
              if (!raw) return [];
              const variants = new Set<string>([raw]);
              // Ads often lowercases; Merchant feed often shopify_CH_...
              variants.add(raw.toLowerCase());
              variants.add(raw.replace(/^shopify_ch_/i, "shopify_CH_"));
              variants.add(raw.replace(/^shopify_CH_/i, "shopify_ch_"));
              return Array.from(variants);
            })
            .filter(Boolean)
        )
      );

      const rows: PriceCompetitivenessRow[] = [];
      const seenOffer = new Set<string>();
      let lastStatus: MerchantQueryStatus = "empty";
      let lastDetail: string | null = null;
      let httpStatus: number | null = 200;

      for (let i = 0; i < unique.length; i += concurrency) {
        const chunk = unique.slice(i, i + concurrency);
        const results = await Promise.all(
          chunk.map(async (offerId) => {
            const safe = offerId.replace(/'/g, "\\'");
            const query = [
              "SELECT id, offer_id, title, brand, price, report_country_code, benchmark_price",
              "FROM price_competitiveness_product_view",
              `WHERE report_country_code = '${country}' AND offer_id = '${safe}'`,
              "LIMIT 5",
            ].join(" ");
            return paginateMapped(accountId, query, 5, 5, (raw) =>
              mapCompetitivenessRow(raw, country)
            );
          })
        );

        for (const result of results) {
          if (result.status !== "ok" && result.status !== "empty") {
            lastStatus = result.status;
            lastDetail = result.detail;
            httpStatus = result.httpStatus;
            // Auth/scope failures should abort the batch.
            if (
              result.status === "auth_failed" ||
              result.status === "scope_insufficient" ||
              result.status === "permission_denied" ||
              result.status === "api_not_enabled"
            ) {
              return { status: result.status, rows: [], detail: result.detail, httpStatus };
            }
            continue;
          }
          for (const row of result.rows) {
            const key = (row.offerId ?? row.merchantProductId).toLowerCase();
            if (seenOffer.has(key)) continue;
            seenOffer.add(key);
            rows.push(row);
          }
        }
      }

      if (rows.length > 0) {
        return { status: "ok", rows, detail: null, httpStatus: 200 };
      }
      return {
        status: lastStatus === "ok" ? "empty" : lastStatus,
        rows: [],
        detail: lastDetail ?? "no competitiveness rows for requested offer ids",
        httpStatus,
      };
    },

    async getPriceInsights(
      options: PriceReportOptions = {}
    ): Promise<MerchantReportResult<PriceInsightsRow>> {
      const country = (options.countryCode ?? "CH").trim().toUpperCase() || "CH";
      const limit = options.limit ?? DEFAULT_LIMIT;
      const pageSize = options.pageSize ?? Math.min(DEFAULT_PAGE_SIZE, limit);
      // Insights view has no country column; over-fetch then post-filter by feed label in id.
      const fetchLimit = Math.min(Math.max(limit * 5, limit), 500);
      const query = buildInsightsQuery(fetchLimit);
      const result = await paginateMapped(accountId, query, fetchLimit, pageSize, (raw) =>
        mapInsightsRow(raw, "")
      );
      if (result.status !== "ok" && result.status !== "empty") return result;
      const countryMatched = result.rows.filter((row) => {
        const parsed = parseMerchantProductId(row.merchantProductId);
        return matchesCountry(parsed.feedLabel, country);
      });
      const rows = countryMatched.slice(0, limit);
      if (rows.length === 0) {
        return {
          ...result,
          rows,
          status: "empty",
          detail:
            result.rows.length === 0
              ? "report accessible but empty"
              : `report accessible but empty after ${country} filter (${result.rows.length} non-${country} rows dropped)`,
        };
      }
      return {
        ...result,
        rows,
        status: "ok",
        detail: null,
      };
    },
  };
}

/** Merge competitiveness + insights into engine-facing signals (read-only). */
export function mergePricingSignals(
  competitiveness: PriceCompetitivenessRow[],
  insights: PriceInsightsRow[],
  countryCode: string,
  capturedAt = new Date()
): import("@/adsanalytics/merchant/pricingTypes").MerchantPricingSignal[] {
  type Signal = import("@/adsanalytics/merchant/pricingTypes").MerchantPricingSignal;
  const byKey = new Map<string, Signal>();

  const keyOf = (offerId: string | null, merchantProductId: string) =>
    (offerId && offerId.trim()) || merchantProductId;

  for (const row of competitiveness) {
    const gap = computeBenchmarkGap(row.currentPrice, row.benchmarkPrice);
    byKey.set(keyOf(row.offerId, row.merchantProductId), {
      merchantProductId: row.merchantProductId,
      offerId: row.offerId,
      title: row.title,
      brand: row.brand,
      countryCode: row.countryCode || countryCode,
      currentPrice: row.currentPrice,
      currency: row.currency ?? row.benchmarkCurrency,
      benchmarkPrice: row.benchmarkPrice,
      benchmarkGapAmount: gap.gapAmount,
      benchmarkGapPercent: gap.gapPercent,
      suggestedPrice: null,
      predictedImpressionsChange: null,
      predictedClicksChange: null,
      predictedConversionsChange: null,
      capturedAt,
    });
  }

  for (const row of insights) {
    const key = keyOf(row.offerId, row.merchantProductId);
    const existing = byKey.get(key);
    if (existing) {
      existing.suggestedPrice = row.suggestedPrice;
      existing.predictedImpressionsChange = row.predictedImpressionsChange;
      existing.predictedClicksChange = row.predictedClicksChange;
      existing.predictedConversionsChange = row.predictedConversionsChange;
      if (existing.currentPrice == null) existing.currentPrice = row.currentPrice;
      if (existing.currency == null) existing.currency = row.currency ?? row.suggestedCurrency;
      if (!existing.title) existing.title = row.title;
      if (!existing.brand) existing.brand = row.brand;
    } else {
      byKey.set(key, {
        merchantProductId: row.merchantProductId,
        offerId: row.offerId,
        title: row.title,
        brand: row.brand,
        countryCode,
        currentPrice: row.currentPrice,
        currency: row.currency ?? row.suggestedCurrency,
        benchmarkPrice: null,
        benchmarkGapAmount: null,
        benchmarkGapPercent: null,
        suggestedPrice: row.suggestedPrice,
        predictedImpressionsChange: row.predictedImpressionsChange,
        predictedClicksChange: row.predictedClicksChange,
        predictedConversionsChange: row.predictedConversionsChange,
        capturedAt,
      });
    }
  }

  return Array.from(byKey.values());
}
