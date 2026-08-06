import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import {
  isEssentialStockMatch,
  isLocalStockMatch,
  isPackageProtectionShopifyLine,
} from "@/app/utils/matching";
import { isEssentialsProduct } from "@/shopify/inventory/essentialsProduct";
import { getLocationConfig, PHYSICAL_LOCATIONS } from "@/shopify/inventory/locationConfig";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";

/** Flat fees per fulfilled Shopify order that has ≥1 shoe line. */
export const SHOPIFY_FULFILL_SHIP_CHF = 6.5;
export const SHOPIFY_FULFILL_FEE_CHF = 8.0;
export const SHOPIFY_FULFILL_TOTAL_CHF =
  SHOPIFY_FULFILL_SHIP_CHF + SHOPIFY_FULFILL_FEE_CHF;

export const SHOPIFY_FULFILL_SHIP_MARKER_PREFIX = "[SYSTEM:SHOPIFY_FULFILL_SHIP:";
export const SHOPIFY_FULFILL_FEE_MARKER_PREFIX = "[SYSTEM:SHOPIFY_FULFILL_FEE:";

/** Shipping → Shipping Costs. Fulfillment labor → Other Business (no Fulfillment category; Packaging Materials wrong). */
const SHIP_CATEGORY_NAME = "Shipping Costs";
const FEE_CATEGORY_NAME = "Other Business";
const DEFAULT_ACCOUNT_NAME = "Other";

/** Default sync/backfill window. */
export const SHOPIFY_FULFILL_EXPENSES_DEFAULT_MONTHS = 2;

const FOOTWEAR_RE =
  /\b(sneaker|sneakers|samba|gazelle|campus|superstar|jordan|dunk|air ?max|yeezy|asics|new ?balance|salomon|shoe|shoes|trainer|trainers|handball|spezial|shox|kayano|gel[- ]|cortez|ultraboost|nmd|forum|vomero|pegasus|air force|blazer|vapor|vapormax|vaporfly|zoomx|speedgoat|birkenstock|ugg|neumel|timberland|boot|boots|clog|clogs|mule|mules|sandal|sandals|slide|slides|slipper|slippers|loafer|loafers|hoka|on cloud|cloudmonster|cloudsurfer|trail)\b/i;

const NON_SHOE_RE =
  /\b(lego|hoodie|sweatshirt|crewneck|\btee\b|t-shirt|jersey|joggers?|jacket|pullover|sweater|shorts?|trousers|pants?\b|beanie|toque|snapback|backpack|rucksack|duffel|watch|g-shock|casio|camera|headphones?|airpods?|sticker|console|controller|phone|tumbler)\b/i;

/** EU / numeric size often present on shoe titles when shopifySizeEU is null. */
const SIZE_IN_TITLE_RE = /\b(?:eu\s*)?\d{2}(?:[.,]\d| ?\d\/\d)?\b/i;

export function shopifyFulfillShipMarker(shopifyOrderId: string): string {
  return `${SHOPIFY_FULFILL_SHIP_MARKER_PREFIX}${shopifyOrderId}]`;
}

export function shopifyFulfillFeeMarker(shopifyOrderId: string): string {
  return `${SHOPIFY_FULFILL_FEE_MARKER_PREFIX}${shopifyOrderId}]`;
}

export function extractShopifyOrderIdFromFulfillExpenseNote(
  note?: string | null
): string | null {
  if (!note) return null;
  const m = note.match(/\[SYSTEM:SHOPIFY_FULFILL_(?:SHIP|FEE):([^\]]+)\]/);
  return m?.[1] ?? null;
}

export type ShopifyFulfillLineHint = {
  shopifyProductTitle?: string | null;
  shopifySku?: string | null;
  shopifySizeEU?: string | null;
  stockxStatus?: string | null;
  stockxOrderNumber?: string | null;
  supplierSource?: string | null;
  matchType?: string | null;
  matchReasons?: string | null;
  /** True when FO / fulfillment location is Warehouse Bussigny / Antica / Lab / COLD BIEN. */
  fulfilledFromPhysical?: boolean | null;
};

/** Manual "in stock" / shop refs saved on OrderMatch (FO may still say Website stock). */
export function isShopifyManualInStockRef(line: {
  stockxOrderNumber?: string | null;
  stockxStatus?: string | null;
  matchType?: string | null;
  matchReasons?: string | null;
}): boolean {
  const hay = [
    line.stockxOrderNumber,
    line.stockxStatus,
    line.matchType,
    line.matchReasons,
  ]
    .map((v) => String(v ?? "").trim().toLowerCase())
    .filter(Boolean)
    .join(" | ");
  if (!hay) return false;
  if (/\bin\s*-?\s*stock\b/.test(hay) || hay.includes("instock")) return true;
  if (/\b(bussigny|antica|cold\s*bien|the\s*lab|rare\s*bienne|warehouse)\b/.test(hay)) {
    return true;
  }
  if (/\bphysical\s*stock\b/.test(hay) || /\blocal\s*stock\b/.test(hay)) return true;
  return false;
}

