const STX_DEFAULT_SHIPPING_CHF = 20;

const LEGO_INBOUND_OVERRIDES: Record<string, number> = {
  "lego-pet-shop-set-10218": 45,
  "lego-grand-emporium-set-10211": 25,
  "lego-ideas-nasa-apollo-saturn-v-set-92176": 25,
};

const LEGO_INBOUND_LARGE = [
  "lego-eiffel-tower-set-10307",
  "lego-titanic-set-10294",
  "lego-palace-cinema-set-10232",
  "lego-marvel-studios-infinity-saga-hulkbuster-set-76210",
  "lego-icons-the-endurance-set-10335",
  "lego-lion-knights-castle-set-10305",
];

const LEGO_INBOUND_MEDIUM = [
  "lego-creator-fairgrounds-mixer-set-10244",
  "lego-stranger-things-the-upside-down-set-75810",
  "lego-tower-bridge-set-10214",
  "lego-technic-land-rover-defender-set-42110",
  "lego-creator-ferris-wheel-2015-set-10247",
  "lego-architecture-taj-mahal-set-21056",
];

const LEGO_INBOUND_SMALL = [
  "lego-star-wars-tie-fighter-set-75095",
  "lego-creator-horizon-express-set-10233",
  "lego-creator-santas-workshop-set-10245",
  "lego-creator-winter-holiday-train-set-10254",
];

function normalizeSlug(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

export function getLegoInboundShippingChf(productHandle: string | null | undefined): number {
  if (!productHandle) return STX_DEFAULT_SHIPPING_CHF;
  const h = productHandle.toLowerCase();
  for (const [key, value] of Object.entries(LEGO_INBOUND_OVERRIDES)) {
    if (h.includes(key)) return value;
  }
  if (LEGO_INBOUND_LARGE.some((slug) => h.includes(slug))) return 60;
  if (LEGO_INBOUND_MEDIUM.some((slug) => h.includes(slug))) return 45;
  if (LEGO_INBOUND_SMALL.some((slug) => h.includes(slug))) return 35;
  if (h.includes("lego")) return STX_DEFAULT_SHIPPING_CHF;
  return STX_DEFAULT_SHIPPING_CHF;
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
  return getLegoInboundShippingChf(slug || title);
}
