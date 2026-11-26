import { prisma } from "@/app/lib/prisma";
import { kickdbVariantMatchesGtin } from "@/galaxus/kickdb/client";
import { expandGtinsForDbLookup } from "@/galaxus/stx/purchaseUnits";
import { resolveStxShippingCHF } from "@/galaxus/stx/legoShipping";
import { selectStxActiveOffer, selectStxStandardOffer } from "@/galaxus/stx/offerSelection";
import { isOutlierStxOffer, stxProductAskMedian } from "@/galaxus/stx/variantPriceLanes";
import { stockxAllInChf } from "@/app/lib/stockxAllIn";

/**
 * StockX buy price (CHF all-in) per GTIN for the TV margin.
 * Source: KickDBProduct.rawJson, kept fresh by the SSE listener. No live API call, so the
 * first request after a restart already has a price. A size with no ask borrows the closest
 * size of the same product (flagged `extrapolated`).
 */
const TTL_MS = 60_000;

export type StxBuyQuote = {
  standardChf: number | null;
  expressChf: number | null;
  extrapolated: boolean;
};

type RawVariant = { size?: unknown; prices?: unknown; identifiers?: unknown; gtin?: unknown; ean?: unknown };

const cache = new Map<string, { at: number; quote: StxBuyQuote | null }>();

function key(gtin: string): string {
  return gtin.replace(/\D/g, "").replace(/^0+/, "");
}

function sizeNum(v: unknown): number | null {
  const n = Number.parseFloat(String(v ?? "").replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/** Pure: both lanes (all-in CHF) of one raw KicksDB variant, outlier asks dropped. */
export function quoteFromRawVariant(
  variant: RawVariant,
  product: unknown,
  productAskMedian: number | null
): { standardChf: number | null; expressChf: number | null } {
  const shipping = resolveStxShippingCHF(product as never);
  const keep = <T extends { price: number; asks: number }>(o: T | null) =>
    o && !isOutlierStxOffer(o, productAskMedian) ? o : null;
  const standard = keep(selectStxStandardOffer(variant.prices));
  const express = keep(selectStxActiveOffer(variant.prices));
  return {
    standardChf: standard ? stockxAllInChf(standard.price, shipping) : null,
    expressChf: express ? stockxAllInChf(express.price, shipping) : null,
  };
}

/** Pure: quote for the variant at `index`; borrows the nearest priced size when it has none. */
export function quoteForVariant(variants: RawVariant[], index: number, product: unknown): StxBuyQuote | null {
  const median = stxProductAskMedian(variants);
  const own = quoteFromRawVariant(variants[index]!, product, median);
  if (own.standardChf != null || own.expressChf != null) return { ...own, extrapolated: false };

  const want = sizeNum(variants[index]!.size);
  if (want == null) return null;
  let best: { dist: number; size: number; q: ReturnType<typeof quoteFromRawVariant> } | null = null;
  variants.forEach((v, i) => {
    if (i === index) return;
    const s = sizeNum(v.size);
    if (s == null) return;
    const q = quoteFromRawVariant(v, product, median);
    if (q.standardChf == null && q.expressChf == null) return;
    const dist = Math.abs(s - want);
    if (!best || dist < best.dist || (dist === best.dist && s < best.size)) best = { dist, size: s, q };
  });
  return best ? { ...(best as { q: typeof own }).q, extrapolated: true } : null;
}

async function fetchQuotes(gtins: string[]): Promise<Map<string, StxBuyQuote | null>> {
  const out = new Map<string, StxBuyQuote | null>();
  const rows = await prisma.kickDBVariant.findMany({
    where: {
      OR: [{ gtin: { in: expandGtinsForDbLookup(gtins) } }, { ean: { in: expandGtinsForDbLookup(gtins) } }],
    },
    select: { gtin: true, ean: true, product: { select: { rawJson: true } } },
  });
  for (const g of gtins) {
    out.set(g, null);
    for (const row of rows) {
      const raw = row.product?.rawJson as { variants?: unknown } | null;
      const variants = Array.isArray(raw?.variants) ? (raw!.variants as RawVariant[]) : [];
      const idx = variants.findIndex((v) => kickdbVariantMatchesGtin(v as never, g));
      if (idx < 0) continue;
      out.set(g, quoteForVariant(variants, idx, raw));
      break;
    }
  }
  return out;
}

/** Quotes for every GTIN (cached 60 s). GTINs StockX does not know map to null. */
export async function loadStxQuotes(
  gtins: Iterable<string | null | undefined>
): Promise<Map<string, StxBuyQuote | null>> {
  const result = new Map<string, StxBuyQuote | null>();
  const missing: string[] = [];
  const now = Date.now();
  for (const g of gtins) {
    const raw = String(g ?? "").trim();
    const k = key(raw);
    if (!k || result.has(raw)) continue;
    const hit = cache.get(k);
    if (hit && now - hit.at < TTL_MS) result.set(raw, hit.quote);
    else missing.push(raw);
  }
  if (missing.length) {
    const fresh = await fetchQuotes(missing).catch((e) => {
      console.warn("[tv] stx quotes failed", e instanceof Error ? e.message : e);
      return null;
    });
    for (const g of missing) {
      const quote = fresh?.get(g) ?? null;
      if (fresh) cache.set(key(g), { at: now, quote });
      result.set(g, quote);
    }
  }
  return result;
}

/** Lane the buyer would use: the express ask for express orders, else standard, else the other. */
export function pickBuyChf(quote: StxBuyQuote | null | undefined, express: boolean): number | undefined {
  if (!quote) return undefined;
  const first = express ? quote.expressChf : quote.standardChf;
  const second = express ? quote.standardChf : quote.expressChf;
  return first ?? second ?? undefined;
}
