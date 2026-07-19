import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type StockxInboundHomeRoute = {
  id: string;
  stockxOrderNumber: string;
  /** When StockX # unknown yet, scan can still route via matched Shopify order name. */
  shopifyOrderName?: string | null;
  stockxAwb: string | null;
  stockxTrackingUrl: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

type RouteStore = {
  routes: StockxInboundHomeRoute[];
};

const STORE_PATH =
  process.env.STOCKX_INBOUND_HOME_ROUTES_PATH ||
  path.join(process.cwd(), ".data", "stockx-inbound-home-routes.json");

function normalizeOrderNumber(value: string | null | undefined): string {
  return String(value ?? "")
    .trim()
    .replace(/^#+/, "")
    .toUpperCase();
}

function normalizeShopifyOrderName(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const digits = trimmed.replace(/^#+/, "");
  return digits ? `#${digits}` : "";
}

function normalizeAwb(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (/^\d{13,}$/.test(cleaned)) return cleaned.slice(-12);
  return cleaned.toUpperCase();
}

function normalizeScanCode(value: string | null | undefined): string {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  const orderNorm = normalizeOrderNumber(trimmed);
  if (/^03-[A-Z0-9]+$/i.test(orderNorm)) return orderNorm;
  const awbNorm = normalizeAwb(trimmed);
  if (awbNorm) return awbNorm;
  return trimmed.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
}

async function readStore(): Promise<RouteStore> {
  try {
    const raw = await fs.readFile(STORE_PATH, "utf8");
    const parsed = JSON.parse(raw) as RouteStore;
    if (!Array.isArray(parsed?.routes)) return { routes: [] };
    return parsed;
  } catch (error: any) {
    if (error?.code === "ENOENT") return { routes: [] };
    throw error;
  }
}

async function writeStore(store: RouteStore): Promise<void> {
  await fs.mkdir(path.dirname(STORE_PATH), { recursive: true });
  await fs.writeFile(STORE_PATH, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export async function listStockxInboundHomeRoutes(): Promise<StockxInboundHomeRoute[]> {
  const store = await readStore();
  return [...store.routes].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function upsertStockxInboundHomeRoute(input: {
  stockxOrderNumber?: string | null;
  shopifyOrderName?: string | null;
  stockxAwb?: string | null;
  stockxTrackingUrl?: string | null;
  notes?: string | null;
}): Promise<StockxInboundHomeRoute> {
  const orderNumber = normalizeOrderNumber(input.stockxOrderNumber);
  const shopifyOrderName = normalizeShopifyOrderName(input.shopifyOrderName);
  if (!orderNumber && !shopifyOrderName) {
    throw new Error("Missing stockxOrderNumber or shopifyOrderName");
  }

  const awb = normalizeAwb(input.stockxAwb) || null;
  const trackingUrl = String(input.stockxTrackingUrl ?? "").trim() || null;
  const notes = String(input.notes ?? "").trim() || null;
  const now = new Date().toISOString();

  const store = await readStore();
  const existingIdx = store.routes.findIndex((route) => {
    if (orderNumber && normalizeOrderNumber(route.stockxOrderNumber) === orderNumber) return true;
    if (shopifyOrderName && normalizeShopifyOrderName(route.shopifyOrderName) === shopifyOrderName) {
      return true;
    }
    return false;
  });

  const existing = existingIdx >= 0 ? store.routes[existingIdx] : null;

  const next: StockxInboundHomeRoute = {
    id: existing?.id ?? randomUUID(),
    stockxOrderNumber: orderNumber || existing?.stockxOrderNumber || "",
    shopifyOrderName: shopifyOrderName || existing?.shopifyOrderName || null,
    stockxAwb: awb,
    stockxTrackingUrl: trackingUrl,
    notes,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  if (existingIdx >= 0) store.routes[existingIdx] = next;
  else store.routes.push(next);

  await writeStore(store);
  return next;
}

export async function findStockxInboundHomeRouteByCode(
  code: string | null | undefined
): Promise<StockxInboundHomeRoute | null> {
  const normalized = normalizeScanCode(code);
  if (!normalized) return null;

  const store = await readStore();
  for (const route of store.routes) {
    const orderNorm = normalizeOrderNumber(route.stockxOrderNumber);
    const awbNorm = normalizeAwb(route.stockxAwb);
    const tracking = String(route.stockxTrackingUrl ?? "");
    if (orderNorm && orderNorm === normalized) return route;
    if (awbNorm && (awbNorm === normalized || normalized.includes(awbNorm) || awbNorm.includes(normalized))) {
      return route;
    }
    if (tracking && tracking.toUpperCase().includes(normalized)) return route;
  }
  return null;
}

export async function findStockxInboundHomeRouteByShopifyOrderName(
  shopifyOrderName: string | null | undefined
): Promise<StockxInboundHomeRoute | null> {
  const normalized = normalizeShopifyOrderName(shopifyOrderName);
  if (!normalized) return null;

  const store = await readStore();
  for (const route of store.routes) {
    if (normalizeShopifyOrderName(route.shopifyOrderName) === normalized) return route;
  }
  return null;
}

export {
  normalizeAwb as normalizeInboundHomeAwb,
  normalizeScanCode as normalizeInboundHomeScanCode,
  normalizeShopifyOrderName as normalizeInboundHomeShopifyOrderName,
};