export function isPhysicalShopifyLocation(
  locationId?: string | null,
  locationName?: string | null
): boolean {
  const id = String(locationId ?? "").trim();
  if (id) {
    const cfg = getLocationConfig(id);
    if (cfg?.sourceType === "physical") return true;
    if (cfg?.sourceType === "online") return false;
  }
  const name = String(locationName ?? "").trim().toLowerCase();
  if (!name) return false;
  return PHYSICAL_LOCATIONS.some(
    (l) => name.includes(l.name.toLowerCase()) || l.name.toLowerCase().includes(name)
  );
}

export function isShopifyEssentialsOrFixedInStockLine(line: ShopifyFulfillLineHint): boolean {
  if (isEssentialStockMatch(line)) return true;
  return isEssentialsProduct(line.shopifySku, line.shopifyProductTitle);
}

/** Warehouse / shop owned stock — no Post pack+fulfill fee (already on shelf). */
export function isShopifyPhysicalInStockFulfillmentLine(line: ShopifyFulfillLineHint): boolean {
  if (line.fulfilledFromPhysical === true) return true;
  if (isLocalStockMatch(line)) return true;
  if (isShopifyManualInStockRef(line)) return true;
  if (isShopifyEssentialsOrFixedInStockLine(line)) return true;
  return false;
}

/**
 * Shoe product line (ignores protection / essentials / local / physical warehouse).
 * Used for classifying "would be a shoe fee" before physical skip.
 */
export function isShopifyShoeProductLine(line: ShopifyFulfillLineHint): boolean {
  const title = String(line.shopifyProductTitle ?? "").trim();
  const sku = String(line.shopifySku ?? "").trim();
  if (isPackageProtectionShopifyLine(title, sku)) return false;
  if (isShopifyEssentialsOrFixedInStockLine(line)) return false;
  if (isLocalStockMatch(line)) return false;
  if (isShopifyManualInStockRef(line)) return false;

  const hay = `${title} ${sku}`;
  if (FOOTWEAR_RE.test(hay)) return true;

  // Numeric size + not clear apparel/LEGO/etc → treat as shoe (common StockX title pattern).
  const sizeEU = String(line.shopifySizeEU ?? "").trim();
  const hasSize = Boolean(sizeEU) || SIZE_IN_TITLE_RE.test(title);
  if (hasSize && !NON_SHOE_RE.test(hay)) return true;

  return false;
}

/**
 * Dropship shoe that needs maison fulfill+ship cost (StockX / online location).
 * Skips package protection, Essentials, LOCAL lots, and Bussigny/shop physical FO lines.
 */
export function isShopifyShoeFulfillmentLine(line: ShopifyFulfillLineHint): boolean {
  if (!isShopifyShoeProductLine(line)) return false;
  if (line.fulfilledFromPhysical === true) return false;
  return true;
}

/** One fee per order if ≥1 dropship shoe line (not warehouse/shop in-stock). */
export function orderNeedsShopifyFulfillmentFees(lines: ShopifyFulfillLineHint[]): boolean {
  return lines.some((line) => isShopifyShoeFulfillmentLine(line));
}

/** True when order has shoe product lines but all are physical/local/essentials. */
export function orderIsPhysicalInStockShoeOnly(lines: ShopifyFulfillLineHint[]): boolean {
  const productLines = lines.filter(
    (l) => !isPackageProtectionShopifyLine(l.shopifyProductTitle, l.shopifySku)
  );
  const shoeProducts = productLines.filter((l) => {
    // Re-check footwear without physical skip — include LOCAL/physical shoes.
    const title = String(l.shopifyProductTitle ?? "").trim();
    const sku = String(l.shopifySku ?? "").trim();
    if (isPackageProtectionShopifyLine(title, sku)) return false;
    if (isShopifyEssentialsOrFixedInStockLine(l)) return false;
    const hay = `${title} ${sku}`;
    if (FOOTWEAR_RE.test(hay)) return true;
    const sizeEU = String(l.shopifySizeEU ?? "").trim();
    const hasSize = Boolean(sizeEU) || SIZE_IN_TITLE_RE.test(title);
    return hasSize && !NON_SHOE_RE.test(hay);
  });
  if (!shoeProducts.length) return false;
  return shoeProducts.every((l) => isShopifyPhysicalInStockFulfillmentLine(l));
}

