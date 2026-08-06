/**
 * Phase 1 Google Ads analytics POC — configuration.
 *
 * Read-only: nothing in this domain ever mutates a Google Ads or Merchant
 * Center resource. Secrets come from the environment only, never from Git.
 */

export type AdsConfig = {
  developerToken: string;
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  /** MCC account that owns the login, digits only. Optional for direct accounts. */
  loginCustomerId: string | null;
  /** Account actually queried, digits only. */
  customerId: string;
  apiVersion: string;
  timezone: string;
};

export const DEFAULT_ADS_API_VERSION = "v25";
export const DEFAULT_TIMEZONE = "Europe/Zurich";

const REQUIRED_ENV_KEYS = [
  "GOOGLE_ADS_DEVELOPER_TOKEN",
  "GOOGLE_ADS_CLIENT_ID",
  "GOOGLE_ADS_CLIENT_SECRET",
  "GOOGLE_ADS_REFRESH_TOKEN",
  "GOOGLE_ADS_CUSTOMER_ID",
] as const;

export class AdsConfigError extends Error {
  readonly missing: string[];

  constructor(missing: string[]) {
    super(
      `Missing Google Ads environment variables: ${missing.join(", ")}. ` +
        `Copy the Google Ads block from .env.example into your local .env.`
    );
    this.name = "AdsConfigError";
    this.missing = missing;
  }
}

function readEnv(key: string): string {
  return (process.env[key] ?? "").trim();
}

/** Google Ads rejects customer IDs containing dashes. */
export function normalizeCustomerId(raw: string): string {
  return raw.replace(/[^0-9]/g, "");
}

export function missingAdsEnvKeys(): string[] {
  return REQUIRED_ENV_KEYS.filter((key) => readEnv(key).length === 0);
}

export function resolveAdsConfig(): AdsConfig {
  const missing = missingAdsEnvKeys();
  if (missing.length > 0) throw new AdsConfigError(missing);

  const loginCustomerId = normalizeCustomerId(readEnv("GOOGLE_ADS_LOGIN_CUSTOMER_ID"));

  return {
    developerToken: readEnv("GOOGLE_ADS_DEVELOPER_TOKEN"),
    clientId: readEnv("GOOGLE_ADS_CLIENT_ID"),
    clientSecret: readEnv("GOOGLE_ADS_CLIENT_SECRET"),
    refreshToken: readEnv("GOOGLE_ADS_REFRESH_TOKEN"),
    loginCustomerId: loginCustomerId.length > 0 ? loginCustomerId : null,
    customerId: normalizeCustomerId(readEnv("GOOGLE_ADS_CUSTOMER_ID")),
    apiVersion: readEnv("GOOGLE_ADS_API_VERSION") || DEFAULT_ADS_API_VERSION,
    timezone: readEnv("APP_TIMEZONE") || DEFAULT_TIMEZONE,
  };
}

/** Never print a secret; only whether it is present and how long it is. */
export function describeAdsConfig(config: AdsConfig): Record<string, string> {
  const mask = (value: string) => (value.length > 0 ? `set (${value.length} chars)` : "missing");
  return {
    apiVersion: config.apiVersion,
    customerId: config.customerId,
    loginCustomerId: config.loginCustomerId ?? "(none)",
    developerToken: mask(config.developerToken),
    clientId: mask(config.clientId),
    clientSecret: mask(config.clientSecret),
    refreshToken: mask(config.refreshToken),
    timezone: config.timezone,
  };
}
