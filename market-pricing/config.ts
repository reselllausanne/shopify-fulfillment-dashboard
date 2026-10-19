/**
 * Market price comparator — configuration + cost registry.
 *
 * Every paid source is opt-in via env. With no keys set, the engine still runs
 * using the free internal DB reference source + any no-key endpoints, and simply
 * reports which sources were skipped. Nothing here writes channel prices.
 */

function env(key: string): string | undefined {
  const raw = process.env[key];
  if (raw === undefined || raw === null) return undefined;
  const trimmed = String(raw).trim();
  return trimmed === "" ? undefined : trimmed;
}

function num(key: string, fallback: number): number {
  const raw = env(key);
  if (raw === undefined) return fallback;
  const n = Number.parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export const MARKET_COUNTRY = env("MARKET_PRICE_COUNTRY") ?? "CH";
export const MARKET_CURRENCY = "CHF";

export type SourceCost = {
  key: string;
  label: string;
  /** What it answers for us. */
  role: string;
  /** Monthly price in CHF (approx, entry tier). 0 = free. */
  monthlyChf: number;
  pricingNote: string;
  signupUrl: string;
  envVars: string[];
  enabled: boolean;
};

export const PONITO_TOKEN = env("PONITO_API_TOKEN");
export const PONITO_BASE = env("PONITO_API_BASE") ?? "https://www.ponito.com/api/platform/v1";

/** Generic "Google Shopping / Amazon by GTIN" provider. SerpAPI or DataForSEO. */
export const SERPAPI_KEY = env("SERPAPI_KEY");
export const DATAFORSEO_LOGIN = env("DATAFORSEO_LOGIN");
export const DATAFORSEO_PASSWORD = env("DATAFORSEO_PASSWORD");

/** ReefAPI toppreise.ch bridge. */
export const REEFAPI_KEY = env("REEFAPI_KEY");
export const REEFAPI_BASE = env("REEFAPI_BASE") ?? "https://reefapi.com";

/** PricePirate (Amazon / Idealo / Google Shopping multi-source). */
export const PRICEPIRATE_KEY = env("PRICEPIRATE_KEY");

/** Demand: Google Trends via SerpAPI (reuses SERPAPI_KEY) or a self-host. */
export const TRENDS_PROVIDER = (env("MARKET_TRENDS_PROVIDER") ?? "serpapi") as
  | "serpapi"
  | "none";

/** Verdict tuning. */
export const MARKET_UNDERCUT_CHF = num("MARKET_UNDERCUT_CHF", 0.1); // sit just under cheapest rival
export const MARKET_MIN_RIVAL_OFFERS = num("MARKET_MIN_RIVAL_OFFERS", 2);
/** Only suggest a cut when we are at least this far above market consensus. */
export const MARKET_CUT_TRIGGER_CHF = num("MARKET_CUT_TRIGGER_CHF", 3);
/** Only suggest a raise when we are at least this far below cheapest rival. */
export const MARKET_RAISE_TRIGGER_CHF = num("MARKET_RAISE_TRIGGER_CHF", 5);

/** Swiss flat-rate VAT (Saldosteuersatz) and inclusive VAT, matching galaxus/exports/pricing.ts. */
export const SWISS_VAT_INCL = num("GALAXUS_PRICE_VAT_RATE", 0.081);
export const SWISS_SALDO_RATE = 0.021; // of gross turnover
export const FIXED_BOX_SHIP_CHF = 1.6;

export function sourceCostRegistry(): SourceCost[] {
  return [
    {
      key: "db_reference",
      label: "Internal DB (SupplierVariant min price)",
      role: "Cheapest known offer per GTIN across our own supplier feeds",
      monthlyChf: 0,
      pricingNote: "Free. Already in Postgres.",
      signupUrl: "-",
      envVars: [],
      enabled: true,
    },
    {
      key: "ponito",
      label: "Ponito Product Intelligence API",
      role: "GTIN → best CHF offer + shop count + daily history (Swiss)",
      monthlyChf: 19,
      pricingNote: "19/mo 5k calls · 49/mo 25k · 99/mo 100k. History since Jul 2026.",
      signupUrl: "https://www.ponito.com/platform/products/api",
      envVars: ["PONITO_API_TOKEN"],
      enabled: Boolean(PONITO_TOKEN),
    },
    {
      key: "google_shopping",
      label: "Google Shopping CH via SerpAPI",
      role: "GTIN → consumer offers in CHF incl. Galaxus/Amazon when indexed",
      monthlyChf: 75,
      pricingNote: "SerpAPI ~75/mo 5k searches. DataForSEO pay-as-you-go ~0.003/call.",
      signupUrl: "https://serpapi.com/google-shopping-api",
      envVars: ["SERPAPI_KEY"],
      enabled: Boolean(SERPAPI_KEY || (DATAFORSEO_LOGIN && DATAFORSEO_PASSWORD)),
    },
    {
      key: "toppreise",
      label: "toppreise.ch via ReefAPI",
      role: "Swiss comparison: every shop price + shipping + sold-out + history",
      monthlyChf: 30,
      pricingNote: "ReefAPI metered; budget ~30/mo for weekly audit of top SKUs.",
      signupUrl: "https://reefapi.com/toppreise-api",
      envVars: ["REEFAPI_KEY"],
      enabled: Boolean(REEFAPI_KEY),
    },
    {
      key: "pricepirate",
      label: "PricePirate (Amazon / Idealo EU)",
      role: "EU street price by GTIN for Amazon + idealo (arbitrage context)",
      monthlyChf: 20,
      pricingNote: "Metered. CH only via its google-shopping source; Amazon is EU.",
      signupUrl: "https://pricepirate.com/docs/en/api/price-data/overview",
      envVars: ["PRICEPIRATE_KEY"],
      enabled: Boolean(PRICEPIRATE_KEY),
    },
    {
      key: "google_trends",
      label: "Google Trends (demand) via SerpAPI",
      role: "Current search interest per model → demand factor",
      monthlyChf: 0,
      pricingNote: "Shares SerpAPI quota/key. No extra cost if SerpAPI already paid.",
      signupUrl: "https://serpapi.com/google-trends-api",
      envVars: ["SERPAPI_KEY"],
      enabled: TRENDS_PROVIDER === "serpapi" && Boolean(SERPAPI_KEY),
    },
    {
      key: "galaxus_live",
      label: "Galaxus live read (cache)",
      role: "Our own rayon — cheapest rival offer on the exact Galaxus page",
      monthlyChf: 0,
      pricingNote: "Free but datacenter IPs get blocked; needs residential proxy to be reliable.",
      signupUrl: "-",
      envVars: ["MARKET_GALAXUS_CACHE_FILE"],
      enabled: Boolean(env("MARKET_GALAXUS_CACHE_FILE")),
    },
  ];
}

export function enabledSourceKeys(): string[] {
  return sourceCostRegistry()
    .filter((s) => s.enabled)
    .map((s) => s.key);
}
