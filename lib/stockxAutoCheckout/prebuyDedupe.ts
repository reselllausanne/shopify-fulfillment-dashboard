/**
 * Pre-buy dedupe before Shopify → StockX auto-checkout.
 *
 * Rules (user):
 * 1) Gmail (StockX + GOAT purchase mails) for style/SKU + size since sell date
 * 2) StockX buying history on BOTH accounts (shopify/default + galaxus) for
 *    unlinked product+size matches
 * 3) Only BUY_OK when neither hits
 *
 * Clear single unlinked StockX match → link via save-match (no new buy).
 * GOAT-only Gmail hit → block buy (manual link).
 */

import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { prisma } from "@/app/lib/prisma";
import { buildStockxOrderClaimIndex } from "@/app/lib/stockxCrossChannelClaims";
import { getCachedStockxBuyingOrders } from "@/galaxus/stx/buyingOrdersCache";
import type { StockxBuyingNode } from "@/galaxus/stx/stockxClient";
import { extractEUSize } from "@/lib/shopifyAdmin";
import { listStockxAccountTokens } from "@/lib/stockxToken";

export type PrebuyVerdict =
  | "BUY_OK"
  | "ALREADY_BOUGHT_GMAIL"
  | "MATCH_UNLINKED_STX"
  | "ALREADY_MATCHED"
  | "SKIP_REASON";

export type PrebuyDedupeInput = {
  shopifyOrderName: string;
  shopifyOrderId: string;
  shopifyLineItemId: string;
  shopifyCreatedAt: string;
  title: string;
  sku: string | null;
  sizeEU: string | null;
  /** Shopify product handle / StockX urlKey hint */
  urlKeyHint?: string | null;
  gtin?: string | null;
};

export type PrebuyGmailHit = {
  provider: "STOCKX" | "GOAT";
  date: string;
  subject: string;
  from: string;
  matchedTokens: string[];
};

export type PrebuyStxHit = {
  account: string;
  orderNumber: string;
  purchaseDate: string | null;
  styleId: string | null;
  urlKey: string | null;
  title: string | null;
  sizeEU: string | null;
  chainId: string | null;
  orderId: string | null;
  amount: number | null;
};

export type PrebuyDedupeResult = {
  verdict: PrebuyVerdict;
  detail: string;
  gmailHits: PrebuyGmailHit[];
  stxCandidates: PrebuyStxHit[];
  /** Set when a single clear unlinked STX match was linked. */
  linkedStockxOrderNumber?: string | null;
  peerSameSkuSize?: Array<{ orderName: string; stockxOrderNumber: string | null }>;
};

const TITLE_STOP = new Set([
  "nike",
  "adidas",
  "puma",
  "saucony",
  "supreme",
  "black",
  "white",
  "grey",
  "gray",
  "blue",
  "green",
  "red",
  "brown",
  "pink",
  "silver",
  "women",
  "womens",
  "men",
  "mens",
  "retro",
  "low",
  "high",
  "air",
  "max",
  "force",
  "running",
  "core",
  "team",
  "pearl",
  "medium",
  "gum",
  "sail",
  "triple",
  "plus",
]);

