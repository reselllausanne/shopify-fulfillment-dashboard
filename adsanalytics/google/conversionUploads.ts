/**
 * Google Ads click conversion upload (UPLOAD_CLICKS). Used only by the G4 Secondary
 * shadow path — never against production Simprosys conversion actions.
 */
import type { AdsConfig } from "@/adsanalytics/config";
import { getAccessToken } from "@/adsanalytics/google/oauth";
import {
  GoogleAdsApiError,
  backoffDelayMs,
  type MutateOptions,
  type MutateResponse,
} from "@/adsanalytics/google/adsClient";

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_TIMEOUT_MS = 120_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function buildUploadClickConversionsUrl(config: AdsConfig): string {
  return `https://googleads.googleapis.com/${config.apiVersion}/customers/${config.customerId}:uploadClickConversions`;
}

/**
 * POST customers/{id}:uploadClickConversions
 * @see https://developers.google.com/google-ads/api/reference/rpc/v25/ConversionUploadService
 */
export async function uploadClickConversions(
  config: AdsConfig,
  conversions: unknown[],
  options: MutateOptions = {},
): Promise<MutateResponse> {
  if (conversions.length === 0) return { results: [], partialFailureError: null };

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const url = buildUploadClickConversionsUrl(config);
  const body: Record<string, unknown> = {
    conversions,
    partialFailure: options.partialFailure !== false,
  };
  if (options.validateOnly) body.validateOnly = true;

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
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (res.ok) {
        const parsed = JSON.parse(text || "{}") as {
          results?: Array<Record<string, unknown>>;
          partialFailureError?: unknown;
        };
        return {
          results: parsed.results ?? [],
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
  throw lastError instanceof Error ? lastError : new Error("uploadClickConversions failed");
}
