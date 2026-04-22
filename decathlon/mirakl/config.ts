const baseUrlRaw = process.env.DECATHLON_MIRAKL_API_BASE_URL ?? "";
export const DECATHLON_MIRAKL_API_BASE_URL = baseUrlRaw.replace(/\/$/, "");
export const DECATHLON_MIRAKL_API_KEY = process.env.DECATHLON_MIRAKL_API_KEY ?? "";
/** Seller/Shop APIs: back-office API key goes in Authorization with no Bearer prefix (JWT uses Bearer elsewhere). */
export const DECATHLON_MIRAKL_API_KEY_HEADER = "Authorization";
export const DECATHLON_MIRAKL_API_KEY_PREFIX = "";

export const DECATHLON_MIRAKL_OFFERS_IMPORT_PATH = "/api/offers/imports";
export const DECATHLON_MIRAKL_STOCK_IMPORT_PATH = "/api/offers/stock/imports";
export const DECATHLON_MIRAKL_PRICING_IMPORT_PATH = "/api/offers/pricing/imports";

export const DECATHLON_MIRAKL_OFFERS_STATUS_PATH = "/api/offers/imports";
export const DECATHLON_MIRAKL_STOCK_STATUS_PATH = "/api/offers/stock/imports";
export const DECATHLON_MIRAKL_PRICING_STATUS_PATH = "/api/offers/pricing/imports";
export const DECATHLON_MIRAKL_PRODUCTS_IMPORT_PATH = "/api/products/imports";
export const DECATHLON_MIRAKL_PRODUCTS_STATUS_PATH = "/api/products/imports";
export const DECATHLON_MIRAKL_MCM_STATUS_EXPORT_PATH = "/api/mcm/products/sources/status/export";
export const DECATHLON_MIRAKL_PRODUCTS_ATTRS_PATH = "/api/products/attributes";
export const DECATHLON_MIRAKL_ERROR_SUFFIX = "/error_report";

export const DECATHLON_MIRAKL_WAREHOUSE_CODE = "76099996968-Switzerland";

/**
 * Mirakl TEST vs NORMAL — flip here only (no env). When true, imports use TEST and default batch caps.
 */
export const DECATHLON_MIRAKL_TEST_MODE = false;

export const DECATHLON_MIRAKL_TEST_LIMIT = 50;

/** P51 poll after P41 upload (AI_CONVERTER can run long). */
export const DECATHLON_MIRAKL_P41_POLL_INTERVAL_MS = 5000;
export const DECATHLON_MIRAKL_P41_POLL_MAX_MS = 600_000;

/**
 * When true (default): one status read after upload then return — Mirakl may still be RUNNING.
 * Set env DECATHLON_MIRAKL_P41_SKIP_LONG_POLL=0 to poll until terminal or P41_POLL_MAX_MS.
 */
const p41SkipLongPollRaw = String(process.env.DECATHLON_MIRAKL_P41_SKIP_LONG_POLL ?? "1").trim().toLowerCase();
export const DECATHLON_MIRAKL_P41_SKIP_LONG_POLL = !["0", "false", "no"].includes(p41SkipLongPollRaw);

export type DecathlonOf01Cm11Filter = "LIVE" | "KNOWN" | "OFF";

/**
 * OF01: CM11 export filter — edit here only.
 * KNOWN = any row in export (not UNKNOWN). No P41 required by default.
 */
export const DECATHLON_OF01_CM11_FILTER: DecathlonOf01Cm11Filter = "OFF";

/**
 * When true: OF01 only sends rows that already have a successful P41 row in DB (decathlonOfferSync.lastProductSyncAt).
 * When false (default): OF01 sends offer deltas without that gate — run P41 separately when you onboard products.
 */
const of01RequireP41Raw = String(process.env.DECATHLON_OF01_REQUIRE_P41_SUCCESS ?? "0").trim().toLowerCase();
export const DECATHLON_OF01_REQUIRE_P41_SUCCESS = ["1", "true", "yes"].includes(of01RequireP41Raw);
