const STX_DEFAULT_SHIPPING_CHF = 20;

const STX_EXACT_LEGO_SHIPPING_BY_SLUG: Record<string, number> = {
  "lego-eiffel-tower-set-10307": 60,
  "lego-titanic-set-10294": 60,
  "lego-palace-cinema-set-10232": 60,
  "lego-marvel-studios-infinity-saga-hulkbuster-set-76210": 60,
  "lego-icons-the-endurance-set-10335": 60,
  "lego-pet-shop-set-10218": 45,
  "lego-creator-fairgrounds-mixer-set-10244": 45,
  "lego-stranger-things-the-upside-down-set-75810": 45,
  "lego-tower-bridge-set-10214": 45,
  "lego-technic-land-rover-defender-set-42110": 45,
  "lego-creator-ferris-wheel-2015-set-10247": 45,
  "lego-architecture-taj-mahal-set-21056": 45,
  "lego-star-wars-tie-fighter-set-75095": 35,
  "lego-creator-horizon-express-set-10233": 35,
  "lego-creator-santas-workshop-set-10245": 35,
  "lego-creator-winter-holiday-train-set-10254": 35,
  "lego-grand-emporium-set-10211": 25,
  "lego-ideas-nasa-apollo-saturn-v-set-92176": 25,
};

function normalizeSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function resolveStxShippingCHF(product: {
  slug?: unknown;
  url_key?: unknown;
  urlKey?: unknown;
  title?: unknown;
  primary_title?: unknown;
  name?: unknown;
} | null | undefined): number {
  const slug = normalizeSlug(product?.slug ?? product?.url_key ?? product?.urlKey);
  const title = normalizeSlug(product?.title ?? product?.primary_title ?? product?.name);
  const isLego = slug.includes("lego") || title.includes("lego");
  if (!isLego) return STX_DEFAULT_SHIPPING_CHF;
  return STX_EXACT_LEGO_SHIPPING_BY_SLUG[slug] ?? STX_DEFAULT_SHIPPING_CHF;
}
