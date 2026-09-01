/**
 * Zero ALL live Decathlon Mirakl offers (qty → 0) and disable stock/price/offer cron.
 *
 * Root cause of prior failed wipe: STO01 with warehouse `76099996968-Switzerland`
 * does NOT clear offer-level `quantity` (fulfillment center DEFAULT). Live stock is
 * set via OF01 `quantity`. This script pushes OF01 qty=0 for known offers.
 *
 * Usage:
 *   npx tsx scripts/zero-all-decathlon-offers.ts
 *   ZERO_DECATHLON_SOURCE=mirakl npx tsx scripts/zero-all-decathlon-offers.ts
 */
import "dotenv/config";
import { prisma } from "@/app/lib/prisma";
import { buildMiraklClient } from "@/decathlon/mirakl/client";
import { buildOf01Csv } from "@/decathlon/mirakl/csv";
import {
  DECATHLON_MIRAKL_API_BASE_URL,
  DECATHLON_MIRAKL_API_KEY,
  DECATHLON_MIRAKL_API_KEY_HEADER,
  DECATHLON_MIRAKL_API_KEY_PREFIX,
} from "@/decathlon/mirakl/config";

const BATCH = 1500;
const PAGE = 100;
const PAGE_SLEEP_MS = 250;
const SLEEP_MS = 8_000;
const POLL_MS = 3_000;
const POLL_MAX = 90_000;

type MiraklOffer = {
  shop_sku?: string;
  quantity?: number;
  price?: number | string;
  state_code?: string;
  leadtime_to_ship?: number | string;
  logistic_class?: { code?: string } | string | null;
  product_references?: Array<{ reference?: string; reference_type?: string }>;
};

type ZeroRow = {
  offerSku: string;
  productId: string;
  price: string;
  state: string;
  logisticClass: string;
  leadtimeToShip: string;
};

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeaders(): HeadersInit {
  const key = String(DECATHLON_MIRAKL_API_KEY ?? "").trim();
  if (!key) throw new Error("Missing DECATHLON_MIRAKL_API_KEY");
  return {
    [DECATHLON_MIRAKL_API_KEY_HEADER]: `${DECATHLON_MIRAKL_API_KEY_PREFIX}${key}`,
  };
}

async function withPrismaRetry<T>(fn: () => Promise<T>, label: string, attempt = 1): Promise<T> {
  try {
    return await fn();
  } catch (err: any) {
    const code = String(err?.code ?? "");
    const msg = String(err?.message ?? err);
    const reconnectable =
      code === "P1017" || /closed the connection|Can't reach database|Connection reset/i.test(msg);
    if (reconnectable && attempt <= 5) {
      const wait = 2000 * attempt;
      console.log(`[zero-all-decathlon] prisma ${label} fail — reconnect wait ${wait}ms #${attempt}`);
      await sleep(wait);
      try {
        await prisma.$connect();
      } catch {
        /* ignore */
      }
      return withPrismaRetry(fn, label, attempt + 1);
    }
    throw err;
  }
}

