/**
 * Beatbot iSkim Ultra monitor + Galaxus feed prep.
 *
 * Usage:
 *   npx tsx scripts/beatbot-monitor.ts
 *   npx tsx scripts/beatbot-monitor.ts --force
 *   npx tsx scripts/beatbot-monitor.ts --dry-run
 */
import "dotenv/config";

import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "../app/lib/prisma";
import { validateGtin } from "../app/lib/normalize";
import { toCsv } from "../galaxus/exports/csv";
import { withMappingSupplierKey } from "../galaxus/exports/supplierKey";
import { buildProviderKey } from "../galaxus/supplier/providerKey";

const MONITORED_PRODUCT_ID = "beatbot_iskim_ultra";
const SUPPLIER_VARIANT_ID = "ner_beatbot-iskim-ultra-prcssf01-eu-g";
const LEGACY_SUPPLIER_VARIANT_IDS = ["bbt_beatbot-iskim-ultra-prcssf01-eu-g"];
const SOURCE_URL = "https://eu.beatbot.com/products/iskim-ultra";
const SOURCE_JSON_URL = "https://eu.beatbot.com/products/iskim-ultra.js";
const GALAXUS_URL =
  "https://www.galaxus.ch/de/s4/product/beatbot-akku-poolroboter-iskim-ultra-poolroboter-66639445";

const EUR_CHF = 0.9234;
const FX_BUFFER = 0.025;
const IMPORT_BUFFER_LOW = 30;
const IMPORT_BUFFER_HIGH = 60;
const TVA_CH = 0.081;
const DEFAULT_DELIVERY_DAYS_MIN = 15;
const DEFAULT_DELIVERY_DAYS_MAX = 25;
const DEFAULT_SUPPLIER_PRICE_CHF = 999;
const FOUR_DAYS_MS = 4 * 24 * 60 * 60 * 1000;
const ALERT_MARGIN_FLOOR = 300;
const USER_AGENT = "Mozilla/5.0 (compatible; beatbot-galaxus-monitor/1.0)";

const DATA_DIR = path.join(process.cwd(), "galaxus", "beatbot");
const WATCHLIST_CSV_PATH = path.join(DATA_DIR, "beatbot_watchlist.csv");
const FEED_UPDATE_CSV_PATH = path.join(DATA_DIR, "feed_update.csv");
const LOG_CSV_PATH = path.join(DATA_DIR, "beatbot_monitor_log.csv");
const LOG_SQLITE_PATH = path.join(DATA_DIR, "beatbot_monitor.sqlite");

type CliFlags = {
  force: boolean;
  dryRun: boolean;
};

type BeatbotSourceData = {
  title: string;
  brand: string;
  model: string;
  mpn: string | null;
  barcode: string | null;
  priceEur: number | null;
  compareAtEur: number | null;
  available: boolean | null;
  sourceStatus: "preorder" | "available" | "sold_out" | "unknown";
  shippingText: string;
  shippingDateIso: string | null;
  images: string[];
  services: string[];
  shortDescriptionFr: string;
  longDescriptionFr: string;
  titleFr: string;
  titleDe: string;
  titleEn: string;
  scrapeErrors: string[];
};

type GalaxusData = {
  title: string;
  articleNumber: string | null;
  manufacturerNo: string | null;
  gtin: string | null;
  priceChf: number | null;
  sellerName: string | null;
  stockCount: number | null;
  stockText: string;
  deliveryText: string;
  deliveryFromIso: string | null;
  deliveryToIso: string | null;
  category: string | null;
  ratingsCount: number | null;
  offerCount: number | null;
  images: string[];
  sourceMode: "live" | "fallback";
  scrapeErrors: string[];
};

type Computation = {
  sourceChf: number;
  sourceChfFx: number;
  landedLow: number;
  landedHigh: number;
  landedSafe: number;
  targetSupplierPriceChf: number;
  estimatedMarginLow: number;
  estimatedMarginHigh: number;
  estimatedMarginSafe: number;
  stockToPush: number;
  recommendation: "GO_PUSH" | "WATCH_ONLY" | "NO_GO";
  reasons: string[];
};

type LogSnapshot = {
  checkedAt: string;
  sourcePriceEur: number | null;
  galaxusPriceChf: number | null;
  stockToPush: number;
  recommendation: string;
  marginSafe: number;
};