export function shopifyFulfillFeeBreakdown(): {
  shipChf: number;
  feeChf: number;
  totalChf: number;
} {
  return {
    shipChf: SHOPIFY_FULFILL_SHIP_CHF,
    feeChf: SHOPIFY_FULFILL_FEE_CHF,
    totalChf: SHOPIFY_FULFILL_TOTAL_CHF,
  };
}

function toUtcDateOnly(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

export function defaultShopifyFulfillExpensesSince(now = new Date()): Date {
  const d = new Date(now.getTime());
  d.setUTCMonth(d.getUTCMonth() - SHOPIFY_FULFILL_EXPENSES_DEFAULT_MONTHS);
  return d;
}

async function resolveCategoryId(name: string): Promise<string> {
  const row = await prisma.expenseCategory.findUnique({ where: { name } });
  if (!row) throw new Error(`Expense category missing: ${name}`);
  return row.id;
}

async function resolveAccountId(): Promise<string> {
  const preferred =
    String(process.env.SHOPIFY_FULFILL_FEE_ACCOUNT_NAME ?? "").trim() ||
    String(process.env.GALAXUS_DELR_FEE_ACCOUNT_NAME ?? "").trim() ||
    DEFAULT_ACCOUNT_NAME;
  const byName = await prisma.paymentAccount.findUnique({ where: { name: preferred } });
  if (byName) return byName.id;
  const fallback = await prisma.paymentAccount.findUnique({
    where: { name: DEFAULT_ACCOUNT_NAME },
  });
  if (!fallback) {
    throw new Error(`Payment account missing: ${preferred} / ${DEFAULT_ACCOUNT_NAME}`);
  }
  return fallback.id;
}

export type UpsertShopifyFulfillFeesResult = {
  shopifyOrderId: string;
  shipChf: number;
  feeChf: number;
  ship: "created" | "updated" | "unchanged" | "skipped";
  fee: "created" | "updated" | "unchanged" | "skipped";
  eventDate: string;
  skippedReason?:
    | "no_shoe"
    | "cancelled"
    | "essentials_only"
    | "physical_stock_only"
    | "no_lines";
};

async function upsertExpenseLine(args: {
  marker: string;
  amount: number;
  categoryId: string;
  accountId: string;
  eventDate: Date;
  noteBody: string;
  sourceId: string;
  description: string;
}): Promise<"created" | "updated" | "unchanged"> {
  const amount = new Prisma.Decimal(args.amount.toFixed(2));
  const existing = await prisma.personalExpense.findFirst({
    where: { note: { contains: args.marker } },
    select: {
      id: true,
      amount: true,
      date: true,
      categoryId: true,
      accountId: true,
      isBusiness: true,
    },
  });

  const note = `${args.marker} ${args.noteBody}`.trim();
  let status: "created" | "updated" | "unchanged" = "unchanged";

  if (!existing) {
    await prisma.personalExpense.create({
      data: {
        date: args.eventDate,
        amount,
        currencyCode: "CHF",
        categoryId: args.categoryId,
        accountId: args.accountId,
        note,
        isBusiness: true,
      },
    });
    status = "created";
  } else {
    const sameAmount = toNumberSafe(existing.amount, 0) === args.amount;
    const sameDate = existing.date.getTime() === args.eventDate.getTime();
    const sameCat = existing.categoryId === args.categoryId;
    const sameAcc = existing.accountId === args.accountId;
    const sameBiz = existing.isBusiness === true;
    if (!sameAmount || !sameDate || !sameCat || !sameAcc || !sameBiz) {
      await prisma.personalExpense.update({
        where: { id: existing.id },
        data: {
          date: args.eventDate,
          amount,
          categoryId: args.categoryId,
          accountId: args.accountId,
          note,
          isBusiness: true,
        },
      });
      status = "updated";
    }
  }

  await prisma.manualFinanceEvent.deleteMany({
    where: {
      sourceType: "IMPORT",
      sourceId: args.sourceId,
      NOT: { eventDate: args.eventDate },
    },
  });

  await prisma.manualFinanceEvent.upsert({
    where: {
      sourceType_sourceId_eventDate: {
        sourceType: "IMPORT",
        sourceId: args.sourceId,
        eventDate: args.eventDate,
      },
    },
    update: {
      amount,
      currencyCode: "CHF",
      direction: "OUT",
      category: "OTHER",
      expenseCategoryId: args.categoryId,
      description: args.description,
      metadataJson: { system: "SHOPIFY_FULFILL_FEE", marker: args.marker },
    },
    create: {
      eventDate: args.eventDate,
      amount,
      currencyCode: "CHF",
      direction: "OUT",
      category: "OTHER",
      expenseCategoryId: args.categoryId,
      sourceType: "IMPORT",
      sourceId: args.sourceId,
      description: args.description,
      metadataJson: { system: "SHOPIFY_FULFILL_FEE", marker: args.marker },
    },
  });

  return status;
}

/**
 * Idempotent: one Business ship expense + one Business fulfill fee per Shopify order.
 * Recoverable year-end via note markers / ManualFinanceEvent sourceId.
 */
export async function upsertShopifyFulfillmentExpenses(args: {
  shopifyOrderId: string;
  shopifyOrderName?: string | null;
  fulfilledAt?: Date | null;
  orderCreatedAt?: Date | null;
  cancelledAt?: Date | null;
  lines?: ShopifyFulfillLineHint[] | null;
}): Promise<UpsertShopifyFulfillFeesResult> {
  const shopifyOrderId = String(args.shopifyOrderId ?? "").trim();
  if (!shopifyOrderId) throw new Error("shopifyOrderId required");

  const eventDate = toUtcDateOnly(
    args.fulfilledAt ?? args.orderCreatedAt ?? new Date()
  );
  const eventDateIso = eventDate.toISOString().slice(0, 10);

  if (args.cancelledAt) {
    await removeShopifyFulfillmentExpenses(shopifyOrderId);
    return {
      shopifyOrderId,
      shipChf: 0,
      feeChf: 0,
      ship: "skipped",
      fee: "skipped",
      eventDate: eventDateIso,
      skippedReason: "cancelled",
    };
  }

  let lines = args.lines ?? null;
  if (!lines) {
    lines = await prisma.orderMatch.findMany({
      where: { shopifyOrderId },
      select: {
        shopifyProductTitle: true,
        shopifySku: true,
        shopifySizeEU: true,
        stockxStatus: true,
        stockxOrderNumber: true,
        supplierSource: true,
        matchType: true,
        matchReasons: true,
      },
    });
  }

  if (!lines.length) {
    await removeShopifyFulfillmentExpenses(shopifyOrderId);
    return {
      shopifyOrderId,
      shipChf: 0,
      feeChf: 0,
      ship: "skipped",
      fee: "skipped",
      eventDate: eventDateIso,
      skippedReason: "no_lines",
    };
  }

  const productLines = lines.filter(
    (l) => !isPackageProtectionShopifyLine(l.shopifyProductTitle, l.shopifySku)
  );
  const essentialsOnly =
    productLines.length > 0 &&
    productLines.every((l) => isShopifyEssentialsOrFixedInStockLine(l));
  if (essentialsOnly) {
    await removeShopifyFulfillmentExpenses(shopifyOrderId);
    return {
      shopifyOrderId,
      shipChf: 0,
      feeChf: 0,
      ship: "skipped",
      fee: "skipped",
      eventDate: eventDateIso,
      skippedReason: "essentials_only",
    };
  }

  // Warehouse Bussigny / Antica / Lab / COLD BIEN / LOCAL lot shoes — no Post fee.
  if (orderIsPhysicalInStockShoeOnly(lines) || !orderNeedsShopifyFulfillmentFees(lines)) {
    const physicalOnly = orderIsPhysicalInStockShoeOnly(lines);
    const hasAnyShoeProduct = productLines.some((l) => {
      const title = String(l.shopifyProductTitle ?? "").trim();
      const sku = String(l.shopifySku ?? "").trim();
      if (isPackageProtectionShopifyLine(title, sku)) return false;
      if (isShopifyEssentialsOrFixedInStockLine(l)) return false;
      const hay = `${title} ${sku}`;
      if (FOOTWEAR_RE.test(hay)) return true;
      const sizeEU = String(l.shopifySizeEU ?? "").trim();
      return (Boolean(sizeEU) || SIZE_IN_TITLE_RE.test(title)) && !NON_SHOE_RE.test(hay);
    });
    await removeShopifyFulfillmentExpenses(shopifyOrderId);
    return {
      shopifyOrderId,
      shipChf: 0,
      feeChf: 0,
      ship: "skipped",
      fee: "skipped",
      eventDate: eventDateIso,
      skippedReason: physicalOnly && hasAnyShoeProduct ? "physical_stock_only" : "no_shoe",
    };
  }

  const breakdown = shopifyFulfillFeeBreakdown();
  const [shipCategoryId, feeCategoryId, accountId] = await Promise.all([
    resolveCategoryId(SHIP_CATEGORY_NAME),
    resolveCategoryId(FEE_CATEGORY_NAME),
    resolveAccountId(),
  ]);

  const orderLabel =
    String(args.shopifyOrderName ?? "").trim() || shopifyOrderId;
  const common = `Shopify fulfill ${orderLabel} · dropship shoe · ship CHF ${breakdown.shipChf.toFixed(2)} + fee CHF ${breakdown.feeChf.toFixed(2)}`;

  const shipMarker = shopifyFulfillShipMarker(shopifyOrderId);
  const feeMarker = shopifyFulfillFeeMarker(shopifyOrderId);

  const ship = await upsertExpenseLine({
    marker: shipMarker,
    amount: breakdown.shipChf,
    categoryId: shipCategoryId,
    accountId,
    eventDate,
    noteBody: `ship CHF ${breakdown.shipChf.toFixed(2)} · ${common}`,
    sourceId: `shopify-fulfill-ship:${shopifyOrderId}`,
    description: `Shopify fulfill shipping (${orderLabel})`,
  });

  const fee = await upsertExpenseLine({
    marker: feeMarker,
    amount: breakdown.feeChf,
    categoryId: feeCategoryId,
    accountId,
    eventDate,
    noteBody: `fulfill CHF ${breakdown.feeChf.toFixed(2)} · category=${FEE_CATEGORY_NAME} (no Fulfillment cat; Packaging Materials wrong) · ${common}`,
    sourceId: `shopify-fulfill-fee:${shopifyOrderId}`,
    description: `Shopify fulfill fee (${orderLabel})`,
  });

  return {
    shopifyOrderId,
    shipChf: breakdown.shipChf,
    feeChf: breakdown.feeChf,
    ship,
    fee,
    eventDate: eventDateIso,
  };
}

export async function removeShopifyFulfillmentExpenses(shopifyOrderId: string): Promise<{
  deletedExpenses: number;
  deletedManualEvents: number;
}> {
  const shipMarker = shopifyFulfillShipMarker(shopifyOrderId);
  const feeMarker = shopifyFulfillFeeMarker(shopifyOrderId);

  const expenses = await prisma.personalExpense.deleteMany({
    where: {
      OR: [{ note: { contains: shipMarker } }, { note: { contains: feeMarker } }],
    },
  });

  const events = await prisma.manualFinanceEvent.deleteMany({
    where: {
      sourceType: "IMPORT",
      sourceId: {
        in: [
          `shopify-fulfill-ship:${shopifyOrderId}`,
          `shopify-fulfill-fee:${shopifyOrderId}`,
        ],
      },
    },
  });

  return {
    deletedExpenses: expenses.count,
    deletedManualEvents: events.count,
  };
}

type SyncOrderHint = {
  shopifyOrderName: string | null;
  fulfilledAt: Date;
  cancelledAt?: Date | null;
  lineHints?: ShopifyFulfillLineHint[];
  /** All Shopify fulfillments / FOs assigned to physical warehouse/shop locations. */
  allFulfillmentsPhysical?: boolean;
  source: "awb_record" | "shopify_api";
};

type ShopifyFulfilledOrderNode = {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFulfillmentStatus: string | null;
  fulfillments: Array<{
    createdAt: string;
    location?: { id?: string | null; name?: string | null } | null;
  }>;
  fulfillmentOrders?: {
    nodes?: Array<{
      status?: string | null;
      assignedLocation?: {
        name?: string | null;
        location?: { id?: string | null; name?: string | null } | null;
      } | null;
      lineItems?: {
        nodes?: Array<{
          lineItem?: { id?: string | null; title?: string | null; sku?: string | null } | null;
        } | null> | null;
      } | null;
    } | null> | null;
  } | null;
  lineItems: {
    edges: Array<{
      node: { id?: string | null; title: string; sku: string | null };
    }>;
  };
};

function lineHintsFromShopifyNode(node: ShopifyFulfilledOrderNode): {
  lineHints: ShopifyFulfillLineHint[];
  allFulfillmentsPhysical: boolean;
} {
  const physicalByLineItemId = new Map<string, boolean>();
  for (const fo of node.fulfillmentOrders?.nodes ?? []) {
    const locId = String(fo?.assignedLocation?.location?.id ?? "").trim();
    const locName = String(
      fo?.assignedLocation?.location?.name ?? fo?.assignedLocation?.name ?? ""
    ).trim();
    const physical = isPhysicalShopifyLocation(locId, locName);
    for (const li of fo?.lineItems?.nodes ?? []) {
      const id = String(li?.lineItem?.id ?? "").trim();
      if (!id) continue;
      // Any physical FO assignment marks the line physical.
      if (physical || !physicalByLineItemId.has(id)) {
        physicalByLineItemId.set(id, physical);
      }
    }
  }

  const fulfillmentLocs = (node.fulfillments ?? [])
    .map((f) => ({
      id: String(f.location?.id ?? "").trim(),
      name: String(f.location?.name ?? "").trim(),
    }))
    .filter((l) => l.id || l.name);
  const allFulfillmentsPhysical =
    fulfillmentLocs.length > 0 &&
    fulfillmentLocs.every((l) => isPhysicalShopifyLocation(l.id, l.name));

  // Order-level physical when all fulfillments are physical (no online dropship leg).
  const orderLevelPhysical = allFulfillmentsPhysical;

  const lineHints = (node.lineItems?.edges ?? []).map((e) => {
    const id = String(e.node.id ?? "").trim();
    const fromFo = id ? physicalByLineItemId.get(id) : undefined;
    return {
      shopifyProductTitle: e.node.title,
      shopifySku: e.node.sku,
      shopifySizeEU: null,
      stockxStatus: null,
      stockxOrderNumber: null,
      fulfilledFromPhysical: fromFo === true || (fromFo == null && orderLevelPhysical),
    };
  });

  return { lineHints, allFulfillmentsPhysical };
}

function isShopifyFulfilledStatus(status: string | null | undefined): boolean {
  const st = String(status ?? "").toUpperCase();
  return st === "FULFILLED" || st === "PARTIAL" || st === "PARTIALLY_FULFILLED";
}

function earliestShopifyFulfillmentAt(node: ShopifyFulfilledOrderNode): Date | null {
  const times = (node.fulfillments ?? [])
    .map((f) => new Date(f.createdAt).getTime())
    .filter((t) => Number.isFinite(t));
  if (!times.length) return null;
  return new Date(Math.min(...times));
}

/**
 * Shopify Admin: paid/any orders created or updated since `since` that are fulfilled.
 * Catches Swiss Post / manual fulfills that never wrote ShopifyFulfillmentRecord (AWB path).
 */
async function fetchShopifyFulfilledOrdersSince(since: Date): Promise<ShopifyFulfilledOrderNode[]> {
  const sinceIso = since.toISOString();
  const queries = [
    `created_at:>=${sinceIso} status:any`,
    // Late fulfills of older orders (non-AWB path) — updated when fulfillment posts.
    `updated_at:>=${sinceIso} fulfillment_status:shipped status:any`,
  ];

  const byId = new Map<string, ShopifyFulfilledOrderNode>();
  const gql = /* GraphQL */ `
    query ShopifyFulfillFeeOrders($q: String!, $cursor: String) {
      orders(first: 100, after: $cursor, query: $q, sortKey: UPDATED_AT, reverse: true) {
        pageInfo {
          hasNextPage
          endCursor
        }
        edges {
          node {
            id
            name
            createdAt
            cancelledAt
            displayFulfillmentStatus
            fulfillments(first: 10) {
              createdAt
              location {
                id
                name
              }
            }
            fulfillmentOrders(first: 10) {
              nodes {
                status
                assignedLocation {
                  name
                  location {
                    id
                    name
                  }
                }
                lineItems(first: 50) {
                  nodes {
                    lineItem {
                      id
                      title
                      sku
                    }
                  }
                }
              }
            }
            lineItems(first: 50) {
              edges {
                node {
                  id
                  title
                  sku
                }
              }
            }
          }
        }
      }
    }
  `;

  type OrdersPage = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: ShopifyFulfilledOrderNode }>;
    };
  };

  for (const q of queries) {
    let cursor: string | null = null;
    for (let page = 0; page < 80; page += 1) {
      const result = await shopifyGraphQL<OrdersPage>(gql, { q, cursor });
      const data: OrdersPage = result.data;
      if (result.errors?.length) {
        throw new Error(
          `Shopify fulfill-fee order query failed: ${result.errors.map((e) => e.message).join("; ")}`
        );
      }
      for (const edge of data.orders.edges) {
        const node = edge.node;
        if (!isShopifyFulfilledStatus(node.displayFulfillmentStatus)) continue;
        if (!earliestShopifyFulfillmentAt(node)) continue;
        const prev = byId.get(node.id);
        if (!prev) {
          byId.set(node.id, node);
          continue;
        }
        // Prefer node with more fulfillments / line items if duplicate across queries.
        if ((node.fulfillments?.length ?? 0) > (prev.fulfillments?.length ?? 0)) {
          byId.set(node.id, node);
        }
      }
      if (!data.orders.pageInfo.hasNextPage) break;
      cursor = data.orders.pageInfo.endCursor;
    }
  }

  return [...byId.values()];
}