async function fetchOffersPage(offset: number, attempt = 1): Promise<{ offers: MiraklOffer[]; totalCount: number }> {
  const base = DECATHLON_MIRAKL_API_BASE_URL.replace(/\/$/, "");
  const url = new URL(`${base}/api/offers`);
  url.searchParams.set("max", String(PAGE));
  url.searchParams.set("offset", String(offset));
  url.searchParams.set("active", "true");
  const res = await fetch(url.toString(), { headers: authHeaders() });
  if (!res.ok) {
    const body = await res.text();
    if ((res.status === 429 || res.status >= 500) && attempt <= 10) {
      const wait = Math.min(60_000, 2_000 * attempt * attempt);
      console.log(`[zero-all-decathlon] OF21 ${res.status} offset=${offset} — wait ${wait}ms #${attempt}`);
      await sleep(wait);
      return fetchOffersPage(offset, attempt + 1);
    }
    throw new Error(`Mirakl OF21 failed (${res.status}): ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as { offers?: MiraklOffer[]; total_count?: number };
  return {
    offers: Array.isArray(data.offers) ? data.offers : [],
    totalCount: Number(data.total_count ?? 0),
  };
}

function resolveEan(offer: MiraklOffer): string | null {
  const refs = Array.isArray(offer.product_references) ? offer.product_references : [];
  const ean = refs.find((r) => String(r.reference_type ?? "").toUpperCase() === "EAN");
  const value = String(ean?.reference ?? "").trim();
  return value || null;
}

function resolveLogisticClass(offer: MiraklOffer): string {
  const lc = offer.logistic_class;
  if (lc && typeof lc === "object") return String(lc.code ?? "").trim();
  return String(lc ?? "").trim();
}

async function listLiveOfferSkusFromMirakl(): Promise<ZeroRow[]> {
  const out: ZeroRow[] = [];
  let offset = 0;
  let totalCount = Infinity;
  let skippedNoEan = 0;

  while (offset < totalCount) {
    const page = await fetchOffersPage(offset);
    totalCount = page.totalCount || offset + page.offers.length;
    if (page.offers.length === 0) break;

    for (const offer of page.offers) {
      const offerSku = String(offer.shop_sku ?? "").trim();
      const qty = Number(offer.quantity ?? 0);
      if (!offerSku || !(Number.isFinite(qty) && qty > 0)) continue;
      const productId = resolveEan(offer);
      if (!productId) {
        skippedNoEan += 1;
        continue;
      }
      const priceNum = Number(offer.price);
      out.push({
        offerSku,
        productId,
        price: Number.isFinite(priceNum) && priceNum > 0 ? String(priceNum) : "1.00",
        state: String(offer.state_code ?? "11"),
        logisticClass: resolveLogisticClass(offer),
        leadtimeToShip: String(offer.leadtime_to_ship ?? ""),
      });
    }

    offset += page.offers.length;
    if (offset % 2000 === 0 || offset >= totalCount) {
      console.log(
        `[zero-all-decathlon] scanned=${offset}/${totalCount} liveQty=${out.length} skippedNoEan=${skippedNoEan}`
      );
    }
    if (page.offers.length < PAGE) break;
    await sleep(PAGE_SLEEP_MS);
  }

  console.log(
    `[zero-all-decathlon] mirakl scan done scanned=${offset} liveQty=${out.length} skippedNoEan=${skippedNoEan}`
  );
  return out;
}

/** Default: known offer rows in DB (avoids OF21 429 while wiping). */
async function listOfferSkusFromDb(): Promise<ZeroRow[]> {
  const rows = await withPrismaRetry(
    () =>
      (prisma as any).decathlonOfferSync.findMany({
        where: {
          offerCreatedAt: { not: null },
          gtin: { not: null },
        },
        select: { providerKey: true, gtin: true, lastPrice: true },
      }),
    "sync-scan"
  );

  const keys = rows.map((r: any) => String(r.providerKey ?? "").trim()).filter(Boolean);
  const variants = await withPrismaRetry(
    () =>
      prisma.supplierVariant.findMany({
        where: { providerKey: { in: keys } },
        select: { providerKey: true, price: true, manualPrice: true, manualLock: true, gtin: true },
      }),
    "variant-scan"
  );
  const byKey = new Map(variants.map((v) => [String(v.providerKey ?? "").trim(), v]));

  const out: ZeroRow[] = [];
  for (const row of rows) {
    const offerSku = String(row.providerKey ?? "").trim();
    const productId = String(row.gtin ?? byKey.get(offerSku)?.gtin ?? "").trim();
    if (!offerSku || !productId) continue;
    const variant = byKey.get(offerSku);
    const variantPrice =
      variant && variant.manualLock && variant.manualPrice != null
        ? Number(variant.manualPrice)
        : variant
          ? Number(variant.price)
          : NaN;
    const lastPrice = Number(row.lastPrice);
    const price =
      Number.isFinite(variantPrice) && variantPrice > 0
        ? String(variantPrice)
        : Number.isFinite(lastPrice) && lastPrice > 0
          ? String(lastPrice)
          : "1.00";
    out.push({
      offerSku,
      productId,
      price,
      state: "11",
      logisticClass: "",
      leadtimeToShip: "",
    });
  }
  console.log(`[zero-all-decathlon] db fallback skus=${out.length}`);
  return out;
}

async function importOf01WithRetry(
  client: ReturnType<typeof buildMiraklClient>,
  csv: string,
  attempt = 1
): Promise<string> {
  try {
    const res = await client.importOffers(csv, { import_mode: "NORMAL" });
    return String(res?.import_id ?? res?.id ?? "");
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    if ((msg.includes("429") || /\(5\d\d\)/.test(msg)) && attempt <= 8) {
      const wait = SLEEP_MS * attempt;
      console.log(`[zero-all-decathlon] OF01 import fail — wait ${wait}ms then retry #${attempt}`);
      await sleep(wait);
      return importOf01WithRetry(client, csv, attempt + 1);
    }
    throw err;
  }
}

async function waitImportComplete(client: ReturnType<typeof buildMiraklClient>, importId: string) {
  if (!importId) return;
  const started = Date.now();
  while (Date.now() - started < POLL_MAX) {
    try {
      const status = await client.getOfferImportStatus(importId);
      const code = String(status?.status ?? status?.status_code ?? "").toUpperCase();
      if (["COMPLETE", "COMPLETED", "FAILED", "CANCELLED"].includes(code)) {
        console.log(
          `[zero-all-decathlon] import ${importId} ${code} success=${status?.lines_in_success ?? "?"} error=${status?.lines_in_error ?? "?"}`
        );
        return;
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("429")) {
        await sleep(SLEEP_MS);
        continue;
      }
      throw err;
    }
    await sleep(POLL_MS);
  }
  console.log(`[zero-all-decathlon] import ${importId} poll timeout — continuing`);
}

