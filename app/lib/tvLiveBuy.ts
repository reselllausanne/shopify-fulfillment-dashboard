import { prisma } from "@/app/lib/prisma";
import { fetchStockxProductByIdOrSlugRaw, kickdbVariantMatchesGtin } from "@/galaxus/kickdb/client";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";
import { buildStxDualPriceFields, stxProductAskMedian } from "@/galaxus/stx/variantPriceLanes";

/**
 * Live StockX buy price (CHF) per GTIN via KicksDB, for the TV dashboard margin.
 * Non-blocking: the feed reads the cache; stale/missing GTINs refresh in the background
 * (a few at a time) so the next poll shows the live number.
 */
const TTL_OK_MS = 30 * 60 * 1000;
const TTL_FAIL_MS = 5 * 60 * 1000;
const CALL_TIMEOUT_MS = 15_000;
const CONCURRENCY = 3;

type Entry = { at: number; price: number | null };
const cache = new Map<string, Entry>();
const queued = new Set<string>();
const queue: string[] = [];
let running = 0;

function key(gtin: string): string {
  return gtin.replace(/\D/g, "").replace(/^0+/, "");
}

/** Cached live buy price, or undefined when unknown / not yet fetched. */
export function liveBuyChfCached(gtin: string | null | undefined): number | undefined {
  const k = key(String(gtin ?? ""));
  if (!k) return undefined;
  const e = cache.get(k);
  return e && e.price != null && e.price > 0 ? e.price : undefined;
}

export function refreshLiveBuy(gtins: Iterable<string | null | undefined>): void {
  for (const g of gtins) {
    const raw = String(g ?? "").trim();
    const k = key(raw);
    if (!k || queued.has(k)) continue;
    const e = cache.get(k);
    if (e && Date.now() - e.at < (e.price != null ? TTL_OK_MS : TTL_FAIL_MS)) continue;
    queued.add(k);
    queue.push(raw);
  }
  pump();
}

function pump() {
  while (running < CONCURRENCY && queue.length) {
    const raw = queue.shift()!;
    running += 1;
    void fetchOne(raw)
      .catch(() => null)
      .then((price) => {
        cache.set(key(raw), { at: Date.now(), price: price ?? null });
      })
      .finally(() => {
        queued.delete(key(raw));
        running -= 1;
        pump();
      });
  }
}

async function fetchOne(gtin: string): Promise<number | null> {
  const row = await prisma.kickDBVariant.findFirst({
    where: { gtin: { in: expandGtinsForDbLookup([gtin]) } },
    select: { product: { select: { kickdbProductId: true, urlKey: true } } },
  });
  const id = row?.product?.urlKey || row?.product?.kickdbProductId;
  if (!id) return null;

  const { product } = await Promise.race([
    fetchStockxProductByIdOrSlugRaw(id),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("kickdb timeout")), CALL_TIMEOUT_MS)),
  ]);
  const variants = (product as { variants?: unknown[] })?.variants;
  if (!Array.isArray(variants)) return null;
  const variant = variants.find((v) => kickdbVariantMatchesGtin(v as never, gtin));
  if (!variant) return null;
  const name = String((product as { title?: unknown })?.title ?? (product as { name?: unknown })?.name ?? "") || null;
  const lanes = buildStxDualPriceFields(variant as { prices?: unknown }, product as never, name, {
    productAskMedian: stxProductAskMedian(variants),
  });
  const price = lanes?.standardBuyPrice ?? lanes?.price ?? null;
  return price != null && price > 0 ? price : null;
}