export function normCompact(s: string | null | undefined): string {
  return String(s ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function sizeFromSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const s = String(sku).trim();
  if (/-OS$/i.test(s) || /(?:^|-)OS$/i.test(s)) return "OS";
  const m = s.match(/-(\d{2}(?:\s*[12]\s*\/\s*3|\.\d+)?)\s*$/);
  if (!m) return null;
  return m[1]!.replace(/\s+/g, " ").replace("1/3", "⅓").replace("2/3", "⅔");
}

export function styleIdFromSku(sku: string | null | undefined): string | null {
  if (!sku) return null;
  const s = String(sku).trim();
  // Strip trailing size: -39 | -37.5 | -43 1/3 | -OS
  const stripped = s.replace(/-(\d{2}(?:\s*[12]\s*\/\s*3|\.\d+)?|OS)\s*$/i, "");
  return stripped || s;
}

export function normSizeEU(s: string | null | undefined): string | null {
  if (!s) return null;
  const raw = String(s).trim();
  if (/^os$/i.test(raw)) return "OS";
  let extracted =
    extractEUSize(raw)?.replace(/^EU\s*/i, "") ??
    raw.replace(/^EU\s*/i, "").replace(/^EUEU\s*/i, "").trim();
  extracted = extracted.replace(/\s*1\s*\/\s*3/, "⅓").replace(/\s*2\s*\/\s*3/, "⅔");
  if (/⅓|⅔/.test(extracted)) {
    const m = extracted.match(/(\d+)\s*([⅓⅔])/);
    return m ? `${m[1]}${m[2]}` : extracted;
  }
  const n = Number(String(extracted).replace(",", "."));
  if (!Number.isFinite(n)) return String(extracted).replace(",", ".");
  const thirds = Math.round(n * 3) / 3;
  if (Math.abs(thirds - Math.round(thirds)) < 1e-6) return String(Math.round(thirds));
  if (Math.abs(thirds - (Math.floor(thirds) + 1 / 3)) < 0.05) return `${Math.floor(thirds)}⅓`;
  if (Math.abs(thirds - (Math.floor(thirds) + 2 / 3)) < 0.05) return `${Math.floor(thirds)}⅔`;
  if (Math.abs(n - Math.round(n * 2) / 2) < 0.05) {
    const half = Math.round(n * 2) / 2;
    return Number.isInteger(half) ? String(half) : half.toFixed(1);
  }
  return String(n);
}

export function sizesCompatible(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  const na = normSizeEU(a);
  const nb = normSizeEU(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na === "OS" || nb === "OS") return na === nb;
  const fa = Number(na.replace("⅓", ".333").replace("⅔", ".667"));
  const fb = Number(nb.replace("⅓", ".333").replace("⅔", ".667"));
  return Number.isFinite(fa) && Number.isFinite(fb) && Math.abs(fa - fb) < 0.15;
}

function buyNodeMeta(n: StockxBuyingNode): {
  styleId: string | null;
  urlKey: string | null;
  title: string | null;
  sizeEU: string | null;
} {
  const pv = n.productVariant ?? {};
  const product = pv.product ?? {};
  return {
    styleId: product.styleId ? String(product.styleId) : null,
    urlKey: product.urlKey ? String(product.urlKey) : null,
    title: product.title || product.primaryTitle || product.name || null,
    sizeEU: n.localizedSizeTitle
      ? String(n.localizedSizeTitle)
      : pv.sizeChart?.displayOptions?.[0]?.size
        ? String(pv.sizeChart.displayOptions[0].size)
        : null,
  };
}

function imapCreds(): { user: string; password: string } | null {
  const user = String(process.env.STOCKX_OTP_IMAP_USER ?? "").trim();
  const password = String(process.env.STOCKX_OTP_IMAP_PASSWORD ?? "").replace(/\s+/g, "");
  if (!user || !password) return null;
  return { user, password };
}

function productMatchesLine(
  line: PrebuyDedupeInput,
  styleId: string | null,
  urlKey: string | null
): boolean {
  const styleFromShopify = normCompact(styleIdFromSku(line.sku));
  const skuN = normCompact(line.sku);
  const styleN = normCompact(styleId);
  const handle = String(line.urlKeyHint ?? "")
    .trim()
    .toLowerCase();
  const urlN = String(urlKey ?? "")
    .trim()
    .toLowerCase();

  if (
    styleFromShopify &&
    styleN &&
    (styleN === styleFromShopify ||
      styleN.includes(styleFromShopify) ||
      styleFromShopify.includes(styleN))
  ) {
    return true;
  }
  if (skuN && styleN && (styleN === skuN || skuN.includes(styleN))) return true;
  if (handle && urlN && (urlN === handle || urlN.includes(handle) || handle.includes(urlN))) {
    return true;
  }
  return false;
}

export async function searchGmailPurchaseHits(
  line: PrebuyDedupeInput
): Promise<PrebuyGmailHit[]> {
  const creds = imapCreds();
  if (!creds) {
    throw new Error("STOCKX_OTP_IMAP_* missing — cannot run Gmail prebuy dedupe");
  }

  const since = new Date(new Date(line.shopifyCreatedAt).getTime() - 2 * 24 * 60 * 60 * 1000);
  const client = new ImapFlow({
    host: "imap.gmail.com",
    port: 993,
    secure: true,
    auth: { user: creds.user, pass: creds.password },
    logger: false,
  });

  const hits: PrebuyGmailHit[] = [];
  await client.connect();
  try {
    const lock = await client.getMailboxLock("INBOX");
    try {
      const uids = await client.search({
        since,
        or: [{ from: "stockx.com" }, { from: "goat.com" }, { from: "flightclub.com" }],
      } as any);
      const list = Array.isArray(uids) ? uids : [];
      for await (const msg of client.fetch(list.slice(-600), {
        envelope: true,
        source: true,
      })) {
        const fromAddr = (msg.envelope?.from ?? [])
          .map((f) => String(f.address ?? "").toLowerCase())
          .join(",");
        const subject = String(msg.envelope?.subject ?? "");
        const date = msg.envelope?.date ? new Date(msg.envelope.date).toISOString() : "";
        if (/otp|verification|security code|two-factor|2fa/i.test(subject)) continue;
        if (/\[resell\]|match jaune|action manuelle/i.test(subject)) continue;

        const isStockx =
          /@(?:[\w-]+\.)*stockx\.com/.test(fromAddr) || fromAddr.includes("@stockx.com");
        const isGoat =
          /@(?:[\w-]+\.)*(?:goat\.com|flightclub\.com)/.test(fromAddr) ||
          fromAddr.includes("@goat.com");
        if (!isStockx && !isGoat) continue;

        let text = subject;
        try {
          const parsed = await simpleParser(msg.source as Buffer);
          text = `${parsed.subject ?? ""}\n${parsed.text ?? ""}\n${String(parsed.html ?? "").replace(/<[^>]+>/g, " ")}`;
        } catch {
          /* keep subject */
        }
        const blob = `${subject}\n${text}`.toLowerCase();
        const purchaseLike =
          /order\s*(confirmation|confirmed|number)|you\s*(bought|purchased)|purchase\s*confirmation|bought\s*for|thanks for (your )?order|order\s*placed|ask\s*price\s*accepted|bid\s*accepted|votre\s*commande|achat\s*confirm|en cours de vérification|authenticat/i.test(
            blob
          ) || /\b0[13]-[a-z0-9]{6,}\b/i.test(blob);

        const tokens: string[] = [];
        const styleN = normCompact(styleIdFromSku(line.sku));
        const skuN = normCompact(line.sku);
        const handle = String(line.urlKeyHint ?? "")
          .trim()
          .toLowerCase();
        const compactBlob = blob.replace(/[^a-z0-9]/g, "");

        if (styleN && styleN.length >= 6 && compactBlob.includes(styleN)) {
          tokens.push(`style:${styleIdFromSku(line.sku)}`);
        }
        if (skuN && skuN.length >= 8 && compactBlob.includes(skuN)) {
          tokens.push(`sku:${line.sku}`);
        }
        if (handle && handle.length >= 12 && blob.includes(handle)) {
          tokens.push(`handle:${handle}`);
        }

        const titleBits = String(line.title ?? "")
          .toLowerCase()
          .split(/[^a-z0-9]+/)
          .filter((w) => w.length >= 5 && !TITLE_STOP.has(w));
        const hitWords = titleBits.filter((w) => blob.includes(w));
        const sizeN = normSizeEU(line.sizeEU ?? sizeFromSku(line.sku));
        const sizeInMail =
          sizeN &&
          sizeN !== "OS" &&
          new RegExp(
            `\\beu\\s*${sizeN.replace(/[⅓⅔]/g, ".").replace(".", "\\.?")}\\b`,
            "i"
          ).test(blob);

        if (hitWords.length >= 2 && sizeInMail && purchaseLike) {
          tokens.push(`title+size:${hitWords.slice(0, 3).join("+")}/${sizeN}`);
        }

        const hard = tokens.some(
          (t) =>
            t.startsWith("style") ||
            t.startsWith("sku") ||
            t.startsWith("handle") ||
            t.startsWith("title+size")
        );
        if (!hard) continue;
        if (!purchaseLike && !tokens.some((t) => t.startsWith("style") || t.startsWith("sku"))) {
          continue;
        }

        hits.push({
          provider: isGoat ? "GOAT" : "STOCKX",
          date,
          subject: subject.slice(0, 160),
          from: fromAddr,
          matchedTokens: tokens,
        });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => undefined);
  }
  return hits;
}

export async function findUnlinkedStockxMatches(
  line: PrebuyDedupeInput
): Promise<PrebuyStxHit[]> {
  const accounts = await listStockxAccountTokens();
  if (!accounts.length) {
    throw new Error("No StockX account tokens — cannot run STX prebuy dedupe");
  }
  if (accounts.length < 2) {
    console.warn(
      `[PREBUY] only ${accounts.length} StockX account token(s) — prefer both shopify+galaxus`
    );
  }

  const sellMs = new Date(line.shopifyCreatedAt).getTime() - 24 * 60 * 60 * 1000;
  const sizeEU = normSizeEU(line.sizeEU ?? sizeFromSku(line.sku));
  const isOS = !sizeEU || sizeEU === "OS";

  const out: PrebuyStxHit[] = [];
  for (const acc of accounts) {
    const pending = await getCachedStockxBuyingOrders(acc.token, {
      state: "PENDING",
      first: 100,
      maxPages: 5,
    });
    const hist = await getCachedStockxBuyingOrders(acc.token, {
      state: "HISTORICAL",
      first: 100,
      maxPages: 3,
    });
    const nodes = [...pending.nodes, ...hist.nodes];
    const nums = nodes.map((n) => n.orderNumber).filter(Boolean) as string[];
    const ids = nodes.map((n) => n.orderId).filter(Boolean) as string[];
    const claims = await buildStockxOrderClaimIndex({
      stockxOrderNumbers: nums,
      stockxOrderIds: ids,
    });
    const oms = await prisma.orderMatch.findMany({
      where: { stockxOrderNumber: { in: nums } },
      select: { stockxOrderNumber: true },
    });
    const omSet = new Set(oms.map((o) => o.stockxOrderNumber).filter(Boolean));

    for (const n of nodes) {
      const num = n.orderNumber ?? "";
      if (!num) continue;
      if (omSet.has(num) || claims.byOrderNumber.get(num)) continue;
      const buyMs = n.purchaseDate ? new Date(n.purchaseDate).getTime() : 0;
      if (buyMs && buyMs < sellMs) continue;
      const meta = buyNodeMeta(n);
      if (!productMatchesLine(line, meta.styleId, meta.urlKey)) continue;
      if (!isOS && !sizesCompatible(sizeEU, meta.sizeEU)) continue;
      out.push({
        account: acc.source,
        orderNumber: num,
        purchaseDate: n.purchaseDate ?? n.creationDate ?? null,
        styleId: meta.styleId,
        urlKey: meta.urlKey,
        title: meta.title,
        sizeEU: meta.sizeEU,
        chainId: n.chainId ?? null,
        orderId: n.orderId ?? null,
        amount: n.amount != null && Number.isFinite(Number(n.amount)) ? Number(n.amount) : null,
      });
    }
  }
  return out;
}

async function findPeerSameSkuSize(line: PrebuyDedupeInput): Promise<
  Array<{ orderName: string; stockxOrderNumber: string | null }>
> {
  if (!line.sku) return [];
  const sizeEU = normSizeEU(line.sizeEU ?? sizeFromSku(line.sku));
  const peers = await prisma.orderMatch.findMany({
    where: {
      shopifySku: line.sku,
      NOT: { shopifyLineItemId: line.shopifyLineItemId },
    },
    select: {
      shopifyOrderName: true,
      shopifySizeEU: true,
      stockxOrderNumber: true,
    },
    take: 20,
  });
  return peers
    .filter((p) => sizesCompatible(sizeEU, p.shopifySizeEU))
    .map((p) => ({
      orderName: p.shopifyOrderName ?? "?",
      stockxOrderNumber: p.stockxOrderNumber,
    }));
}

async function linkUnlinkedMatch(
  line: PrebuyDedupeInput,
  hit: PrebuyStxHit
): Promise<{ ok: boolean; error?: string }> {
  try {
    const { POST } = await import("@/app/api/db/save-match/route");
    const res = await POST(
      new Request("http://local/api/db/save-match", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          shopifyOrderId: line.shopifyOrderId,
          shopifyOrderName: line.shopifyOrderName,
          shopifyCreatedAt: line.shopifyCreatedAt,
          shopifyLineItemId: line.shopifyLineItemId,
          shopifyProductTitle: line.title,
          shopifySku: line.sku,
          shopifySizeEU: normSizeEU(line.sizeEU ?? sizeFromSku(line.sku)),
          shopifyTotalPrice: 0,
          shopifyCurrencyCode: "CHF",
          stockxOrderNumber: hit.orderNumber,
          stockxChainId: hit.chainId,
          stockxOrderId: hit.orderId,
          stockxProductName: hit.title,
          stockxSizeEU: normSizeEU(hit.sizeEU),
          stockxSkuKey: hit.styleId,
          stockxPurchaseDate: hit.purchaseDate,
          matchConfidence: "HIGH",
          matchScore: 95,
          matchType: "prebuy_dedupe",
          matchReasons: ["prebuy_dedupe_unlinked_stx"],
          supplierSource: "STOCKX",
          supplierCost: hit.amount,
        }),
      }) as any
    );
    const json: any = await res.json().catch(() => ({}));
    if (!res.ok && json?.ok === false) {
      return { ok: false, error: json?.error || `HTTP ${res.status}` };
    }
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || String(e) };
  }
}