function mergeSyncOrderHint(
  byOrder: Map<string, SyncOrderHint>,
  shopifyOrderId: string,
  hint: SyncOrderHint
): void {
  const prev = byOrder.get(shopifyOrderId);
  if (!prev) {
    byOrder.set(shopifyOrderId, hint);
    return;
  }
  const fulfilledAt =
    hint.fulfilledAt < prev.fulfilledAt ? hint.fulfilledAt : prev.fulfilledAt;
  const prevHints = prev.lineHints ?? [];
  const nextHints = hint.lineHints ?? [];
  // Prefer richer hints (physical FO flags); merge physical=true onto matching titles.
  let lineHints = prevHints.length ? prevHints : nextHints;
  if (prevHints.length && nextHints.length) {
    lineHints = prevHints.map((p) => {
      const match = nextHints.find(
        (n) =>
          String(n.shopifyProductTitle ?? "") === String(p.shopifyProductTitle ?? "") &&
          String(n.shopifySku ?? "") === String(p.shopifySku ?? "")
      );
      if (!match) return p;
      return {
        ...p,
        fulfilledFromPhysical:
          p.fulfilledFromPhysical === true || match.fulfilledFromPhysical === true
            ? true
            : p.fulfilledFromPhysical ?? match.fulfilledFromPhysical,
      };
    });
  } else if (!prevHints.length && nextHints.length) {
    lineHints = nextHints;
  }

  byOrder.set(shopifyOrderId, {
    shopifyOrderName: hint.shopifyOrderName ?? prev.shopifyOrderName,
    fulfilledAt,
    cancelledAt: hint.cancelledAt ?? prev.cancelledAt ?? null,
    lineHints,
    allFulfillmentsPhysical:
      Boolean(prev.allFulfillmentsPhysical) || Boolean(hint.allFulfillmentsPhysical),
    // Keep awb_record if either source was AWB (for stats); else shopify_api.
    source:
      prev.source === "awb_record" || hint.source === "awb_record"
        ? "awb_record"
        : "shopify_api",
  });
}

