import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type StockxInboundHomeRoute = {
  id: string;
  stockxOrderNumber: string;
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
  stockxOrderNumber: string;
  stockxAwb?: string | null;
  stockxTrackingUrl?: string | null;
  notes?: string | null;
}): Promise<StockxInboundHomeRoute> {
  const orderNumber = normalizeOrderNumber(input.stockxOrderNumber);
  if (!orderNumber) throw new Error("Missing stockxOrderNumber");

  const awb = normalizeAwb(input.stockxAwb) || null;
  const trackingUrl = String(input.stockxTrackingUrl ?? "").trim() || null;
  const notes = String(input.notes ?? "").trim() || null;
  const now = new Date().toISOString();

  const store = await readStore();
  const existingIdx = store.routes.findIndex(
    (route) => normalizeOrderNumber(route.stockxOrderNumber) === orderNumber
  );

  const next: StockxInboundHomeRoute = {
    id: existingIdx >= 0 ? store.routes[existingIdx].id : randomUUID(),
    stockxOrderNumber: orderNumber,
    stockxAwb: awb,
    stockxTrackingUrl: trackingUrl,
    notes,
    createdAt: existingIdx >= 0 ? store.routes[existingIdx].createdAt : now,
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

export { normalizeAwb as normalizeInboundHomeAwb, normalizeScanCode as normalizeInboundHomeScanCode };