/**
 * Full pre-buy gate. When `linkIfClear` and exactly one unlinked STX match → save-match.
 */
export async function runPrebuyDedupeCheck(
  input: PrebuyDedupeInput,
  options?: { linkIfClear?: boolean; skipGmail?: boolean; skipStockx?: boolean }
): Promise<PrebuyDedupeResult> {
  const line = input;
  const linkIfClear = options?.linkIfClear !== false;

  const existing = await prisma.orderMatch.findUnique({
    where: { shopifyLineItemId: line.shopifyLineItemId },
    select: { stockxOrderNumber: true, supplierSource: true },
  });
  if (existing?.stockxOrderNumber) {
    return {
      verdict: "ALREADY_MATCHED",
      detail: `OrderMatch ${existing.stockxOrderNumber}`,
      gmailHits: [],
      stxCandidates: [],
    };
  }

  let gmailHits: PrebuyGmailHit[] = [];
  let stxCandidates: PrebuyStxHit[] = [];
  let peers: Array<{ orderName: string; stockxOrderNumber: string | null }> = [];
  try {
    [gmailHits, stxCandidates, peers] = await Promise.all([
      options?.skipGmail ? Promise.resolve([] as PrebuyGmailHit[]) : searchGmailPurchaseHits(line),
      options?.skipStockx ? Promise.resolve([] as PrebuyStxHit[]) : findUnlinkedStockxMatches(line),
      findPeerSameSkuSize(line),
    ]);
  } catch (e: any) {
    return {
      verdict: "SKIP_REASON",
      detail: `prebuy check failed (fail closed): ${e?.message || e}`,
      gmailHits: [],
      stxCandidates: [],
    };
  }

  if (stxCandidates.length === 1) {
    const hit = stxCandidates[0]!;
    let linked: string | null = null;
    let linkDetail = "would_link";
    if (linkIfClear) {
      const res = await linkUnlinkedMatch(line, hit);
      if (res.ok) {
        linked = hit.orderNumber;
        linkDetail = "linked";
      } else {
        linkDetail = `link_fail:${res.error}`;
      }
    }
    return {
      verdict: "MATCH_UNLINKED_STX",
      detail: `${hit.account} ${hit.orderNumber} ${hit.styleId ?? "?"} ${hit.sizeEU ?? "?"} ${linkDetail}`,
      gmailHits,
      stxCandidates,
      linkedStockxOrderNumber: linked,
      peerSameSkuSize: peers,
    };
  }

  if (stxCandidates.length > 1) {
    return {
      verdict: "SKIP_REASON",
      detail: `ambiguous unlinked STX x${stxCandidates.length}: ${stxCandidates.map((c) => c.orderNumber).join(",")}`,
      gmailHits,
      stxCandidates,
      peerSameSkuSize: peers,
    };
  }

  if (gmailHits.length > 0) {
    const goat = gmailHits.find((h) => h.provider === "GOAT");
    const first = goat ?? gmailHits[0]!;
    return {
      verdict: "ALREADY_BOUGHT_GMAIL",
      detail: `${first.provider} mail: ${first.subject} (${first.date.slice(0, 10)}) tokens=${first.matchedTokens.join(",")}${
        goat ? " — GOAT manual link / skip buy" : " — investigate before buy"
      }`,
      gmailHits,
      stxCandidates,
      peerSameSkuSize: peers,
    };
  }

  const peerNote =
    peers.length > 0
      ? ` peerSameSkuSize=${peers.map((p) => `${p.orderName}=${p.stockxOrderNumber}`).join(";")}`
      : "";

  return {
    verdict: "BUY_OK",
    detail: `no gmail purchase hit, no unlinked STX product+size match${peerNote}`,
    gmailHits,
    stxCandidates,
    peerSameSkuSize: peers,
  };
}

/** True when auto-checkout must not place a new StockX order. */
export function prebuyBlocksNewPurchase(result: PrebuyDedupeResult): boolean {
  return (
    result.verdict === "ALREADY_MATCHED" ||
    result.verdict === "ALREADY_BOUGHT_GMAIL" ||
    result.verdict === "MATCH_UNLINKED_STX" ||
    result.verdict === "SKIP_REASON"
  );
}
