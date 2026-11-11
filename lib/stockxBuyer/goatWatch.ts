/**
 * GOAT price watch. ALERT ONLY: the buyer never buys on GOAT. When GOAT is clearly
 * cheaper than StockX for a pending pair, ping the human so they can buy it by hand.
 * Source: KicksDB v3 `/goat/products` (USD, US sizes, `lowest_ask`).
 */
import {
  KICKDB_API_BASE_URL,
  KICKDB_API_KEY,
  KICKDB_API_KEY_HEADER,
  KICKDB_API_KEY_PREFIX,
} from "@/galaxus/config";
import { convertEuToUs } from "@/lib/stockxAutoCheckout/sizeUsFallback";

export type GoatVariant = {
  size?: string | number | null;
  lowest_ask?: number | null;
  instant_lowest_ask?: number | null;
  currency?: string | null;
  available?: boolean | null;
};

export type GoatProduct = {
  id?: number | string;
  sku?: string | null;
  slug?: string | null;
  name?: string | null;
  variants?: GoatVariant[] | null;
};

export type GoatCostModel = {
  /** USD→CHF. Env GOAT_USD_CHF, default 0.80. */
  usdChf: number;
  /** Flat GOAT shipping to CH in USD. Env GOAT_SHIP_USD, default 25. */
  shipUsd: number;
  /** Swiss import VAT on goods + shipping. Env GOAT_IMPORT_VAT, default 0.081. */
  vat: number;
  /** Alert only if GOAT all-in is at least this much below StockX all-in. */
  minSavingChf: number;
  minSavingPct: number;
};

export function goatCostModelFromEnv(env: NodeJS.ProcessEnv = process.env): GoatCostModel {
  const n = (v: string | undefined, d: number) => {
    const x = Number(v);
    return Number.isFinite(x) && x >= 0 ? x : d;
  };
  return {
    usdChf: n(env.GOAT_USD_CHF, 0.8),
    shipUsd: n(env.GOAT_SHIP_USD, 25),
    vat: n(env.GOAT_IMPORT_VAT, 0.081),
    minSavingChf: n(env.GOAT_MIN_SAVING_CHF, 30),
    minSavingPct: n(env.GOAT_MIN_SAVING_PCT, 0.12),
  };
}

/** Pure: GOAT estimated all-in in CHF for one lowest ask (USD). */
export function goatAllInChf(askUsd: number, m: GoatCostModel): number {
  return Math.round((askUsd + m.shipUsd) * m.usdChf * (1 + m.vat) * 100) / 100;
}

