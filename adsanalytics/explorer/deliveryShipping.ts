/**
 * Per-pair delivery options for Google Shopping.
 *
 * Google models several delivery speeds as one product carrying a repeated
 * `shipping` attribute, one entry per service — never as a second offer and
 * never as a price uplift. Ranking uses item price plus the cheapest shipping,
 * so publishing a dearer express option costs us nothing on positioning while
 * it surfaces the fast lane we actually sell.
 *
 * Two constraints drive the shape below:
 *  - `service` is mandatory as soon as one country carries several options;
 *  - submitting an item-level shipping price makes Google ignore account-level
 *    settings for that product, delivery times included, so handling and transit
 *    must be supplied here or the delivery estimate disappears from the ad.
 */

export const DELIVERY_SOURCE_NAME = "Resell Lausanne Delivery";

export const STANDARD_SERVICE = "Standard";
export const EXPRESS_SERVICE = "Express 48h";

export type ShippingOption = {
  country: string;
  service: string;
  price: { amountMicros: string; currencyCode: string };
  minHandlingTime: string;
  maxHandlingTime: string;
  minTransitTime: string;
  maxTransitTime: string;
};

export type BuildShippingInput = {
  /** Sell price of the standard lane, in CHF. */
  standardSell: number | null | undefined;
  /** Sell price of the express lane, in CHF. Null when no live express lane. */
  expressSell: number | null | undefined;
  country?: string;
  currency?: string;
  /** Shipping cost of the standard lane, in CHF. Usually free. */
  standardShippingChf?: number;
  standardHandlingDays?: [number, number];
  standardTransitDays?: [number, number];
  expressHandlingDays?: [number, number];
  expressTransitDays?: [number, number];
};

function toMicros(chf: number): string {
  return String(Math.round(chf * 1e6));
}

/**
 * Build the `shipping` array for one pair.
 *
 * The express entry is priced at the difference between the two lanes, because
 * the item price stays the standard one: the customer pays the gap to go faster.
 * A non-positive or unknown gap means there is nothing to upsell, so only the
 * standard option is published.
 */
export function buildShippingOptions(input: BuildShippingInput): ShippingOption[] {
  const country = input.country ?? "CH";
  const currencyCode = input.currency ?? "CHF";
  const [minH, maxH] = input.standardHandlingDays ?? [1, 3];
  const [minT, maxT] = input.standardTransitDays ?? [3, 6];
  const [minHE, maxHE] = input.expressHandlingDays ?? [0, 1];
  const [minTE, maxTE] = input.expressTransitDays ?? [1, 2];

  const options: ShippingOption[] = [
    {
      country,
      service: STANDARD_SERVICE,
      price: { amountMicros: toMicros(input.standardShippingChf ?? 0), currencyCode },
      minHandlingTime: String(minH),
      maxHandlingTime: String(maxH),
      minTransitTime: String(minT),
      maxTransitTime: String(maxT),
    },
  ];

  const standard = Number(input.standardSell);
  const express = Number(input.expressSell);
  if (
    Number.isFinite(standard) &&
    Number.isFinite(express) &&
    standard > 0 &&
    express > standard
  ) {
    const gap = Math.round((express - standard) * 100) / 100;
    options.push({
      country,
      service: EXPRESS_SERVICE,
      price: { amountMicros: toMicros(gap), currencyCode },
      minHandlingTime: String(minHE),
      maxHandlingTime: String(maxHE),
      minTransitTime: String(minTE),
      maxTransitTime: String(maxTE),
    });
  }

  return options;
}

/** True when the pair has a real express lane worth publishing. */
export function hasPublishableExpress(options: ShippingOption[]): boolean {
  return options.some((o) => o.service === EXPRESS_SERVICE);
}
