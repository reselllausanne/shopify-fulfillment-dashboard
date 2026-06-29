import { STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING } from "@/galaxus/stx/chfStockxBuyPrice";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";

export type SuggestedSellCategory = "sneakers" | "clothing" | "lego";

const MARGIN_BANDS: Record<SuggestedSellCategory, Array<[cap: number, pct: number]>> = {
  sneakers: [
    [80, 20],
    [120, 45],
    [180, 40],
    [280, 35],
    [400, 31],
    [600, 30],
    [900, 29],
    [1400, 28],
    [3000, 27],
    [999999, 26],
  ],
  clothing: [
    [80, 20],
    [120, 45],
    [180, 45],
    [280, 40],
    [400, 36],
    [600, 35],
    [900, 34],
    [1400, 33],
    [3000, 31],
    [999999, 30],
  ],
  lego: [[999999, 33]],
};

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
];

const CLOTHING_TOKENS = [
  "jersey",
  "tee",
  "t-shirt",
  "tshirt",
  "hoodie",
  "sweatshirt",
  "jacket",
  "coat",
  "pants",
  "trouser",
  "shorts",
  "shirt",
  "apparel",
  "crewneck",
  "pullover",
  "track pant",
  "jogger",
  "beanie",
  " hat",
  " cap",
  "backpack",
  "short sleeve",
  "long sleeve",
  "windbreaker",
  "bomber",
  "fleece",
  "polo",
  "tank",
  "boxer",
  "sock",
  "underwear",
  "belt",
  "watch",
  "glasses",
  "figure",
  "collectible",
  "skateboard",
];

export function getLegoInboundShippingChf(productHandle: string | null | undefined): number {
  if (!productHandle) return 20;
  const h = productHandle.toLowerCase();
  for (const [key, value] of Object.entries(LEGO_INBOUND_OVERRIDES)) {
    if (h.includes(key)) return value;
  }
  if (LEGO_INBOUND_LARGE.some((slug) => h.includes(slug))) return 60;
  if (LEGO_INBOUND_MEDIUM.some((slug) => h.includes(slug))) return 45;
  if (LEGO_INBOUND_SMALL.some((slug) => h.includes(slug))) return 35;
  if (h.includes("lego")) return 20;
  return 20;
}

export function marginPct(stockxRaw: number, category: SuggestedSellCategory): number {
  for (const [cap, pct] of MARGIN_BANDS[category]) {
    if (stockxRaw < cap) return pct;
  }
  return MARGIN_BANDS[category][MARGIN_BANDS[category].length - 1][1];
}

export function psychRoundUp(price: number): number {
  const endings = [9, 19, 29, 39, 49, 59, 69, 79, 89, 99];
  const base = Math.floor(price / 100) * 100;
  for (const ending of endings) {
    const candidate = base + ending;
    if (candidate >= price) return candidate;
  }
  return base + 109;
}

export function classifySuggestedSellCategory(input: {
  productHandle?: string | null;
  productName?: string | null;
}): SuggestedSellCategory {
  const handle = String(input.productHandle ?? "").toLowerCase();
  const name = String(input.productName ?? "").toLowerCase();
  const haystack = `${handle} ${name}`;
  if (haystack.includes("lego")) return "lego";
  if (CLOTHING_TOKENS.some((token) => haystack.includes(token))) return "clothing";
  return "sneakers";
}

/** Reverse stored STX buy price back to StockX raw ask (CHF, before suggested-sell fee stack). */
export function deriveStockxRawAskFromStoredBuyPrice(
  storedBuyPriceChf: number,
  product: { slug?: string | null; urlKey?: string | null; name?: string | null } | null
): number | null {
  if (!Number.isFinite(storedBuyPriceChf) || storedBuyPriceChf <= 0) return null;
  const shippingChf = resolveStxShippingCHF(product);
  const raw = (storedBuyPriceChf - shippingChf) / STX_CH_LIST_MULTIPLIER_BEFORE_SHIPPING;
  if (!Number.isFinite(raw) || raw <= 0) return null;
  return Math.round(raw * 100) / 100;
}

export type CalcSuggestedSellPriceInput = {
  stockxRaw: number;
  category: SuggestedSellCategory;
  productHandle?: string | null;
  isExpress?: boolean;
};

export function calcSuggestedSellPrice(input: CalcSuggestedSellPriceInput): number {
  const stockxRaw = input.stockxRaw;
  const category = input.category;
  const productHandle = input.productHandle ?? "";
  const isExpress = Boolean(input.isExpress);
  const outbound = isExpress ? 15 : 7;
  const inboundFixed = 20;

  let sellRaw: number;

  if (category === "lego") {
    const inbound = getLegoInboundShippingChf(productHandle);
    const base = stockxRaw * 1.1 + inbound + outbound;
    sellRaw = base * (1 + marginPct(stockxRaw, "lego") / 100);
  } else {
    const C = stockxRaw * 1.08 + inboundFixed;
    const base = C + outbound;
    sellRaw = base * (1 + marginPct(stockxRaw, category) / 100);
    if (C <= 100) {
      const fulfil = isExpress ? 15 : 13;
      sellRaw = Math.max(sellRaw, C + 50 + fulfil);
    }
  }

  return psychRoundUp(sellRaw);
}

/** Galaxus offer feed `SuggestedRetailPriceInclVat_CHF` (CHF, psych-rounded). */
export function calcSuggestedRetailPriceInclVatChf(input: CalcSuggestedSellPriceInput): number {
  return calcSuggestedSellPrice(input);
}

/** Compute suggested retail from live StockX raw ask (used on STX price sync/import). */
export function calcSuggestedRetailFromStxOffer(input: {
  stockxRaw: number;
  productHandle?: string | null;
  productName?: string | null;
  deliveryType?: string | null;
}): number | null {
  if (!Number.isFinite(input.stockxRaw) || input.stockxRaw <= 0) return null;
  const productHandle = input.productHandle ?? "";
  const category = classifySuggestedSellCategory({
    productHandle,
    productName: input.productName,
  });
  const isExpress = String(input.deliveryType ?? "").startsWith("express_");
  return calcSuggestedSellPrice({
    stockxRaw: input.stockxRaw,
    category,
    productHandle,
    isExpress,
  });
}

/** Fallback when DB column not backfilled yet — derives raw ask from stored buy price. */
export function calcSuggestedRetailFromStoredStxBuyPrice(input: {
  storedBuyPriceChf: number;
  productHandle?: string | null;
  productName?: string | null;
  deliveryType?: string | null;
}): number | null {
  const stockxRaw = deriveStockxRawAskFromStoredBuyPrice(input.storedBuyPriceChf, {
    slug: input.productHandle,
    urlKey: input.productHandle,
    name: input.productName,
  });
  if (stockxRaw === null) return null;
  return calcSuggestedRetailFromStxOffer({
    stockxRaw,
    productHandle: input.productHandle,
    productName: input.productName,
    deliveryType: input.deliveryType,
  });
}