/** Pure: normalise "DZ5485-612" / "DZ5485 612" for sku compare. */
export function normSku(s: string | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

/** Pure: size "10.5", "10.5W", "3Y", "M" → comparable token. */
export function normGoatSize(s: string | number | null | undefined): string {
  return String(s ?? "")
    .toLowerCase()
    .replace(/^us\s*/, "")
    .replace(/\s+/g, "")
    .replace(/[wy]$/, "");
}

/** Pure: pick the available variant for a US size. */
export function pickGoatVariant(p: GoatProduct, sizeUs: string): GoatVariant | null {
  const want = normGoatSize(sizeUs);
  if (!want) return null;
  const hit = (p.variants ?? []).find(
    (v) => normGoatSize(v.size) === want && v.available !== false && Number(v.lowest_ask) > 0
  );
  return hit ?? null;
}

/** Pure: pick the product row whose sku equals the style id (search returns fuzzy rows). */
export function pickGoatProduct(rows: GoatProduct[], sku: string): GoatProduct | null {
  const want = normSku(sku);
  if (!want) return null;
  return rows.find((r) => normSku(r.sku) === want) ?? rows.find((r) => want.startsWith(normSku(r.sku)) && normSku(r.sku).length >= 6) ?? null;
}

export type GoatVerdict =
  | { kind: "goat_cheaper"; goatChf: number; stockxChf: number; savingChf: number; savingPct: number; askUsd: number }
  | { kind: "stockx_ok"; goatChf: number; stockxChf: number }
  | { kind: "no_goat"; reason: string };

/** Pure: decide whether to alert. */
export function compareGoat(input: {
  stockxAllInChf: number | null;
  askUsd: number | null;
  model: GoatCostModel;
}): GoatVerdict {
  if (input.askUsd == null || !(input.askUsd > 0)) return { kind: "no_goat", reason: "no_ask" };
  const goatChf = goatAllInChf(input.askUsd, input.model);
  if (input.stockxAllInChf == null || !(input.stockxAllInChf > 0)) {
    return { kind: "no_goat", reason: "no_stockx_reference" };
  }
  const saving = Math.round((input.stockxAllInChf - goatChf) * 100) / 100;
  const pct = saving / input.stockxAllInChf;
  if (saving >= input.model.minSavingChf && pct >= input.model.minSavingPct) {
    return {
      kind: "goat_cheaper",
      goatChf,
      stockxChf: input.stockxAllInChf,
      savingChf: saving,
      savingPct: Math.round(pct * 1000) / 1000,
      askUsd: input.askUsd,
    };
  }
  return { kind: "stockx_ok", goatChf, stockxChf: input.stockxAllInChf };
}

export async function fetchGoatProducts(
  sku: string,
  fetchImpl: typeof fetch = fetch
): Promise<GoatProduct[]> {
  if (!KICKDB_API_KEY) throw new Error("Missing KICKDB_API_KEY");
  const url = new URL(`${KICKDB_API_BASE_URL.replace(/\/$/, "")}/goat/products`);
  url.searchParams.set("query", sku);
  url.searchParams.set("limit", "5");
  url.searchParams.set("display[variants]", "true");
  const res = await fetchImpl(url.toString(), {
    headers: { [KICKDB_API_KEY_HEADER]: `${KICKDB_API_KEY_PREFIX}${KICKDB_API_KEY}` },
  });
  if (!res.ok) throw new Error(`KickDB goat ${res.status}`);
  const json = (await res.json()) as { data?: GoatProduct[] };
  return Array.isArray(json.data) ? json.data : [];
}

const cache = new Map<string, { at: number; v: GoatVerdict }>();
const CACHE_MS = 6 * 3600_000;

/**
 * Check one pair. Never throws: a failed GOAT lookup must not block a StockX buy.
 * `stockxAllInChf` comes from our own StockX precheck (SupplierVariant lane price).
 */
export async function checkGoat(input: {
  sku: string | null | undefined;
  sizeEU: string;
  title?: string | null;
  slug?: string | null;
  stockxAllInChf: number | null;
  model?: GoatCostModel;
  fetchImpl?: typeof fetch;
  now?: number;
}): Promise<GoatVerdict & { product?: string; sizeUs?: string }> {
  const sku = String(input.sku ?? "").trim();
  if (!sku) return { kind: "no_goat", reason: "no_sku" };
  const now = input.now ?? Date.now();
  const ck = `${normSku(sku)}|${input.sizeEU}`;
  const hit = cache.get(ck);
  if (hit && now - hit.at < CACHE_MS) return hit.v;
  try {
    const sizeUs = convertEuToUs(input.sizeEU, { title: input.title, slug: input.slug });
    if (!sizeUs) return { kind: "no_goat", reason: "no_us_size" };
    const rows = await fetchGoatProducts(sku.replace(/-(\d{2}(?:\.\d)?|OS)$/i, ""), input.fetchImpl);
    const product = pickGoatProduct(rows, sku.replace(/-(\d{2}(?:\.\d)?|OS)$/i, ""));
    if (!product) return { kind: "no_goat", reason: "no_product" };
    const variant = pickGoatVariant(product, sizeUs);
    const v = compareGoat({
      stockxAllInChf: input.stockxAllInChf,
      askUsd: variant ? Number(variant.lowest_ask) : null,
      model: input.model ?? goatCostModelFromEnv(),
    });
    const out = { ...v, product: product.name ?? undefined, sizeUs };
    cache.set(ck, { at: now, v: out });
    return out;
  } catch (e) {
    return { kind: "no_goat", reason: `lookup_failed:${String((e as Error)?.message || e).slice(0, 80)}` };
  }
}

/** Pure: alert text for Slack / mail. */
export function goatAlertText(input: {
  orderRef: string;
  title: string;
  sizeEU: string;
  verdict: Extract<GoatVerdict, { kind: "goat_cheaper" }>;
  sizeUs?: string;
  slug?: string | null;
  holdMinutes?: number;
}): string {
  const v = input.verdict;
  const holdMinutes = input.holdMinutes ?? 30;
  return (
    `GOAT moins cher: ${input.orderRef} ${input.title} EU ${input.sizeEU}${input.sizeUs ? ` (US ${input.sizeUs})` : ""}\n` +
    `StockX ~${v.stockxChf} CHF vs GOAT ~${v.goatChf} CHF (ask ${v.askUsd} USD + ship + TVA). ` +
    `Gain ~${v.savingChf} CHF (${Math.round(v.savingPct * 100)}%).\n` +
    `Achat StockX en pause ${holdMinutes} min. GOAT a la main: buyer_hold (bloque pour de bon). ` +
    `Sinon StockX reprend tout seul.`
  );
}