export async function syncShopifyFulfillmentExpenses(options?: {
  since?: Date | null;
  limit?: number;
}): Promise<{
  scanned: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  skippedNoShoe: number;
  skippedEssentials: number;
  skippedPhysicalStock: number;
  skippedCancelled: number;
  skippedNoLines: number;
  fromAwbRecords: number;
  fromShopifyApi: number;
  shipChf: number;
  feeChf: number;
  totalChf: number;
  chargedOrders: number;
  errors: Array<{ shopifyOrderId: string; message: string }>;
}> {
  const since = options?.since ?? defaultShopifyFulfillExpensesSince();

  const records = await prisma.shopifyFulfillmentRecord.findMany({
    where: { createdAt: { gte: since } },
    select: {
      shopifyOrderId: true,
      shopifyOrderName: true,
      createdAt: true,
      labelGeneratedAt: true,
    },
    orderBy: [{ createdAt: "asc" }],
  });

  // One fee per order; earliest fulfillment date wins.
  // Sources: AWB/label path (ShopifyFulfillmentRecord) ∪ Shopify Admin fulfillments
  // (manual / Swiss Post / any path that never wrote an AWB record).
  const byOrder = new Map<string, SyncOrderHint>();
  for (const r of records) {
    const fulfilledAt = r.labelGeneratedAt ?? r.createdAt;
    mergeSyncOrderHint(byOrder, r.shopifyOrderId, {
      shopifyOrderName: r.shopifyOrderName,
      fulfilledAt,
      source: "awb_record",
    });
  }

  const shopifyNodes = await fetchShopifyFulfilledOrdersSince(since);
  for (const node of shopifyNodes) {
    const fulfilledAt = earliestShopifyFulfillmentAt(node);
    if (!fulfilledAt) continue;
    // Skip ancient fulfills that only appear because updated_at bumped (note/tag edit).
    // Keep if already in AWB set (merge dates) OR fulfillment itself is in window.
    if (fulfilledAt < since && !byOrder.has(node.id)) continue;
    const { lineHints, allFulfillmentsPhysical } = lineHintsFromShopifyNode(node);
    mergeSyncOrderHint(byOrder, node.id, {
      shopifyOrderName: node.name,
      fulfilledAt,
      cancelledAt: node.cancelledAt ? new Date(node.cancelledAt) : null,
      lineHints,
      allFulfillmentsPhysical,
      source: "shopify_api",
    });
  }

  let orderEntries = [...byOrder.entries()];
  if (options?.limit && options.limit > 0) {
    orderEntries = orderEntries.slice(0, options.limit);
  }

  const orderIds = orderEntries.map(([id]) => id);
  const [matches, shopifyOrders] = await Promise.all([
    prisma.orderMatch.findMany({
      where: { shopifyOrderId: { in: orderIds } },
      select: {
        shopifyOrderId: true,
        shopifyProductTitle: true,
        shopifySku: true,
        shopifySizeEU: true,
        stockxStatus: true,
        stockxOrderNumber: true,
        supplierSource: true,
        matchType: true,
        matchReasons: true,
      },
    }),
    prisma.shopifyOrder.findMany({
      where: { shopifyOrderId: { in: orderIds } },
      select: {
        shopifyOrderId: true,
        createdAt: true,
        cancelledAt: true,
        orderName: true,
      },
    }),
  ]);

  const linesByOrder = new Map<string, ShopifyFulfillLineHint[]>();
  for (const m of matches) {
    const arr = linesByOrder.get(m.shopifyOrderId) ?? [];
    arr.push(m);
    linesByOrder.set(m.shopifyOrderId, arr);
  }
  const orderMeta = new Map(shopifyOrders.map((o) => [o.shopifyOrderId, o]));

  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let skipped = 0;
  let skippedNoShoe = 0;
  let skippedEssentials = 0;
  let skippedPhysicalStock = 0;
  let skippedCancelled = 0;
  let skippedNoLines = 0;
  let chargedOrders = 0;
  let fromAwbRecords = 0;
  let fromShopifyApi = 0;
  let shipChf = 0;
  let feeChf = 0;
  const errors: Array<{ shopifyOrderId: string; message: string }> = [];

  for (const [shopifyOrderId, hint] of orderEntries) {
    try {
      const meta = orderMeta.get(shopifyOrderId);
      const dbLines = linesByOrder.get(shopifyOrderId);
      const apiHints = hint.lineHints ?? [];
      // Prefer OrderMatch (sizeEU / ESS / LOCAL) + stamp physical FO flags from Shopify.
      let lines: ShopifyFulfillLineHint[] = dbLines?.length ? [...dbLines] : [...apiHints];
      if (dbLines?.length && apiHints.length) {
        lines = dbLines.map((m) => {
          const hit = apiHints.find(
            (h) =>
              String(h.shopifyProductTitle ?? "") === String(m.shopifyProductTitle ?? "") &&
              String(h.shopifySku ?? "") === String(m.shopifySku ?? "")
          );
          return {
            ...m,
            fulfilledFromPhysical:
              hit?.fulfilledFromPhysical === true || hint.allFulfillmentsPhysical === true
                ? true
                : hit?.fulfilledFromPhysical ?? null,
          };
        });
      } else if (!dbLines?.length && hint.allFulfillmentsPhysical) {
        lines = apiHints.map((h) => ({ ...h, fulfilledFromPhysical: true }));
      }

      // Whole order fulfilled only from physical locations → never charge Post fees.
      if (hint.allFulfillmentsPhysical) {
        lines = lines.map((l) => ({ ...l, fulfilledFromPhysical: true }));
      }

      const res = await upsertShopifyFulfillmentExpenses({
        shopifyOrderId,
        shopifyOrderName: hint.shopifyOrderName ?? meta?.orderName ?? null,
        fulfilledAt: hint.fulfilledAt,
        orderCreatedAt: meta?.createdAt ?? null,
        cancelledAt: hint.cancelledAt ?? meta?.cancelledAt ?? null,
        lines,
      });

      if (res.skippedReason) {
        skipped += 1;
        if (res.skippedReason === "no_shoe") skippedNoShoe += 1;
        else if (res.skippedReason === "essentials_only") skippedEssentials += 1;
        else if (res.skippedReason === "physical_stock_only") skippedPhysicalStock += 1;
        else if (res.skippedReason === "cancelled") skippedCancelled += 1;
        else if (res.skippedReason === "no_lines") skippedNoLines += 1;
        continue;
      }

      chargedOrders += 1;
      if (hint.source === "awb_record") fromAwbRecords += 1;
      else fromShopifyApi += 1;
      shipChf += res.shipChf;
      feeChf += res.feeChf;
      for (const st of [res.ship, res.fee]) {
        if (st === "created") created += 1;
        else if (st === "updated") updated += 1;
        else unchanged += 1;
      }
    } catch (e: any) {
      errors.push({ shopifyOrderId, message: e?.message ?? String(e) });
    }
  }

  return {
    scanned: orderEntries.length,
    created,
    updated,
    unchanged,
    skipped,
    skippedNoShoe,
    skippedEssentials,
    skippedPhysicalStock,
    skippedCancelled,
    skippedNoLines,
    fromAwbRecords,
    fromShopifyApi,
    shipChf: Number(shipChf.toFixed(2)),
    feeChf: Number(feeChf.toFixed(2)),
    totalChf: Number((shipChf + feeChf).toFixed(2)),
    chargedOrders,
    errors,
  };
}
