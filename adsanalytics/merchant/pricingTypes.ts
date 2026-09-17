/**
 * Normalized Merchant Center pricing signals for a future self-learning pricing engine.
 * Google-specific JSON stays inside the adapter; callers consume this shape only.
 */

export type MerchantPricingSignal = {
  merchantProductId: string;
  offerId: string | null;
  title: string | null;
  brand: string | null;
  countryCode: string;
  currentPrice: number | null;
  currency: string | null;
  benchmarkPrice: number | null;
  benchmarkGapAmount: number | null;
  benchmarkGapPercent: number | null;
  suggestedPrice: number | null;
  predictedImpressionsChange: number | null;
  predictedClicksChange: number | null;
  predictedConversionsChange: number | null;
  capturedAt: Date;
};

export type ParsedMerchantProductId = {
  merchantProductId: string;
  channel: string | null;
  languageCode: string | null;
  feedLabel: string | null;
  offerId: string | null;
};

export type MerchantQueryStatus =
  | "ok"
  | "empty"
  | "auth_failed"
  | "scope_insufficient"
  | "permission_denied"
  | "api_not_enabled"
  | "market_insights_unavailable"
  | "no_gtin_matches"
  | "quota_exceeded"
  | "timeout"
  | "error";

export type MerchantConnectionStatus = {
  ok: boolean;
  accountId: string | null;
  accountAccessible: boolean;
  accessTokenObtained: boolean;
  contentScopePresent: boolean | null;
  tokenScopes: string[];
  status: MerchantQueryStatus;
  detail: string | null;
};

export type PriceReportOptions = {
  countryCode?: string;
  limit?: number;
  pageSize?: number;
};

export type PriceCompetitivenessRow = {
  merchantProductId: string;
  offerId: string | null;
  title: string | null;
  brand: string | null;
  countryCode: string;
  currentPrice: number | null;
  currency: string | null;
  benchmarkPrice: number | null;
  benchmarkCurrency: string | null;
};

export type PriceInsightsRow = {
  merchantProductId: string;
  offerId: string | null;
  title: string | null;
  brand: string | null;
  currentPrice: number | null;
  currency: string | null;
  suggestedPrice: number | null;
  suggestedCurrency: string | null;
  predictedImpressionsChange: number | null;
  predictedClicksChange: number | null;
  predictedConversionsChange: number | null;
};

export type MerchantReportResult<T> = {
  status: MerchantQueryStatus;
  rows: T[];
  detail: string | null;
  httpStatus: number | null;
};
