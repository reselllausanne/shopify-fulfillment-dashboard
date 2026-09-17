import type { ParsedMerchantProductId } from "@/adsanalytics/merchant/pricingTypes";

const MICROS_PER_UNIT = 1_000_000;

/** Convert Google amountMicros (string or number) into currency units. */
export function microsToCurrency(micros: string | number | null | undefined): number | null {
  if (micros == null || micros === "") return null;
  const n = typeof micros === "number" ? micros : Number(String(micros).trim());
  if (!Number.isFinite(n)) return null;
  return n / MICROS_PER_UNIT;
}

export type GooglePriceLike = {
  amountMicros?: string | number | null;
  currencyCode?: string | null;
  /** Defensive: older Content-API shaped payloads. */
  value?: string | number | null;
  currency?: string | null;
} | null | undefined;

export function parseGooglePrice(price: GooglePriceLike): {
  amount: number | null;
  currency: string | null;
} {
  if (!price || typeof price !== "object") return { amount: null, currency: null };
  const amount =
    microsToCurrency(price.amountMicros) ??
    (price.value != null && price.value !== ""
      ? (() => {
          const n = typeof price.value === "number" ? price.value : Number(String(price.value).trim());
          return Number.isFinite(n) ? n : null;
        })()
      : null);
  const currency =
    (typeof price.currencyCode === "string" && price.currencyCode.trim()) ||
    (typeof price.currency === "string" && price.currency.trim()) ||
    null;
  return { amount, currency: currency || null };
}

/**
 * Parse Merchant product IDs defensively.
 * Supports Content-API colon form (`online:fr:CH:offer`) and Merchant REST tilde form
 * (`online~fr~CH~offer` or `fr~CH~offer`).
 */
export function parseMerchantProductId(raw: string | null | undefined): ParsedMerchantProductId {
  const merchantProductId = (raw ?? "").trim();
  if (!merchantProductId) {
    return {
      merchantProductId: "",
      channel: null,
      languageCode: null,
      feedLabel: null,
      offerId: null,
    };
  }

  const sep = merchantProductId.includes("~") ? "~" : merchantProductId.includes(":") ? ":" : null;
  if (!sep) {
    return {
      merchantProductId,
      channel: null,
      languageCode: null,
      feedLabel: null,
      offerId: merchantProductId,
    };
  }

  const parts = merchantProductId.split(sep);
  if (parts.length >= 4) {
    const [channel, languageCode, feedLabel, ...offerParts] = parts;
    return {
      merchantProductId,
      channel: channel || null,
      languageCode: languageCode || null,
      feedLabel: feedLabel || null,
      offerId: offerParts.join(sep) || null,
    };
  }
  if (parts.length === 3) {
    const [languageCode, feedLabel, offerId] = parts;
    return {
      merchantProductId,
      channel: null,
      languageCode: languageCode || null,
      feedLabel: feedLabel || null,
      offerId: offerId || null,
    };
  }
  if (parts.length === 2) {
    return {
      merchantProductId,
      channel: null,
      languageCode: null,
      feedLabel: parts[0] || null,
      offerId: parts[1] || null,
    };
  }

  return {
    merchantProductId,
    channel: null,
    languageCode: null,
    feedLabel: null,
    offerId: parts[parts.length - 1] || null,
  };
}

/**
 * Gap vs benchmark: positive amount means our price is above the market benchmark.
 * Percent is relative to benchmark (null when benchmark is missing or zero).
 */
export function computeBenchmarkGap(
  currentPrice: number | null,
  benchmarkPrice: number | null
): { gapAmount: number | null; gapPercent: number | null } {
  if (currentPrice == null || benchmarkPrice == null) {
    return { gapAmount: null, gapPercent: null };
  }
  const gapAmount = currentPrice - benchmarkPrice;
  if (benchmarkPrice === 0) {
    return { gapAmount, gapPercent: null };
  }
  return {
    gapAmount,
    gapPercent: (gapAmount / benchmarkPrice) * 100,
  };
}

export function coverageRate(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return numerator / denominator;
}