function parseFlags(argv: string[]): CliFlags {
  const set = new Set(argv.map((value) => value.trim().toLowerCase()));
  return {
    force: set.has("--force"),
    dryRun: set.has("--dry-run"),
  };
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function randomDelayMs() {
  return 2000 + Math.floor(Math.random() * 3000);
}

async function fetchTextWithTimeout(url: string, timeoutMs: number): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/json;q=0.9,*/*;q=0.8",
      },
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} on ${url}`);
    }
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function toAbsoluteBeatbotImage(url: string): string {
  const trimmed = String(url ?? "").trim();
  if (!trimmed) return "";
  if (trimmed.startsWith("//")) return `https:${trimmed}`;
  if (trimmed.startsWith("/")) return `https://eu.beatbot.com${trimmed}`;
  return trimmed;
}

function parseShippingDateFromText(text: string): string | null {
  const match = text.match(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?\b/i
  );
  if (!match) return null;
  const month = match[1];
  const day = Number.parseInt(match[2], 10);
  const now = new Date();
  const guess = new Date(`${month} ${day}, ${now.getUTCFullYear()} 12:00:00 UTC`);
  if (!Number.isFinite(guess.getTime())) return null;
  if (guess.getTime() < now.getTime() - 120 * 24 * 60 * 60 * 1000) {
    guess.setUTCFullYear(guess.getUTCFullYear() + 1);
  }
  return guess.toISOString();
}

function parseBeatbotSource(html: string, jsonRaw: string): BeatbotSourceData {
  const errors: string[] = [];
  let json: any = null;
  try {
    json = JSON.parse(jsonRaw);
  } catch (error) {
    errors.push(`Beatbot .js JSON parse failed: ${String(error)}`);
  }

  const variant = json?.variants?.[0] ?? null;
  const htmlText = htmlToText(html);
  const shippingLineMatch = htmlText.match(/Pre-?order:?\s*Estimated shipping[^.]*\./i);
  const shippingText = shippingLineMatch?.[0]?.trim() ?? "Estimated shipping from July 20th";
  const shippingDateIso = parseShippingDateFromText(shippingText);
  const preorderDetected = /pre-?order/i.test(htmlText);
  const soldOutDetected = /sold out/i.test(htmlText);

  let sourceStatus: BeatbotSourceData["sourceStatus"] = "unknown";
  if (preorderDetected) sourceStatus = "preorder";
  else if (soldOutDetected || variant?.available === false) sourceStatus = "sold_out";
  else if (variant?.available === true) sourceStatus = "available";

  const imageList = Array.isArray(json?.images)
    ? json.images.map((item: unknown) => toAbsoluteBeatbotImage(String(item ?? ""))).filter(Boolean)
    : [];

  const serviceCandidates = [
    "30-Day Money-Back Guarantee",
    "Free and Fast Shipping",
    "Up to 3 Years Full Replacement Protection",
    "Responsive 24/7 Support",
  ];
  const services = serviceCandidates.filter((candidate) =>
    new RegExp(candidate.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(htmlText)
  );

  const priceEur = typeof variant?.price === "number" ? variant.price / 100 : null;
  const compareAtEur =
    typeof variant?.compare_at_price === "number"
      ? variant.compare_at_price / 100
      : typeof json?.compare_at_price === "number"
        ? json.compare_at_price / 100
        : null;

  return {
    title: "Beatbot iSkim Ultra Robotic Pool Skimmer",
    brand: "Beatbot",
    model: "iSkim Ultra",
    mpn: (variant?.sku ? String(variant.sku).trim() : null) || "PRCSSF01-EU-G",
    barcode: variant?.barcode ? String(variant.barcode).trim() : null,
    priceEur,
    compareAtEur,
    available: typeof variant?.available === "boolean" ? Boolean(variant.available) : null,
    sourceStatus,
    shippingText,
    shippingDateIso,
    images: imageList,
    services,
    titleFr: "Beatbot iSkim Ultra - Robot skimmer solaire pour piscine avec panier 9 L",
    titleDe: "Beatbot iSkim Ultra - Akku-Poolroboter / Poolskimmer mit Solarpanel",
    titleEn: "Beatbot iSkim Ultra Robotic Pool Skimmer",
    shortDescriptionFr:
      "Robot skimmer intelligent pour piscine, con\u00e7u pour nettoyer automatiquement la surface de l'eau. Le Beatbot iSkim Ultra combine un panneau solaire 24 W, une batterie 10'000 mAh, un panier filtrant extra-large de 9 L, le contr\u00f4le via application et une navigation pr\u00e9cise avec capteurs pour retirer feuilles, pollen, insectes et d\u00e9bris flottants.",
    longDescriptionFr:
      "Le Beatbot iSkim Ultra est un robot skimmer de piscine intelligent pens\u00e9 pour l'entretien automatique de la surface de l'eau. Gr\u00e2ce \u00e0 son panneau solaire 24 W et \u00e0 sa batterie haute capacit\u00e9 de 10'000 mAh, il peut fonctionner de mani\u00e8re prolong\u00e9e avec recharge solaire et recharge magn\u00e9tique. Son panier filtrant de 9 L permet de collecter une grande quantit\u00e9 de d\u00e9bris flottants comme les feuilles, le pollen, les insectes, l'herbe et les petites particules. Le robot dispose d'un contr\u00f4le via application, de capteurs de navigation et d'une conception adapt\u00e9e \u00e0 diff\u00e9rents types de piscines, y compris les piscines enterr\u00e9es, hors sol, carrel\u00e9es, en vinyle, en b\u00e9ton, en fibre de verre et en acier inoxydable.",
    scrapeErrors: errors,
  };
}

function extractJsonFromScriptTag(html: string, id: string): any | null {
  const regex = new RegExp(
    `<script[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/script>`,
    "i"
  );
  const match = html.match(regex);
  if (!match?.[1]) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function extractGalaxusProductFromHtml(html: string): { product: any | null; ldProduct: any | null } {
  const nextData = extractJsonFromScriptTag(html, "__NEXT_DATA__");
  const product =
    nextData?.props?.pageProps?.preloadedQuery?.rawResponse?.data?.product ?? null;

  const ldMatches = Array.from(
    html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)
  );
  let ldProduct: any = null;
  for (const match of ldMatches) {
    const raw = match?.[1];
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      const values = Array.isArray(parsed) ? parsed : [parsed];
      const found = values.find((item) => item?.["@type"] === "Product");
      if (found) {
        ldProduct = found;
        break;
      }
    } catch {
      // Ignore malformed scripts.
    }
  }

  return { product, ldProduct };
}

function parseGalaxusDataFromHtml(html: string): GalaxusData {
  const errors: string[] = [];
  const { product, ldProduct } = extractGalaxusProductFromHtml(html);
  if (!product && !ldProduct) {
    errors.push("Galaxus parse: __NEXT_DATA__ and JSON-LD both missing.");
  }

  const specGroups = product?.specificationGroups?.edges ?? [];
  const specItems = specGroups.flatMap((edge: any) => edge?.node?.specifications ?? []);
  const getSpecText = (title: string): string | null => {
    const found = specItems.find((item: any) => item?.title === title);
    if (!found) return null;
    if (typeof found?.value?.text === "string" && found.value.text.trim()) return found.value.text.trim();
    if (typeof found?.value?.productType?.name === "string") return found.value.productType.name.trim();
    if (typeof found?.value?.brand?.name === "string") return found.value.brand.name.trim();
    return null;
  };

  const galleryEdges = product?.galleryImages?.edges ?? [];
  const galleryImages = Array.isArray(galleryEdges)
    ? galleryEdges
        .map((edge: any) => String(edge?.node?.relativeUrl ?? "").trim())
        .filter(Boolean)
        .map((relativeUrl: string) =>
          relativeUrl.startsWith("http")
            ? relativeUrl
            : `https://static01.galaxus.com${relativeUrl}_sea.jpeg`
        )
    : [];

  const ldImages = Array.isArray(ldProduct?.image)
    ? ldProduct.image.map((value: unknown) => String(value ?? "").trim()).filter(Boolean)
    : typeof ldProduct?.image === "string"
      ? [String(ldProduct.image).trim()]
      : [];

  const images = [...new Set([...galleryImages, ...ldImages])].slice(0, 10);

  const deliveryFrom = product?.availability?.mailDetail?.expectedDelivery?.from
    ? String(product.availability.mailDetail.expectedDelivery.from)
    : null;
  const deliveryTo = product?.availability?.mailDetail?.expectedDelivery?.to
    ? String(product.availability.mailDetail.expectedDelivery.to)
    : null;

  const deliveryText =
    deliveryFrom && deliveryTo
      ? `Delivered between ${deliveryFrom.slice(0, 10)} and ${deliveryTo.slice(0, 10)}`
      : "Delivery information unavailable";

  const stockCountRaw = product?.availability?.mailDetail?.stockDetails?.stockCount;
  const stockCount =
    typeof stockCountRaw === "number"
      ? stockCountRaw
      : typeof stockCountRaw === "string"
        ? Number.parseInt(stockCountRaw, 10)
        : null;
  const stockText =
    stockCount !== null && Number.isFinite(stockCount)
      ? stockCount > 10
        ? "More than 10 units in stock"
        : `${stockCount} units in stock`
      : "Stock unavailable";

  const rawPrice = product?.price?.amountInclusive ?? ldProduct?.offers?.price ?? null;
  const priceChf =
    typeof rawPrice === "number"
      ? rawPrice
      : typeof rawPrice === "string"
        ? Number.parseFloat(rawPrice)
        : null;

  const gtin = (product?.gtin ? String(product.gtin).trim() : null) ?? null;
  const manufacturerNo =
    (product?.manufacturerProductIdentifier
      ? String(product.manufacturerProductIdentifier).trim()
      : null) ??
    getSpecText("Herstellernr.") ??
    null;

  const category =
    getSpecText("Kategorie") ??
    (product?.summary?.productTypeName ? String(product.summary.productTypeName).trim() : null) ??
    "Poolroboter";

  return {
    title: product?.name ? String(product.name).trim() : "Beatbot Akku-Poolroboter iSkim Ultra",
    articleNumber: product?.databaseId ? String(product.databaseId) : ldProduct?.sku ? String(ldProduct.sku) : null,
    manufacturerNo,
    gtin,
    priceChf: Number.isFinite(priceChf ?? NaN) ? Number(priceChf) : null,
    sellerName: product?.merchant?.name ? String(product.merchant.name).trim() : null,
    stockCount: Number.isFinite(stockCount ?? NaN) ? Number(stockCount) : null,
    stockText,
    deliveryText,
    deliveryFromIso: deliveryFrom,
    deliveryToIso: deliveryTo,
    category,
    ratingsCount:
      typeof product?.ratingSummary?.ratingCount === "number"
        ? product.ratingSummary.ratingCount
        : null,
    offerCount:
      Array.isArray(product?.offers)
        ? product.offers.length
        : typeof product?.offers?.totalCount === "number"
          ? product.offers.totalCount
          : null,
    images,
    sourceMode: "live",
    scrapeErrors: errors,
  };
}

function buildFallbackGalaxusData(): GalaxusData {
  return {
    title: "Beatbot Akku-Poolroboter iSkim Ultra",
    articleNumber: "66639445",
    manufacturerNo: "PRCSSF01-EU-G",
    gtin: "6976413750242",
    priceChf: 1299,
    sellerName: "augusta-pool.ch",
    stockCount: 11,
    stockText: "More than 10 units in stock",
    deliveryText: "Delivery between 2026-07-07 and 2026-07-10",
    deliveryFromIso: null,
    deliveryToIso: null,
    category: "Poolroboter",
    ratingsCount: 0,
    offerCount: null,
    images: [],
    sourceMode: "fallback",
    scrapeErrors: ["Galaxus live scrape failed. Using baseline fallback values."],
  };
}

function daysUntil(dateIso: string | null): number | null {
  if (!dateIso) return null;
  const date = new Date(dateIso);
  if (!Number.isFinite(date.getTime())) return null;
  const now = new Date();
  const diff = date.getTime() - now.getTime();
  return Math.ceil(diff / (24 * 60 * 60 * 1000));
}

function computeTargetPriceAndStock(source: BeatbotSourceData, galaxus: GalaxusData): Computation {
  const reasons: string[] = [];
  const sourcePriceEur = source.priceEur ?? 0;
  const sourceChf = sourcePriceEur * EUR_CHF;
  const sourceChfFx = sourceChf * (1 + FX_BUFFER);
  const landedLow = sourceChfFx + IMPORT_BUFFER_LOW;
  const landedHigh = sourceChfFx + IMPORT_BUFFER_HIGH;
  const landedSafe = landedHigh;

  let targetSupplierPriceChf = DEFAULT_SUPPLIER_PRICE_CHF;
  const competitorPrice = galaxus.priceChf ?? null;

  if (
    competitorPrice !== null &&
    competitorPrice <= 1199 &&
    competitorPrice > 1099 &&
    DEFAULT_SUPPLIER_PRICE_CHF - landedSafe > ALERT_MARGIN_FLOOR
  ) {
    const marginAt949 = 949 - landedSafe;
    if (marginAt949 > ALERT_MARGIN_FLOOR) {
      targetSupplierPriceChf = 949;
      reasons.push("Competitor at or below 1199 CHF: target price reduced to 949 CHF.");
    }
  }

  let stockToPush = 0;
  const shippingDelayDays = daysUntil(source.shippingDateIso);
  const hasClearAvailability =
    source.sourceStatus === "preorder" || source.sourceStatus === "available";

  if (sourcePriceEur <= 599 && hasClearAvailability) {
    stockToPush = 1;
  } else if (sourcePriceEur >= 600 && sourcePriceEur <= 699) {
    const competitorSupports = competitorPrice !== null && competitorPrice >= 1199;
    if (targetSupplierPriceChf >= 999 && competitorSupports) {
      stockToPush = 1;
    }
  }

  if (sourcePriceEur >= 700) {
    stockToPush = 0;
    reasons.push("No-go: source price >= 700 EUR.");
  }
  if (landedSafe > 700) {
    stockToPush = 0;
    reasons.push("No-go: landed cost exceeds 700 CHF.");
  }
  if (competitorPrice !== null && competitorPrice <= 1099) {
    stockToPush = 0;
    reasons.push("No-go: public Galaxus price <= 1099 CHF.");
  }
  if (!hasClearAvailability) {
    stockToPush = 0;
    reasons.push("No-go: source availability/preorder status is unclear.");
  }
  if (source.sourceStatus === "sold_out") {
    stockToPush = 0;
    reasons.push("No-go: source is sold out.");
  }
  if (shippingDelayDays !== null && shippingDelayDays > 30) {
    stockToPush = 0;
    reasons.push("No-go: source shipping date moved beyond 30 days.");
  }
  if (!source.shippingText || source.shippingText.toLowerCase().includes("unavailable")) {
    stockToPush = 0;
    reasons.push("No-go: shipping text missing or unclear.");
  }

  const estimatedMarginLow = targetSupplierPriceChf - landedLow;
  const estimatedMarginHigh = targetSupplierPriceChf - landedHigh;
  const estimatedMarginSafe = targetSupplierPriceChf - landedSafe;

  const criticalReasons = reasons.filter((reason) => reason.toLowerCase().startsWith("no-go"));
  const recommendation: Computation["recommendation"] =
    criticalReasons.length > 0 ? "NO_GO" : stockToPush > 0 ? "GO_PUSH" : "WATCH_ONLY";

  return {
    sourceChf,
    sourceChfFx,
    landedLow,
    landedHigh,
    landedSafe,
    targetSupplierPriceChf,
    estimatedMarginLow,
    estimatedMarginHigh,
    estimatedMarginSafe,
    stockToPush,
    recommendation,
    reasons,
  };
}

function buildProductManualNote(input: {
  source: BeatbotSourceData;
  galaxus: GalaxusData;
  computation: Computation;
  resolvedGtin: string | null;
  providerKey: string | null;
}): string {
  const payload = {
    sourceUrl: SOURCE_URL,
    galaxusUrl: GALAXUS_URL,
    articleNumber: input.galaxus.articleNumber,
    manufacturerNo: input.source.mpn ?? input.galaxus.manufacturerNo,
    providerKey: input.providerKey,
    gtin: input.resolvedGtin,
    sourceStatus: input.source.sourceStatus,
    sourceShipping: input.source.shippingText,
    sourcePriceEur: input.source.priceEur,
    galaxusPriceChf: input.galaxus.priceChf,
    targetSupplierPriceChf: input.computation.targetSupplierPriceChf,
    landedSafeChf: input.computation.landedSafe,
    estimatedMarginSafeChf: input.computation.estimatedMarginSafe,
    stockToPush: input.computation.stockToPush,
    deliveryWindowBusinessDays: [DEFAULT_DELIVERY_DAYS_MIN, DEFAULT_DELIVERY_DAYS_MAX],
    titles: {
      fr: input.source.titleFr,
      de: input.source.titleDe,
      en: input.source.titleEn,
    },
    specs: {
      brand: "Beatbot",
      model: "iSkim Ultra",
      productType: "robotic pool skimmer / pool robot",
      solarPanelW: 24,
      batteryMah: 10000,
      filterBasketL: 9,
      motors: 7,
      sensors: 20,
      appControl: true,
      remoteControl: "Beatbot app",
      debrisMicrometer: 380,
      saltwater: "up to 5000 ppm; chlorine <= 4 ppm",
      charging: "magnetic wireless charger + solar charging",
      chargingTimeHours: 5,
      warranty: "2 years standard",
      countryOfOrigin: "TO_VERIFY",
      taric: "TO_VERIFY",
      chargerCompatibility: "TO_VERIFY_EU_CH",
    },
    updatedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
}

async function ensureDataDir() {
  await mkdir(DATA_DIR, { recursive: true });
}

async function readLastCsvLog(): Promise<LogSnapshot | null> {
  try {
    const raw = await readFile(LOG_CSV_PATH, "utf8");
    const lines = raw.split(/\r?\n/).filter((line) => line.trim().length > 0);
    if (lines.length < 2) return null;
    const last = lines[lines.length - 1];
    const values = last.split(",");
    if (values.length < 12) return null;
    return {
      checkedAt: values[0],
      sourcePriceEur: values[1] ? Number.parseFloat(values[1]) : null,
      galaxusPriceChf: values[4] ? Number.parseFloat(values[4]) : null,
      stockToPush: values[9] ? Number.parseInt(values[9], 10) : 0,
      recommendation: values[10] ?? "",
      marginSafe: values[8] ? Number.parseFloat(values[8]) : 0,
    };
  } catch {
    return null;
  }
}

type SqliteDb = {
  prepare: (sql: string) => {
    get: (...args: unknown[]) => Record<string, unknown> | undefined;
    run: (...args: unknown[]) => unknown;
  };
  exec: (sql: string) => void;
  close: () => void;
};

async function openSqliteDb(filePath: string): Promise<SqliteDb | null> {
  try {
    const moduleName = "node:sqlite";
    const sqlite: any = await import(moduleName);
    const DatabaseSync = sqlite?.DatabaseSync;
    if (!DatabaseSync) return null;
    const db = new DatabaseSync(filePath) as SqliteDb;
    db.exec(`
      CREATE TABLE IF NOT EXISTS beatbot_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        checked_at TEXT NOT NULL,
        source_price_eur REAL,
        source_status TEXT,
        source_shipping_text TEXT,
        galaxus_price_chf REAL,
        galaxus_seller TEXT,
        landed_safe_chf REAL,
        target_supplier_price_chf REAL,
        estimated_margin_safe_chf REAL,
        stock_to_push INTEGER,
        recommendation TEXT,
        reason_text TEXT,
        alert_text TEXT
      );
    `);
    return db;
  } catch {
    return null;
  }
}

function buildAlerts(
  previous: LogSnapshot | null,
  current: {
    sourcePriceEur: number | null;
    galaxusPriceChf: number | null;
    recommendation: string;
    stockToPush: number;
    marginSafe: number;
    sourceStatus: string;
  }
): string[] {
  const alerts: string[] = [];
  if (previous && previous.sourcePriceEur !== null && current.sourcePriceEur !== null) {
    if (Math.abs(previous.sourcePriceEur - current.sourcePriceEur) >= 0.01) {
      alerts.push(
        `Source price changed: ${previous.sourcePriceEur.toFixed(2)} EUR -> ${current.sourcePriceEur.toFixed(2)} EUR.`
      );
    }
  }
  if (previous && previous.galaxusPriceChf !== null && current.galaxusPriceChf !== null) {
    if (Math.abs(previous.galaxusPriceChf - current.galaxusPriceChf) >= 0.01) {
      alerts.push(
        `Galaxus competitor price changed: CHF ${previous.galaxusPriceChf.toFixed(2)} -> CHF ${current.galaxusPriceChf.toFixed(2)}.`
      );
    }
  }
  if (current.marginSafe < ALERT_MARGIN_FLOOR) {
    alerts.push(
      `Margin below floor: CHF ${current.marginSafe.toFixed(2)} < CHF ${ALERT_MARGIN_FLOOR.toFixed(2)}.`
    );
  }
  if (current.sourceStatus === "sold_out") {
    alerts.push("Source product is sold out.");
  }
  if (current.stockToPush === 0 && current.recommendation === "NO_GO") {
    alerts.push("Stock forced to 0 by no-go rules.");
  }
  return alerts;
}

async function sendAlerts(alerts: string[], recommendation: string) {
  if (alerts.length === 0) return;
  const checkedAt = new Date().toISOString();
  const message = [
    `Beatbot monitor alert (${recommendation})`,
    `Checked at: ${checkedAt}`,
    "",
    ...alerts.map((entry) => `- ${entry}`),
  ].join("\n");

  const slackWebhook =
    process.env.BEATBOT_ALERT_SLACK_WEBHOOK_URL ?? process.env.SLACK_WEBHOOK_URL ?? "";
  if (slackWebhook) {
    try {
      await fetch(slackWebhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: message }),
      });
    } catch (error) {
      console.error("[beatbot-monitor] slack alert failed:", error);
    }
  }

  const postmarkToken = process.env.POSTMARK_SERVER_TOKEN ?? "";
  const postmarkFrom = process.env.POSTMARK_FROM_EMAIL ?? "";
  const postmarkTo = process.env.BEATBOT_ALERT_EMAIL_TO ?? "";
  if (postmarkToken && postmarkFrom && postmarkTo) {
    try {
      await fetch("https://api.postmarkapp.com/email", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-postmark-server-token": postmarkToken,
          accept: "application/json",
        },
        body: JSON.stringify({
          From: postmarkFrom,
          To: postmarkTo,
          Subject: `Beatbot monitor alert (${recommendation})`,
          TextBody: message,
        }),
      });
    } catch (error) {
      console.error("[beatbot-monitor] email alert failed:", error);
    }
  }
}

async function upsertBeatbotToDb(params: {
  source: BeatbotSourceData;
  galaxus: GalaxusData;
  computation: Computation;
  gtin: string | null;
  providerKey: string | null;
  dryRun: boolean;
}) {
  if (params.dryRun) {
    return { skipped: true, reason: "dry-run" as const };
  }

  const now = new Date();
  const mpn = params.source.mpn ?? params.galaxus.manufacturerNo ?? "PRCSSF01-EU-G";
  const landedSafeRounded = Math.round(params.computation.landedSafe * 100) / 100;
  const note = buildProductManualNote({
    source: params.source,
    galaxus: params.galaxus,
    computation: params.computation,
    resolvedGtin: params.gtin,
    providerKey: params.providerKey,
  });

  await prisma.supplierVariant.upsert({
    where: { supplierVariantId: SUPPLIER_VARIANT_ID },
    create: {
      supplierVariantId: SUPPLIER_VARIANT_ID,
      supplierSku: mpn,
      providerKey: params.providerKey,
      gtin: params.gtin,
      price: landedSafeRounded,
      stock: params.computation.stockToPush,
      supplierBrand: "Beatbot",
      supplierProductName: params.source.titleEn,
      images: params.source.images,
      sourceImageUrl: params.source.images[0] ?? null,
      leadTimeDays: DEFAULT_DELIVERY_DAYS_MAX,
      deliveryType: "import_preorder",
      manualPrice: params.computation.targetSupplierPriceChf,
      manualStock: params.computation.stockToPush,
      manualLock: true,
      manualNote: note,
      manualUpdatedAt: now,
      lastSyncAt: now,
    },
    update: {
      supplierSku: mpn,
      providerKey: params.providerKey,
      gtin: params.gtin,
      price: landedSafeRounded,
      stock: params.computation.stockToPush,
      supplierBrand: "Beatbot",
      supplierProductName: params.source.titleEn,
      images: params.source.images,
      sourceImageUrl: params.source.images[0] ?? null,
      leadTimeDays: DEFAULT_DELIVERY_DAYS_MAX,
      deliveryType: "import_preorder",
      manualPrice: params.computation.targetSupplierPriceChf,
      manualStock: params.computation.stockToPush,
      manualLock: true,
      manualNote: note,
      manualUpdatedAt: now,
      lastSyncAt: now,
    },
  });

  const mappingStatus =
    params.gtin && validateGtin(params.gtin) ? "SUPPLIER_GTIN" : "PENDING_GTIN";
  const mappingData = withMappingSupplierKey({
    supplierVariantId: SUPPLIER_VARIANT_ID,
    gtin: params.gtin,
    providerKey: params.providerKey,
    status: mappingStatus,
  });
  const mappingUpdateData = withMappingSupplierKey({
    gtin: params.gtin,
    providerKey: params.providerKey,
    status: mappingStatus,
    supplierVariantId: SUPPLIER_VARIANT_ID,
  });

  await prisma.variantMapping.upsert({
    where: { supplierVariantId: SUPPLIER_VARIANT_ID },
    create: mappingData,
    update: mappingUpdateData,
  });

  return {
    skipped: false,
    mappingStatus,
  };
}

async function cleanupLegacyBeatbotRows(dryRun: boolean) {
  if (dryRun) return { removedMappings: 0, removedVariants: 0 };
  let removedMappings = 0;
  let removedVariants = 0;
  for (const legacyId of LEGACY_SUPPLIER_VARIANT_IDS) {
    if (!legacyId || legacyId === SUPPLIER_VARIANT_ID) continue;
    const mappingDelete = await prisma.variantMapping
      .deleteMany({ where: { supplierVariantId: legacyId } })
      .catch(() => ({ count: 0 }));
    const variantDelete = await prisma.supplierVariant
      .deleteMany({ where: { supplierVariantId: legacyId } })
      .catch(() => ({ count: 0 }));
    removedMappings += Number(mappingDelete?.count ?? 0);
    removedVariants += Number(variantDelete?.count ?? 0);
  }
  return { removedMappings, removedVariants };
}

async function writeWatchlistCsv(params: {
  source: BeatbotSourceData;
  galaxus: GalaxusData;
  computation: Computation;
  resolvedGtin: string | null;
}) {
  const headers = [
    "product_id",
    "source_url",
    "galaxus_url",
    "brand",
    "model",
    "mpn",
    "ean",
    "source_price_eur",
    "source_status",
    "source_shipping_text",
    "galaxus_price_chf",
    "galaxus_seller",
    "target_supplier_price_chf",
    "landed_chf_estimate",
    "estimated_margin_chf",
    "stock_to_push",
    "delivery_days_min",
    "delivery_days_max",
    "last_checked_at",
    "status",
    "notes",
  ];

  const notes: string[] = [];
  if (!params.resolvedGtin) notes.push("GTIN not confirmed");
  if (params.galaxus.sourceMode === "fallback") notes.push("Galaxus scrape fallback mode");
  if (params.computation.reasons.length > 0) notes.push(params.computation.reasons.join(" "));

  const row = {
    product_id: MONITORED_PRODUCT_ID,
    source_url: SOURCE_URL,
    galaxus_url: GALAXUS_URL,
    brand: "Beatbot",
    model: "iSkim Ultra",
    mpn: params.source.mpn ?? params.galaxus.manufacturerNo ?? "PRCSSF01-EU-G",
    ean: params.resolvedGtin ?? "UNKNOWN",
    source_price_eur: params.source.priceEur?.toFixed(2) ?? "",
    source_status: params.source.sourceStatus,
    source_shipping_text: params.source.shippingText,
    galaxus_price_chf: params.galaxus.priceChf?.toFixed(2) ?? "",
    galaxus_seller: params.galaxus.sellerName ?? "",
    target_supplier_price_chf: params.computation.targetSupplierPriceChf.toFixed(2),
    landed_chf_estimate: params.computation.landedSafe.toFixed(2),
    estimated_margin_chf: params.computation.estimatedMarginSafe.toFixed(2),
    stock_to_push: String(params.computation.stockToPush),
    delivery_days_min: String(DEFAULT_DELIVERY_DAYS_MIN),
    delivery_days_max: String(DEFAULT_DELIVERY_DAYS_MAX),
    last_checked_at: new Date().toISOString(),
    status: params.computation.recommendation,
    notes: notes.join("; ") || "Ready",
  };

  const csv = toCsv(headers, [row]);
  await writeFile(WATCHLIST_CSV_PATH, csv, "utf8");
}

async function writeFeedUpdateCsv(params: {
  resolvedGtin: string | null;
  providerKey: string | null;
  computation: Computation;
}) {
  const headers = [
    "provider_key",
    "supplier_variant_id",
    "gtin",
    "supplier_price_chf",
    "stock_to_push",
    "delivery_days_min",
    "delivery_days_max",
    "recommendation",
    "checked_at",
    "reason",
  ];
  const row = {
    provider_key: params.providerKey ?? "",
    supplier_variant_id: SUPPLIER_VARIANT_ID,
    gtin: params.resolvedGtin ?? "",
    supplier_price_chf: params.computation.targetSupplierPriceChf.toFixed(2),
    stock_to_push: String(params.computation.stockToPush),
    delivery_days_min: String(DEFAULT_DELIVERY_DAYS_MIN),
    delivery_days_max: String(DEFAULT_DELIVERY_DAYS_MAX),
    recommendation: params.computation.recommendation,
    checked_at: new Date().toISOString(),
    reason: params.computation.reasons.join(" | "),
  };
  const csv = toCsv(headers, [row]);
  await writeFile(FEED_UPDATE_CSV_PATH, csv, "utf8");
}

async function appendCsvLog(params: {
  source: BeatbotSourceData;
  galaxus: GalaxusData;
  computation: Computation;
  alerts: string[];
}) {
  const headers = [
    "checked_at",
    "source_price_eur",
    "source_status",
    "source_shipping_text",
    "galaxus_price_chf",
    "galaxus_seller",
    "landed_safe_chf",
    "target_supplier_price_chf",
    "estimated_margin_safe_chf",
    "stock_to_push",
    "recommendation",
    "alerts",
  ];
  const row = {
    checked_at: new Date().toISOString(),
    source_price_eur: params.source.priceEur?.toFixed(2) ?? "",
    source_status: params.source.sourceStatus,
    source_shipping_text: params.source.shippingText,
    galaxus_price_chf: params.galaxus.priceChf?.toFixed(2) ?? "",
    galaxus_seller: params.galaxus.sellerName ?? "",
    landed_safe_chf: params.computation.landedSafe.toFixed(2),
    target_supplier_price_chf: params.computation.targetSupplierPriceChf.toFixed(2),
    estimated_margin_safe_chf: params.computation.estimatedMarginSafe.toFixed(2),
    stock_to_push: String(params.computation.stockToPush),
    recommendation: params.computation.recommendation,
    alerts: params.alerts.join(" | "),
  };
  const csvOneRow = toCsv(headers, [row]);
  try {
    const existing = await readFile(LOG_CSV_PATH, "utf8");
    const payload = `${existing.trimEnd()}\n${csvOneRow.split(/\r?\n/)[1]}\n`;
    await writeFile(LOG_CSV_PATH, payload, "utf8");
  } catch {
    await writeFile(LOG_CSV_PATH, `${csvOneRow}\n`, "utf8");
  }
}

async function writeSqliteLog(params: {
  source: BeatbotSourceData;
  galaxus: GalaxusData;
  computation: Computation;
  alerts: string[];
}) {
  const db = await openSqliteDb(LOG_SQLITE_PATH);
  if (!db) return;
  try {
    db.prepare(
      `
      INSERT INTO beatbot_checks (
        checked_at,
        source_price_eur,
        source_status,
        source_shipping_text,
        galaxus_price_chf,
        galaxus_seller,
        landed_safe_chf,
        target_supplier_price_chf,
        estimated_margin_safe_chf,
        stock_to_push,
        recommendation,
        reason_text,
        alert_text
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      new Date().toISOString(),
      params.source.priceEur,
      params.source.sourceStatus,
      params.source.shippingText,
      params.galaxus.priceChf,
      params.galaxus.sellerName,
      params.computation.landedSafe,
      params.computation.targetSupplierPriceChf,
      params.computation.estimatedMarginSafe,
      params.computation.stockToPush,
      params.computation.recommendation,
      params.computation.reasons.join(" | "),
      params.alerts.join(" | ")
    );
  } finally {
    db.close();
  }
}

function shouldSkipForFrequency(previous: LogSnapshot | null, force: boolean): boolean {
  if (force || !previous?.checkedAt) return false;
  const ts = new Date(previous.checkedAt).getTime();
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts < FOUR_DAYS_MS;
}

async function fetchBeatbotSource(): Promise<BeatbotSourceData> {
  const html = await fetchTextWithTimeout(SOURCE_URL, 45_000);
  await sleep(randomDelayMs());
  const jsonRaw = await fetchTextWithTimeout(SOURCE_JSON_URL, 45_000);
  return parseBeatbotSource(html, jsonRaw);
}

async function fetchGalaxus(): Promise<GalaxusData> {
  try {
    await sleep(randomDelayMs());
    const html = await fetchTextWithTimeout(GALAXUS_URL, 60_000);
    const parsed = parseGalaxusDataFromHtml(html);
    if (parsed.priceChf === null) {
      parsed.scrapeErrors.push("Galaxus live parse missing price.");
    }
    return parsed;
  } catch (error) {
    const fallback = buildFallbackGalaxusData();
    fallback.scrapeErrors.push(`Galaxus fetch error: ${String(error)}`);
    return fallback;
  }
}

async function main() {
  const flags = parseFlags(process.argv.slice(2));
  await ensureDataDir();

  const previous = await readLastCsvLog();
  if (shouldSkipForFrequency(previous, flags.force)) {
    const nextAllowedAt = previous
      ? new Date(new Date(previous.checkedAt).getTime() + FOUR_DAYS_MS).toISOString()
      : "unknown";
    console.log(
      JSON.stringify(
        {
          ok: true,
          skipped: true,
          reason: "Too soon since last check (4-day policy). Use --force to bypass.",
          nextAllowedAt,
        },
        null,
        2
      )
    );
    return;
  }

  const source = await fetchBeatbotSource();
  const galaxus = await fetchGalaxus();
  const resolvedGtin =
    source.barcode && validateGtin(source.barcode)
      ? source.barcode
      : galaxus.gtin && validateGtin(galaxus.gtin)
        ? galaxus.gtin
        : null;
  const providerKey = resolvedGtin ? buildProviderKey(resolvedGtin, SUPPLIER_VARIANT_ID) : null;

  const computation = computeTargetPriceAndStock(source, galaxus);
  if (!resolvedGtin) {
    computation.stockToPush = 0;
    if (computation.recommendation === "GO_PUSH") {
      computation.recommendation = "WATCH_ONLY";
    }
    computation.reasons.push("GTIN missing: do not invent GTIN, keep stock at 0.");
  }

  const alerts = buildAlerts(previous, {
    sourcePriceEur: source.priceEur,
    galaxusPriceChf: galaxus.priceChf,
    recommendation: computation.recommendation,
    stockToPush: computation.stockToPush,
    marginSafe: computation.estimatedMarginSafe,
    sourceStatus: source.sourceStatus,
  });

  const dbResult = await upsertBeatbotToDb({
    source,
    galaxus,
    computation,
    gtin: resolvedGtin,
    providerKey,
    dryRun: flags.dryRun,
  });
  const cleanupResult = await cleanupLegacyBeatbotRows(flags.dryRun);

  await writeWatchlistCsv({
    source,
    galaxus,
    computation,
    resolvedGtin,
  });
  await writeFeedUpdateCsv({
    resolvedGtin,
    providerKey,
    computation,
  });
  await appendCsvLog({
    source,
    galaxus,
    computation,
    alerts,
  });
  await writeSqliteLog({
    source,
    galaxus,
    computation,
    alerts,
  });
  await sendAlerts(alerts, computation.recommendation);

  console.log(
    JSON.stringify(
      {
        ok: true,
        productId: MONITORED_PRODUCT_ID,
        recommendation: computation.recommendation,
        source: {
          url: SOURCE_URL,
          priceEur: source.priceEur,
          compareAtEur: source.compareAtEur,
          status: source.sourceStatus,
          shippingText: source.shippingText,
          shippingDate: source.shippingDateIso,
          mpn: source.mpn,
          services: source.services,
        },
        galaxus: {
          url: GALAXUS_URL,
          articleNumber: galaxus.articleNumber,
          manufacturerNo: galaxus.manufacturerNo,
          gtin: galaxus.gtin,
          priceChf: galaxus.priceChf,
          seller: galaxus.sellerName,
          stockCount: galaxus.stockCount,
          deliveryText: galaxus.deliveryText,
          ratingsCount: galaxus.ratingsCount,
          sourceMode: galaxus.sourceMode,
        },
        pricing: {
          eurChf: EUR_CHF,
          fxBuffer: FX_BUFFER,
          vatCh: TVA_CH,
          importBufferLow: IMPORT_BUFFER_LOW,
          importBufferHigh: IMPORT_BUFFER_HIGH,
          sourceChf: Number(computation.sourceChf.toFixed(2)),
          sourceChfFx: Number(computation.sourceChfFx.toFixed(2)),
          landedLow: Number(computation.landedLow.toFixed(2)),
          landedHigh: Number(computation.landedHigh.toFixed(2)),
          landedSafe: Number(computation.landedSafe.toFixed(2)),
          targetSupplierPriceChf: computation.targetSupplierPriceChf,
          marginLow: Number(computation.estimatedMarginLow.toFixed(2)),
          marginHigh: Number(computation.estimatedMarginHigh.toFixed(2)),
          marginSafe: Number(computation.estimatedMarginSafe.toFixed(2)),
          stockToPush: computation.stockToPush,
        },
        feed: {
          supplierVariantId: SUPPLIER_VARIANT_ID,
          providerKey,
          gtin: resolvedGtin,
          deliveryDaysMin: DEFAULT_DELIVERY_DAYS_MIN,
          deliveryDaysMax: DEFAULT_DELIVERY_DAYS_MAX,
        },
        files: {
          watchlistCsv: WATCHLIST_CSV_PATH,
          feedUpdateCsv: FEED_UPDATE_CSV_PATH,
          logCsv: LOG_CSV_PATH,
          logSqlite: LOG_SQLITE_PATH,
        },
        alerts,
        reasons: computation.reasons,
        db: dbResult,
        cleanup: cleanupResult,
        scrapeErrors: [...source.scrapeErrors, ...galaxus.scrapeErrors],
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error("[beatbot-monitor] failed:", error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
