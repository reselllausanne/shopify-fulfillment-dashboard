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
  // Scanners often inject spaces / AIM prefixes (e.g. "]C1") around UPS 1Z codes.
  const compact = trimmed.replace(/[^a-zA-Z0-9]/gi, "").toUpperCase();
  if (!compact) return "";

  const ups = compact.match(/1Z[0-9A-Z]{16}/);
  if (ups) return ups[0];

  // DHL Express labels often barcode as JJD/JD… while StockX stores the 10-digit AWB.
  const dhlPrefixed = compact.match(/^(?:JJD|JD|JVGL|JJD0+)(\d{10,})$/);
  if (dhlPrefixed) {
    const digits = dhlPrefixed[1] || "";
    if (digits.length >= 10) return digits.slice(-10);
  }

  if (/^\d{13,}$/.test(compact)) return compact.slice(-12);
  if (/^\d{10}$/.test(compact)) return compact;
  return compact;
}

/** Extra lookup keys for scan matching (label barcode ≠ DB AWB). */
export function awbLookupCandidates(value: string | null | undefined): string[] {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return [];
  const compact = trimmed.replace(/[^a-zA-Z0-9]/gi, "").toUpperCase();
  const primary = normalizeAwb(trimmed);
  const out = new Set<string>();
  if (primary) out.add(primary);
  if (compact) out.add(compact);

  const digits = compact.replace(/\D/g, "");
  if (digits.length >= 10) {
    out.add(digits.slice(-10));
    if (digits.length >= 12) out.add(digits.slice(-12));
  }
  // AIM Code 128 prefix "]C1" sometimes survives as a leading letter after cleanup.
  const strippedAim = compact.replace(/^[A-Z]\d/, (m) => m.slice(1));
  if (strippedAim && strippedAim !== compact) {
    const again = normalizeAwb(strippedAim);
    if (again) out.add(again);
  }

  return Array.from(out).filter((c) => c.length >= 6);
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