async function disableCron() {
  await withPrismaRetry(
    () =>
      (prisma as any).galaxusJobDefinition.updateMany({
        where: {
          jobKey: {
            in: [
              "decathlon-stock-sync",
              "decathlon-price-sync",
              "decathlon-offer-sync",
              "decathlon-physical-offer-sync",
            ],
          },
        },
        data: { enabled: false },
      }),
    "disable-cron"
  );
  console.log("[zero-all-decathlon] cron stock/price/offer disabled");
}

async function markDbInactive(skus: string[]) {
  if (skus.length === 0) return;
  const now = new Date();
  await withPrismaRetry(
    () =>
      prisma.channelListingState.updateMany({
        where: { channel: "DECATHLON", providerKey: { in: skus } },
        data: { lastPushedStock: 0, status: "INACTIVE", updatedAt: now },
      }),
    "listing-update"
  );
  await withPrismaRetry(
    () =>
      (prisma as any).decathlonOfferSync.updateMany({
        where: { providerKey: { in: skus } },
        data: { lastStock: 0, lastStockSyncedAt: now, updatedAt: now },
      }),
    "sync-update"
  );
}

async function countLiveOffersSample(limitPages = 5): Promise<{ scanned: number; live: number }> {
  let offset = 0;
  let scanned = 0;
  let live = 0;
  for (let i = 0; i < limitPages; i++) {
    const page = await fetchOffersPage(offset);
    if (page.offers.length === 0) break;
    scanned += page.offers.length;
    for (const offer of page.offers) {
      if (Number(offer.quantity ?? 0) > 0) live += 1;
    }
    offset += page.offers.length;
    if (page.offers.length < PAGE) break;
    await sleep(PAGE_SLEEP_MS);
  }
  return { scanned, live };
}

async function main() {
  await disableCron();

  const source = String(process.env.ZERO_DECATHLON_SOURCE ?? "db").trim().toLowerCase();
  let live: ZeroRow[] = [];

  if (source === "mirakl") {
    try {
      live = await listLiveOfferSkusFromMirakl();
    } catch (err: any) {
      console.warn("[zero-all-decathlon] mirakl scan failed — DB fallback", err?.message ?? err);
      live = await listOfferSkusFromDb();
    }
    if (live.length < 1000) {
      console.warn(`[zero-all-decathlon] mirakl liveQty=${live.length} looks thin — merging DB fallback`);
      const fromDb = await listOfferSkusFromDb();
      const bySku = new Map(live.map((r) => [r.offerSku, r]));
      for (const row of fromDb) {
        if (!bySku.has(row.offerSku)) bySku.set(row.offerSku, row);
      }
      live = Array.from(bySku.values());
    }
  } else {
    // Default: DB-known Mirakl offers (avoid OF21 429 while wiping).
    live = await listOfferSkusFromDb();
  }

  console.log(`[zero-all-decathlon] skus=${live.length}`);
  if (live.length === 0) {
    const sample = await countLiveOffersSample(3).catch(() => ({ scanned: 0, live: -1 }));
    console.log(
      JSON.stringify({ ok: true, skus: 0, importIds: [], cronDisabled: true, sample }, null, 2)
    );
    return;
  }

  const client = buildMiraklClient();
  const importIds: string[] = [];

  for (let i = 0; i < live.length; i += BATCH) {
    const chunk = live.slice(i, i + BATCH);
    const { csv } = buildOf01Csv(
      chunk.map((row) => ({
        offerSku: row.offerSku,
        productId: row.productId,
        productIdType: "EAN",
        price: row.price,
        quantity: 0,
        state: row.state || "11",
        logisticClass: row.logisticClass,
        leadtimeToShip: row.leadtimeToShip,
      }))
    );
    const importId = await importOf01WithRetry(client, csv);
    importIds.push(importId);
    console.log(
      `[zero-all-decathlon] batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(live.length / BATCH)} size=${chunk.length} import_id=${importId}`
    );
    await waitImportComplete(client, importId);
    await markDbInactive(chunk.map((r) => r.offerSku));
    if (i + BATCH < live.length) await sleep(SLEEP_MS);
  }

  await disableCron();
  const sample = await countLiveOffersSample(5).catch(() => ({ scanned: 0, live: -1 }));
  console.log(
    JSON.stringify(
      { ok: true, skus: live.length, importIds, cronDisabled: true, salesPaused: true, sample },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
