import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type BrowserContext, type Page } from "playwright";
import { prisma } from "@/app/lib/prisma";
import {
  nextStockxPlaywrightProxy,
  stockxBrowserProxyMode,
  type PlaywrightProxyConfig,
} from "@/lib/stockxPlaywrightProxy";
import { stockxAccountFiles } from "@/lib/stockxSessionRefresh";
import {
  attachStockxBandwidthGuard,
  type BandwidthTracker,
} from "@/lib/stockxBandwidthGuard";
import {
  chooseLane,
  chooseLaneByCsAtMargin,
  chooseLaneByGalaxusExpressFirst,
  classifyEmptyLaneReason,
  classifyLaneLabel,
  countDistinctShippingTierInText,
  extractCheckoutSubtotalChf,
  GALAXUS_CSAT_MIN_MARGIN,
  isExpressFamily,
  LANE_MIN_ALL_IN_CHF,
  laneMatchesSubtotal,
  laneMarginPct,
  marginOk,
  moneyToNumber,
  parseLaneCardsFromText,
  parseSingleXpressItemPriceChf,
} from "@/lib/stockxAutoCheckout/chooseLane";
import {
  detectShopifyExpress,
  desiredStockxLaneFromShopify,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import {
  apparelLetterSize,
  buildStockxBuyUrl,
  buildStockxCheckoutBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";
import { linkStockxBuyToShopify } from "@/lib/stockxAutoCheckout/linkAfterBuy";
import { linkStockxBuyToGalaxus } from "@/lib/stockxAutoCheckout/linkAfterBuyGalaxus";
import type { GalaxusBuyCandidate } from "@/lib/stockxAutoCheckout/galaxusBuyCandidates";
import { recoverStockxOrderNumberFromBuyingListText } from "@/lib/stockxAutoCheckout/recoverOrderNumberFromBuyingList";
import {
  findUnlinkedStockxMatches,
  prebuyBlocksNewPurchase,
  runPrebuyDedupeCheck,
  sizeFromSku,
} from "@/lib/stockxAutoCheckout/prebuyDedupe";
import {
  MAX_ALL_IN_CHF,
  type StockxDesiredLane,
  type StockxLaneCard,
  type StockxLaneLabel,
  type StockxNeedsHumanPayload,
  type StockxNeedsHumanReason,
} from "@/lib/stockxAutoCheckout/types";

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "stockx-checkout-state.json");

export type StockxCheckoutPreview = {
  previewId: string;
  createdAt: string;
  orderName: string;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
  sizeEU: string;
  sizeUS: string | null;
  saleChf: number | null;
  slug: string;
  productUrl: string;
  buyUrl: string | null;
  desiredLane: StockxDesiredLane;
  shopifyExpress: boolean;
  lane: StockxLaneLabel;
  lanes: StockxLaneCard[];
  itemChf: number | null;
  feesChf: number | null;
  shippingChf: number | null;
  totalChf: number | null;
  eta: string | null;
  payButton: string | null;
  withinCap: boolean;
  marginOk: boolean;
  maxAllInChf: number;
  screenshotRel: string;
  screenshotDataUrl: string | null;
  snippet: string;
};

export type StockxLastAutoBatch = {
  at: string;
  dryRun: boolean;
  scannedOrders: number;
  attempted: number;
  bought: number;
  emailed: number;
  skipped: number;
  emailSent: boolean;
  boughtItems: Array<{
    orderName: string;
    lineItemId: string | null;
    stockxOrderNumber?: string | null;
    totalChf?: number | null;
    detail?: string | null;
  }>;
  emailedItems: Array<{
    orderName: string;
    lineItemId: string | null;
    reason: string;
    reasonFr: string;
    title: string;
    sizeEU?: string | null;
    saleChf: number | null;
    desiredLane: string;
  }>;
};

type StoredState = {
  preview: StockxCheckoutPreview | null;
  lastConfirm: {
    at: string;
    orderName: string;
    totalChf: number | null;
    stockxOrderNumber: string | null;
    ok: boolean;
    error: string | null;
  } | null;
  lastAutoBatch?: StockxLastAutoBatch | null;
};

function extractChfAmounts(text: string): number[] {
  const out: number[] = [];
  for (const match of text.matchAll(/(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/gi)) {
    const n = moneyToNumber(match[1]);
    if (n != null) out.push(n);
  }
  return out;
}

async function readState(): Promise<StoredState> {
  try {
    const raw = await fs.readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as StoredState;
    return {
      preview: parsed.preview ?? null,
      lastConfirm: parsed.lastConfirm ?? null,
      lastAutoBatch: parsed.lastAutoBatch ?? null,
    };
  } catch {
    return { preview: null, lastConfirm: null, lastAutoBatch: null };
  }
}

export async function saveStockxLastAutoBatch(batch: StockxLastAutoBatch): Promise<void> {
  const state = await readState();
  state.lastAutoBatch = batch;
  await writeState(state);
}

async function captureAutoScreenshot(page: Page, tag: string): Promise<string | null> {
  const safe = tag.replace(/[^a-zA-Z0-9._-]+/g, "_").slice(0, 80);
  const rel = `stockx-auto-${safe}-${Date.now().toString(36)}.png`;
  const abs = path.join(DATA_DIR, rel);
  try {
    await fs.mkdir(DATA_DIR, { recursive: true });
    await page.screenshot({ path: abs, fullPage: true });
    return rel;
  } catch {
    return null;
  }
}

async function writeState(state: StoredState): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(STATE_FILE, JSON.stringify(state, null, 2));
}

async function dismissNoise(page: Page) {
  for (const name of [/Close Location Selector/i, /J.accepte/i, /Accept All/i, /Tout accepter/i, /Got it/i]) {
    const btn = page.getByRole("button", { name }).first();
    if (await btn.isVisible({ timeout: 700 }).catch(() => false)) {
      await btn.click().catch(() => undefined);
      await page.waitForTimeout(250);
    }
  }
}

async function selectSizeEuOrUs(
  page: Page,
  sizeEU: string,
  sizeUS: string | null
): Promise<{ ok: boolean; used: "EU" | "US" | null }> {
  const size = sizeEU.replace(/^EU\s*/i, "").trim();
  // Apparel letter sizes (S/M/L…) — StockX shows "S" / "US S", not EU footwear tabs.
  // Prefer letter click before EU numeric path (convertEuToUs already passthroughs these).
  const letter =
    sizeUS && /^(XX?S|S|M|L|XX?L|XXXL|[2-4]XL)$/i.test(sizeUS)
      ? sizeUS.toUpperCase()
      : /^(XX?S|S|M|L|XX?L|XXXL|[2-4]XL)$/i.test(size)
        ? size.toUpperCase()
        : null;
  if (letter) {
    // Deep-link ?size=S / buy page already sized → Buy Now without picker.
    // Reject size=Tout / empty — that is NOT selected (false-OK caused apparel size_us_map).
    const urlSized = (u: string) =>
      new RegExp(`[?&]size=${letter}\\b`, "i").test(u) && !/[?&]size=Tout\b/i.test(u);
    const sizeAlreadyLocked = async () => {
      const body = await page.locator("body").innerText().catch(() => "");
      // FR/EN "Taille : S" / "Size: M" — not "Taille : Tout" / "All".
      return new RegExp(
        String.raw`(?:Taille|Size)\s*[:：]?\s*(?:US\s*)?${letter}\b`,
        "i"
      ).test(body) && !/(?:Taille|Size)\s*[:：]?\s*(?:Tout|All)\b/i.test(body);
    };
    const buyReady = page.getByRole("button", { name: /Acheter maintenant|Buy Now|Buy$/i }).first();
    if (urlSized(page.url()) && (await buyReady.isVisible({ timeout: 2500 }).catch(() => false))) {
      return { ok: true, used: "US" };
    }
    if ((await sizeAlreadyLocked()) && (await buyReady.isVisible({ timeout: 1500 }).catch(() => false))) {
      return { ok: true, used: "US" };
    }

    const letterRe = new RegExp(
      `^(US\\s*)?${letter.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      // Wait for size UI / Buy Now to finish shimmer-loading (apparel PDP often laggy).
      await page
        .waitForFunction(
          `() => {
            const t = (document.body && document.body.innerText) || "";
            return /\\b(Taille|Size)\\b/i.test(t) || /Acheter maintenant|Buy Now/i.test(t);
          }`,
          { timeout: 12_000 }
        )
        .catch(() => undefined);
      await page
        .getByRole("button", { name: /Taille|Size/i })
        .first()
        .click({ timeout: 8000 })
        .catch(() => undefined);
      await page.waitForTimeout(900);
      const usTab = page.getByRole("button", { name: /^US$/ }).first();
      if (await usTab.isVisible({ timeout: 1000 }).catch(() => false)) {
        await usTab.click();
        await page.waitForTimeout(400);
      }
      // Buttons, role=option, and plain clickable tiles (StockX apparel grid).
      const candidates = [
        page.getByRole("button", { name: letterRe }),
        page.getByRole("option", { name: letterRe }),
        page.locator("button,div[role=button],div[role=option],label,li").filter({ hasText: letterRe }),
      ];
      for (const loc of candidates) {
        const el = loc.first();
        if (await el.isVisible({ timeout: 1200 }).catch(() => false)) {
          await el.click().catch(() => undefined);
          await page.waitForTimeout(500);
          if (urlSized(page.url()) || (await sizeAlreadyLocked())) {
            return { ok: true, used: "US" };
          }
        }
      }
      // DOM evaluate fallback — find exact letter tile even if not a <button>.
      const clicked = await page
        .evaluate(
          `({ letter }) => {
            const re = new RegExp("^(US\\\\s*)?" + letter + "$", "i");
            const nodes = Array.from(
              document.querySelectorAll("button,div[role=button],div[role=option],label,li,a,span")
            );
            for (const n of nodes) {
              const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
              if (!re.test(t)) continue;
              n.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
              return true;
            }
            return false;
          }`,
          { letter }
        )
        .catch(() => false);
      if (clicked) {
        await page.waitForTimeout(600);
        if (urlSized(page.url()) || (await sizeAlreadyLocked())) {
          return { ok: true, used: "US" };
        }
      }
      // Deep-link nudge then retry.
      try {
        const u = new URL(page.url());
        u.searchParams.set("size", letter);
        if (!urlSized(page.url())) {
          await page.goto(u.toString(), { waitUntil: "domcontentloaded", timeout: 20_000 }).catch(() => undefined);
          await page.waitForTimeout(1000);
        }
      } catch {
        /* ignore */
      }
    }
    // Only accept Buy Now if size is actually locked — never on "Tout".
    if (
      (urlSized(page.url()) || (await sizeAlreadyLocked())) &&
      (await buyReady.isVisible({ timeout: 1500 }).catch(() => false))
    ) {
      return { ok: true, used: "US" };
    }
    // Fall through — may still be numeric EU on rare listings.
  }
  // One-size / OS accessories — no size picker; Buy Now already sized.
  if (/^(os|one\s*size|o\/s|onesize|-)$/i.test(size)) {
    const buy = page.getByRole("button", { name: /Acheter maintenant|Buy Now|Buy$/i }).first();
    if (await buy.isVisible({ timeout: 4000 }).catch(() => false)) {
      return { ok: true, used: null };
    }
    // No Taille/Size control → treat as OS (Buy Now may still be below fold).
    const sizeCtl = page.getByRole("button", { name: /Taille|Size/i }).first();
    const hasSize = await sizeCtl.isVisible({ timeout: 1200 }).catch(() => false);
    if (!hasSize) {
      const buyInDom = await page.evaluate(() => {
        const nodes = Array.from(document.querySelectorAll("button,a,[role=button]"));
        return nodes.some((n) =>
          /acheter maintenant|buy now/i.test((n.textContent || "").replace(/\s+/g, " "))
        );
      });
      if (buyInDom) return { ok: true, used: null };
    }
  }
  await page.getByRole("button", { name: /Taille|Size/i }).first().click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(700);

  const euTab = page.getByRole("button", { name: /^EU$/ }).first();
  const hasEuTab = await euTab.isVisible({ timeout: 1000 }).catch(() => false);
  if (hasEuTab) {
    await euTab.click();
    await page.waitForTimeout(400);
    const re = new RegExp(`^EU\\s*${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\s*2\\/3)`);
    const exact = page.locator("button").filter({ hasText: re }).first();
    if (await exact.count()) {
      await exact.click();
      return { ok: true, used: "EU" };
    }
    // loose EU click
    const loose = page
      .locator("button")
      .filter({ hasText: new RegExp(`EU\\s*${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i") })
      .first();
    if (await loose.isVisible({ timeout: 800 }).catch(() => false)) {
      await loose.click();
      return { ok: true, used: "EU" };
    }
  }

  if (!sizeUS) return { ok: false, used: null };

  const usTab = page.getByRole("button", { name: /^US$/ }).first();
  if (await usTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await usTab.click();
    await page.waitForTimeout(400);
  }
  // Women's deep-link uses "8W" but picker often shows plain "8" / "US 8".
  const usVariants = Array.from(
    new Set(
      [
        sizeUS,
        sizeUS.replace(/W$/i, ""),
        /^\d+(\.\d+)?$/.test(sizeUS) ? `${sizeUS}W` : null,
      ].filter((v): v is string => Boolean(v && String(v).trim()))
    )
  );
  for (const variant of usVariants) {
    const usRe = new RegExp(
      `^(US\\s*)?${variant.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );
    const usBtn = page.locator("button").filter({ hasText: usRe }).first();
    if (await usBtn.count()) {
      await usBtn.click();
      return { ok: true, used: "US" };
    }
  }
  return { ok: false, used: null };
}

async function clickBuyNow(page: Page) {
  const candidates = [
    page.getByRole("button", { name: /Acheter maintenant/i }),
    page.getByRole("link", { name: /Acheter maintenant/i }),
    page.getByRole("button", { name: /Buy Now/i }),
    page.getByRole("link", { name: /Buy Now/i }),
    page.locator("button,a,[role=button]").filter({ hasText: /Acheter maintenant|Buy Now/i }),
    page.locator('[data-testid*="buy" i]'),
  ];
  for (const loc of candidates) {
    const el = loc.last();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      const disabled = await el.isDisabled().catch(() => false);
      if (!disabled) {
        await el.click();
        return true;
      }
    }
  }
  const clicked = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll("button,a,[role=button]"));
    const hit = nodes.find((n) =>
      /acheter maintenant|buy now/i.test((n.textContent || "").replace(/\s+/g, " "))
    );
    if (!hit) return false;
    (hit as HTMLElement).click();
    return true;
  });
  return !!clicked;
}

async function clickReviewOrder(page: Page): Promise<boolean> {
  const byTestId = page.locator('[data-testid="checkout-confirm-button"]').first();
  if (await byTestId.isVisible({ timeout: 6000 }).catch(() => false)) {
    await byTestId.scrollIntoViewIfNeeded().catch(() => undefined);
    await byTestId.click({ force: true });
    return true;
  }
  const byRole = page
    .getByRole("button", { name: /Vérifier la commande|Confirm and continue|Review Order/i })
    .first();
  if (await byRole.isVisible({ timeout: 2000 }).catch(() => false)) {
    await byRole.click({ force: true });
    return true;
  }
  return page.evaluate(() => {
    const el =
      document.querySelector('[data-testid="checkout-confirm-button"]') ||
      Array.from(document.querySelectorAll("button")).find((b) =>
        /vérifier la commande|confirm and continue|review order/i.test(
          (b.textContent || "").replace(/\s+/g, " ")
        )
      );
    if (!el) return false;
    (el as HTMLElement).click();
    return true;
  });
}

async function parseLanesFromPage(page: Page): Promise<StockxLaneCard[]> {
  const fromDom = await page.evaluate(() => {
    const nodes = Array.from(
      document.querySelectorAll("button,label,div[role=button],div[role=radio],div[role=option]")
    );
    const out: Array<{ rawLabel: string; totalChf: number; eta: string | null }> = [];
    for (const node of nodes) {
      const text = (node.textContent || "").replace(/\s+/g, " ").trim();
      if (!/\b(Standard|Express|Xpress|Fastest|Expedited)\b/i.test(text)) continue;
      if (!/\d/.test(text) || !/CHF/i.test(text)) continue;
      const labelMatch = text.match(/\b(Standard|Express|Xpress|Fastest|Expedited)\b/i);
      const priceMatch =
        text.match(/CHF\s*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)/i) ||
        text.match(/(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
      if (!labelMatch || !priceMatch) continue;
      const cleaned = priceMatch[1].replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
      const totalChf = Number(cleaned);
      if (!Number.isFinite(totalChf) || totalChf < LANE_MIN_ALL_IN_CHF) continue;
      const etaMatch = text.match(/(?:d['’]ici le|by|ETA)\s*([^·|]{3,40})/i);
      out.push({
        rawLabel: labelMatch[1],
        totalChf,
        eta: etaMatch?.[1]?.trim() || null,
      });
    }
    return out;
  });

  const body = await page.locator("body").innerText().catch(() => "");
  const fromText = parseLaneCardsFromText(body);

  const seen = new Set<string>();
  const merged: StockxLaneCard[] = [];
  for (const row of fromDom) {
    const label = classifyLaneLabel(row.rawLabel);
    if (label === "UNKNOWN") continue;
    const key = `${label}:${row.totalChf.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push({
      label,
      rawLabel: row.rawLabel,
      totalChf: row.totalChf,
      eta: row.eta,
    });
  }
  for (const lane of fromText) {
    const key = `${lane.label}:${lane.totalChf.toFixed(2)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(lane);
  }
  return merged;
}

/**
 * Click a shipping card so Sous-total sticks to `lane.totalChf`.
 * StockX FR date-only cards often have NO "Standard/Xpress" label and may not use
 * native radios — rank compact date+CHF cards by price and click that card.
 * Returns true only when live subtotal matches the target (verified).
 */
async function clickLaneCard(page: Page, lane: StockxLaneCard): Promise<boolean> {
  const targetPrice = lane.totalChf;
  const wantStandard = lane.label === "STANDARD";

  const verified = async (): Promise<boolean> => {
    await page.waitForTimeout(900);
    const after = await page.locator("body").innerText().catch(() => "");
    const sub = extractCheckoutSubtotalChf(after);
    return sub != null && Math.abs(sub - targetPrice) <= 0.51;
  };

  // Primary: rank compact shipping cards by CHF, click the one matching target price.
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const result = await page
      .evaluate(
        `({ price, wantStd }) => {
          const parsePrice = (t) => {
            const m =
              t.match(/CHF\\s*(\\d{1,3}(?:[’'\\s]\\d{3})*(?:[.,]\\d{2})?)/i) ||
              t.match(/(\\d{1,3}(?:[’'\\s]\\d{3})*(?:[.,]\\d{2})?)\\s*CHF/i);
            if (!m) return null;
            const n = Number((m[1] || m[2]).replace(/[^\\d,.-]/g, "").replace(/\\s/g, "").replace(",", "."));
            return Number.isFinite(n) ? n : null;
          };
          const dateRe = /\\d{1,2}\\s+[A-Za-zÀ-ÿ]{3,}/i;
          const nodes = Array.from(
            document.querySelectorAll(
              "label,li,button,div[role=radio],div[role=button],div[role=option],div"
            )
          );
          const found = [];
          for (const el of nodes) {
            const t = ((el.textContent || "") + "").replace(/\\s+/g, " ").trim();
            if (t.length < 8 || t.length > 220) continue;
            if (!/CHF/i.test(t) || !dateRe.test(t)) continue;
            const p = parsePrice(t);
            if (p == null || p < 40) continue;
            found.push({ el, p, len: t.length });
          }
          // Dedupe by price — keep shortest card (leaf).
          const byP = new Map();
          for (const row of found) {
            const k = row.p.toFixed(2);
            const prev = byP.get(k);
            if (!prev || row.len < prev.len) byP.set(k, row);
          }
          const sorted = Array.from(byP.values()).sort((a, b) => a.p - b.p);
          let target = sorted.find((s) => Math.abs(s.p - price) <= 0.51);
          if (!target && wantStd) target = sorted[0];
          if (!target && !wantStd && sorted.length >= 2) {
            target = sorted.length >= 3 ? sorted[1] : sorted[sorted.length - 1];
          }
          if (!target) return { ok: false, n: sorted.length, prices: sorted.map((s) => s.p) };
          target.el.scrollIntoView({ block: "center", inline: "nearest" });
          const input =
            (target.el.matches && target.el.matches("input[type=radio]") && target.el) ||
            target.el.querySelector("input[type=radio]");
          if (input) {
            input.click();
            input.checked = true;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
          }
          target.el.click();
          // Pointer events — some StockX cards only listen to these.
          for (const type of ["pointerdown", "mousedown", "mouseup", "click"]) {
            target.el.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
          }
          return { ok: true, n: sorted.length, price: target.p };
        }`,
        { price: targetPrice, wantStd: wantStandard }
      )
      .catch((e: any) => {
        console.warn(`[STOCKX-CHECKOUT] rank-click failed: ${e?.message || e}`);
        return { ok: false };
      });

    console.warn(
      `[STOCKX-CHECKOUT] lane click attempt ${attempt} target=${targetPrice} result=${JSON.stringify(result)}`
    );
    if ((result as { ok?: boolean })?.ok && (await verified())) return true;
    await page.waitForTimeout(400);
  }

  // Fallback: Playwright force-click on compact node containing the CHF amount.
  const priceRe = targetPrice.toFixed(2).replace(".", "[,.]");
  const byPrice = page
    .locator("label,li,button,div[role=radio],div[role=button]")
    .filter({ hasText: new RegExp(`${priceRe}\\s*CHF|CHF\\s*${priceRe}`) })
    .first();
  if (await byPrice.isVisible({ timeout: 1500 }).catch(() => false)) {
    await byPrice.scrollIntoViewIfNeeded().catch(() => undefined);
    await byPrice.click({ force: true }).catch(() => undefined);
    if (await verified()) return true;
  }
  return false;
}

/** Live subtotal matches an EXPRESS lane while we wanted STANDARD → click didn't stick. */
function liveSubtotalLooksLikeExpress(
  subtotalChf: number | null,
  lanes: StockxLaneCard[],
  desired: StockxDesiredLane | null
): boolean {
  if (desired !== "STANDARD" || subtotalChf == null) return false;
  return lanes.some(
    (l) =>
      (l.label === "EXPRESS" || l.label === "EXPEDITED") &&
      Math.abs(l.totalChf - subtotalChf) <= 0.51
  );
}

/**
 * Click lane + require checkout subtotal ≈ picked all-in (fail closed).
 * LIVE price only — never invent cost from confirm OCR.
 */
export async function selectAndVerifyStockxLane(
  page: Page,
  options:
    | { policy: "desired"; desired: StockxDesiredLane; maxAllInChf?: number }
    /** @deprecated Prefer galaxus_express_first (HARD RULE). */
    | { policy: "galaxus_csat"; sellChf: number; maxAllInChf?: number }
    | { policy: "galaxus_express_first"; maxAllInChf?: number }
): Promise<
  | { ok: true; lane: StockxLaneCard; lanes: StockxLaneCard[]; pickReason: string; subtotalChf: number }
  | { ok: false; reason: string; lanes: StockxLaneCard[]; detail?: string }
> {
  const maxAllInChf = options.maxAllInChf ?? MAX_ALL_IN_CHF;
  // Shipping cards paint late. Product/size chrome alone (~200 chars, gray panel) is NOT
  // ready — require CHF + lane/date/subtotal, or true OOS copy. Reload on skeleton shells.
  const waitShipBody = async (timeoutMs = 28_000) =>
    page
      .waitForFunction(
        `() => {
          const t = (document.body && document.body.innerText) || "";
          const hasChf = /(?:CHF\\s*\\d)|(?:\\d+[.,]\\d{2}\\s*CHF)/i.test(t);
          const noAsk = /aucune demande|no asks?|make an offer|faire une offre/i.test(t);
          if (noAsk && !hasChf) return true;
          if (!hasChf) return false;
          return (
            /\\b(Standard|Express|Xpress|Fastest|Expedited|Sous[- ]?total|Subtotal)\\b/i.test(t) ||
            /\\d{1,2}\\s+(jan|fév|fev|mar|avr|mai|juin|juil|aoû|aou|sep|oct|nov|déc|dec|janvier|février|mars|avril|juin|juillet|août|septembre|octobre|novembre|décembre)/i.test(t)
          );
        }`,
        { timeout: timeoutMs }
      )
      .then(() => true)
      .catch(() => false);

  let shipReady = await waitShipBody();
  for (let reload = 0; !shipReady && reload < 2; reload += 1) {
    console.warn(
      `[STOCKX-CHECKOUT] checkout shell incomplete (no CHF lanes) — reload ${reload + 1}/2`
    );
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30_000 }).catch(() => undefined);
    await page.waitForTimeout(2800);
    shipReady = await waitShipBody(22_000);
  }
  if (!shipReady) {
    await page.waitForTimeout(2500);
  }
  let body = await page.locator("body").innerText().catch(() => "");
  let lanes = await parseLanesFromPage(page);
  // Extra settle polls — SPA often injects cards after shell chrome.
  for (let i = 0; !lanes.length && i < 4; i += 1) {
    await page.waitForTimeout(2000);
    body = await page.locator("body").innerText().catch(() => "");
    lanes = await parseLanesFromPage(page);
    if (classifyEmptyLaneReason(body) === "oos_no_ask") break;
  }
  if (!lanes.length && classifyEmptyLaneReason(body) === "proxy_blank") {
    try {
      const fs = await import("node:fs/promises");
      const dump = `/app/.data/stockx-lane-dump-${Date.now().toString(36)}.txt`;
      await fs.writeFile(dump, body.slice(0, 8000), "utf8");
      console.warn(`[STOCKX-CHECKOUT] hydrate timeout — dumped ${dump} (${body.length} chars)`);
    } catch {
      console.warn(`[STOCKX-CHECKOUT] hydrate timeout — bodyChars=${body.length}`);
    }
    return {
      ok: false,
      reason: "proxy_blank",
      lanes: [],
      detail: `checkout hydrate timeout — shell/no CHF lanes after reloads (bodyChars=${body.length})`,
    };
  }
  if (!lanes.length) {
    try {
      const fs = await import("node:fs/promises");
      const dump = `/app/.data/stockx-lane-dump-${Date.now().toString(36)}.txt`;
      await fs.writeFile(dump, body.slice(0, 8000), "utf8");
      console.warn(`[STOCKX-CHECKOUT] empty lanes — dumped body ${dump} (${body.length} chars)`);
    } catch {
      console.warn(`[STOCKX-CHECKOUT] empty lanes — bodyChars=${body.length}`);
    }
  }
  const tiersInText = countDistinctShippingTierInText(body, maxAllInChf);

  let picked: StockxLaneCard | null = null;
  let pickReason = "";
  // Single-price Xpress direct-ship: no lane cards; live checkout subtotal is the
  // authoritative all-in (the synthesized lane holds only the item price).
  let singleXpressSynth = false;

  /** Single-ask Xpress checkout (Forte demande / no Standard-Express radios). */
  const trySynthSingleXpress = (): boolean => {
    if (lanes.length > 0) return false;
    if (classifyEmptyLaneReason(body) !== "express_only") return false;
    const itemPriceChf = parseSingleXpressItemPriceChf(body);
    const bodySubtotalChf = extractCheckoutSubtotalChf(body);
    const seedChf =
      itemPriceChf != null && itemPriceChf <= maxAllInChf
        ? itemPriceChf
        : bodySubtotalChf != null && bodySubtotalChf <= maxAllInChf
          ? bodySubtotalChf
          : null;
    if (seedChf == null) return false;
    const synth: StockxLaneCard = {
      label: "EXPRESS",
      rawLabel: "Xpress",
      totalChf: seedChf,
      eta: null,
    };
    lanes = [synth];
    picked = synth;
    singleXpressSynth = true;
    pickReason =
      itemPriceChf != null && itemPriceChf === seedChf
        ? `single-xpress:item=${seedChf}`
        : `single-xpress:subtotal=${seedChf}`;
    console.warn(
      `[STOCKX-CHECKOUT] single-price Xpress — synthesized EXPRESS lane ${seedChf} CHF (live subtotal still gates)`
    );
    return true;
  };

  if (options.policy === "galaxus_express_first") {
    const pick = chooseLaneByGalaxusExpressFirst(lanes, {
      maxAllInChf,
      shippingTierInText: tiersInText,
    });
    if (!pick.ok) {
      // Same UI as Shopify single-Xpress: no radio cards, only item+Sous-total.
      // Galaxus HARD RULE is EXPRESS-default → take it.
      if (!trySynthSingleXpress()) {
        return { ok: false, reason: pick.reason, lanes, detail: pick.detail };
      }
    } else {
      picked = pick.lane;
      pickReason = pick.reason;
    }
  } else if (options.policy === "galaxus_csat") {
    const pick = chooseLaneByCsAtMargin(options.sellChf, lanes, {
      maxAllInChf,
      shippingTierInText: tiersInText,
    });
    if (!pick.ok) {
      return { ok: false, reason: pick.reason, lanes, detail: pick.detail };
    }
    picked = pick.lane;
    pickReason = pick.reason;
  } else {
    const pick = chooseLane(options.desired, lanes, maxAllInChf);
    if (!pick.ok) {
      // Lanes parsed empty → distinguish TRUE oos ("aucune demande") from a
      // parser miss where the item is still buyable (Express-only / single price).
      if (pick.reason === "oos" && lanes.length === 0) {
        const refined = classifyEmptyLaneReason(body);
        // SINGLE-PRICE XPRESS direct-ship: no Standard/Express cards, only an item
        // price + "livraison Xpress". Xpress is the ONLY ship option, so synthesize ONE
        // EXPRESS lane regardless of the customer's desired lane (never refuse express
        // when it's the only option; STANDARD orders get a free speed upgrade) and
        // proceed through the normal verify + margin + cap + Place Order path.
        if (refined === "express_only") {
          // Prefer item price; fall back to visible Sous-total when item is missing/
          // under-parsed (e.g. "de 43 CHF" + low ask). Live subtotal still re-gates.
          const itemPriceChf = parseSingleXpressItemPriceChf(body);
          const bodySubtotalChf = extractCheckoutSubtotalChf(body);
          const seedChf =
            itemPriceChf != null && itemPriceChf <= maxAllInChf
              ? itemPriceChf
              : bodySubtotalChf != null && bodySubtotalChf <= maxAllInChf
                ? bodySubtotalChf
                : null;
          if (seedChf != null) {
            const synth: StockxLaneCard = {
              label: "EXPRESS",
              rawLabel: "Xpress",
              totalChf: seedChf,
              eta: null,
            };
            lanes = [synth];
            picked = synth;
            singleXpressSynth = true;
            pickReason =
              itemPriceChf != null && itemPriceChf === seedChf
                ? `single-xpress:item=${seedChf}`
                : `single-xpress:subtotal=${seedChf}`;
            console.warn(
              `[STOCKX-CHECKOUT] single-price Xpress — synthesized EXPRESS lane ${seedChf} CHF (live subtotal still gates)`
            );
          }
        }
        if (!picked) {
          return {
            ok: false,
            reason: refined,
            lanes,
            detail:
              refined === "oos_no_ask"
                ? "page: aucune demande / no ask — true OOS"
                : refined === "express_only"
                  ? "page shows buyable price/Xpress but STANDARD not parsed"
                  : refined === "proxy_blank"
                    ? `checkout hydrate incomplete — not hard OOS (bodyChars=${body.length})`
                    : `empty lanes, unknown body (bodyChars=${body.length})`,
          };
        }
      } else {
        return { ok: false, reason: pick.reason, lanes };
      }
    }
    // pick.ok OR synthesized single-xpress lane
    if (!picked && pick.ok) {
      picked = pick.lane;
      pickReason = `desired:${options.desired}`;
    }
  }

  if (!picked) {
    return { ok: false, reason: "oos", lanes };
  }

  // Guard "express subtotal while we wanted standard" only when we actually PICKED a
  // standard lane. A deliberate STANDARD→faster upgrade (chooseLane) legitimately shows
  // an express subtotal, so base the check on the picked lane, not the original desire.
  const desiredForVerify: StockxDesiredLane | null =
    picked.label === "STANDARD" ? "STANDARD" : null;

  let clicked = false;
  let verifiedSubtotal: number | null = null;

  // Single-price Xpress: no lane radios to click — skip click thrash (OOM risk) and
  // take live Sous-total as all-in below.
  if (!singleXpressSynth) {
    // Retry click — StockX often keeps Express selected after a soft wrapper click.
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      clicked = (await clickLaneCard(page, picked)) || clicked;
      await page.waitForTimeout(attempt === 1 ? 1100 : 1500);
      const after = await page.locator("body").innerText().catch(() => "");
      verifiedSubtotal = extractCheckoutSubtotalChf(after);

      if (liveSubtotalLooksLikeExpress(verifiedSubtotal, lanes, desiredForVerify)) {
        // Fail-closed signal: keep retrying click; do NOT accept Express as STANDARD.
        console.warn(
          `[STOCKX-CHECKOUT] lane click attempt ${attempt}: still Express subtotal=${verifiedSubtotal} want=${picked.totalChf}`
        );
        continue;
      }
      if (verifiedSubtotal != null && laneMatchesSubtotal(picked, verifiedSubtotal)) {
        break;
      }
      // Subtotal 0,00 / missing — wait once more for SPA settle before next click.
      if (verifiedSubtotal == null || verifiedSubtotal < 1) {
        await page.waitForTimeout(900);
        const after2 = await page.locator("body").innerText().catch(() => "");
        verifiedSubtotal = extractCheckoutSubtotalChf(after2);
        if (verifiedSubtotal != null && laneMatchesSubtotal(picked, verifiedSubtotal)) break;
        if (liveSubtotalLooksLikeExpress(verifiedSubtotal, lanes, desiredForVerify)) continue;
      }
    }

    // Still Express while desired STANDARD → hard fail (never Place Order on Express).
    if (liveSubtotalLooksLikeExpress(verifiedSubtotal, lanes, desiredForVerify)) {
      return {
        ok: false,
        reason: "price_moved",
        lanes,
        detail: `STANDARD click did not stick — live subtotal still Express ${verifiedSubtotal} (want ${picked.totalChf}) clicked=${clicked} (${pickReason})`,
      };
    }
  }

  // Single-price Xpress: there are no lane cards to click; the live checkout subtotal
  // is the real all-in (item price + fees/ship). Accept it as the verified total and
  // enforce the cap here; margin is gated downstream on this live subtotal. Fail closed
  // (no item-price fallback) when no live subtotal appears.
  if (singleXpressSynth) {
    // Beat the render race: on high Cloudflare pressure the Xpress subtotal lands as
    // "Loading…" / 0,00 before finalizing. Poll a few more seconds for a real total
    // before fail-closing, so a slow page isn't mistaken for an unbuyable one.
    if (verifiedSubtotal == null || verifiedSubtotal < LANE_MIN_ALL_IN_CHF) {
      for (
        let i = 0;
        i < 6 && (verifiedSubtotal == null || verifiedSubtotal < LANE_MIN_ALL_IN_CHF);
        i += 1
      ) {
        await page.waitForTimeout(1500);
        const t = await page.locator("body").innerText().catch(() => "");
        verifiedSubtotal = extractCheckoutSubtotalChf(t);
      }
    }
    if (verifiedSubtotal == null || verifiedSubtotal < LANE_MIN_ALL_IN_CHF) {
      return {
        ok: false,
        reason: "express_unparsed",
        lanes,
        detail: `single-xpress: no live subtotal (item=${picked.totalChf}) clicked=${clicked}`,
      };
    }
    if (verifiedSubtotal > maxAllInChf) {
      return {
        ok: false,
        reason: "cap",
        lanes,
        detail: `single-xpress all-in ${verifiedSubtotal} > cap ${maxAllInChf} (item=${picked.totalChf})`,
      };
    }
    const lane: StockxLaneCard = { ...picked, totalChf: verifiedSubtotal };
    return { ok: true, lane, lanes: [lane], pickReason, subtotalChf: verifiedSubtotal };
  }

  // fr-CH Sous-total 0,00 until "Vérifier": never invent match from card price when
  // Express is also on page (desired STANDARD) — that masked stuck-Express buys.
  if (verifiedSubtotal == null || verifiedSubtotal < 1) {
    if (desiredForVerify === "STANDARD" && lanes.some((l) => l.label === "EXPRESS")) {
      return {
        ok: false,
        reason: "price_moved",
        lanes,
        detail: `no live subtotal after STANDARD click — refuse card-price fallback (Express also on page) pick=${picked.totalChf} clicked=${clicked} (${pickReason})`,
      };
    }
    verifiedSubtotal = picked.totalChf;
  }

  if (!laneMatchesSubtotal(picked, verifiedSubtotal)) {
    // Xpress upgrade click often fails to stick on date-only FR radios (subtotal stays
    // Standard). If customer desired STANDARD and live subtotal matches the Standard
    // lane, accept Standard — still a correct buy (never slower than paid lane).
    if (
      options.policy === "desired" &&
      options.desired === "STANDARD" &&
      verifiedSubtotal != null &&
      isExpressFamily(picked.label)
    ) {
      const stdLane = lanes.find(
        (l) => l.label === "STANDARD" && laneMatchesSubtotal(l, verifiedSubtotal)
      );
      if (stdLane) {
        console.warn(
          `[STOCKX-CHECKOUT] Xpress upgrade click failed (pick=${picked.totalChf} sub=${verifiedSubtotal}) — fallback Standard ${stdLane.totalChf}`
        );
        return {
          ok: true,
          lane: stdLane,
          lanes,
          pickReason: `${pickReason}+fallback_std`,
          subtotalChf: verifiedSubtotal,
        };
      }
    }
    return {
      ok: false,
      reason: clicked ? "price_moved" : "express_unparsed",
      lanes,
      detail: `lane not verified pick=${picked.totalChf} subtotal=${verifiedSubtotal} clicked=${clicked} (${pickReason})`,
    };
  }

  return { ok: true, lane: picked, lanes, pickReason, subtotalChf: verifiedSubtotal };
}

async function resolveSlugFromSku(sku: string): Promise<string | null> {
  const styleId = sku.split("-")[0]?.trim() || sku.trim();
  if (!styleId) return null;
  const product = await prisma.kickDBProduct.findFirst({
    where: {
      OR: [{ styleId: { equals: styleId, mode: "insensitive" } }, { styleId: { equals: sku, mode: "insensitive" } }],
      urlKey: { not: null },
    },
    select: { urlKey: true },
    orderBy: { updatedAt: "desc" },
  });
  return product?.urlKey?.trim() || null;
}

export type ShopifyLineCtx = {
  shopifyOrderId: string | null;
  orderName: string;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
  gtin: string | null;
  sizeEU: string;
  saleChf: number | null;
  createdAt: string | null;
  customerEmail: string | null;
  deliveryMode: string | null;
  deliveryModeLabel: string | null;
  shippingLineTitles: string[];
  isStorePickup: boolean;
  physicalStockQty: number | null;
};

export async function loadShopifyLine(
  orderName: string,
  lineItemId?: string | null
): Promise<ShopifyLineCtx> {
  const name = orderName.startsWith("#") ? orderName : `#${orderName}`;
  const { POST } = await import("@/app/api/shopify/order-by-name/route");
  const res = await POST(
    new Request("http://local/api/shopify/order-by-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderName: name }),
    }) as any
  );
  const json: any = await res.json();
  const lines: any[] = Array.isArray(json?.lineItems) ? json.lineItems : [];
  if (!lines.length) throw new Error(`Shopify order ${name} not found or empty`);

  let line = lines[0];
  if (lineItemId) {
    const hit = lines.find((l) => String(l.lineItemId) === String(lineItemId));
    if (hit) line = hit;
  }

  const shippingLineTitles = Array.isArray(line.shippingLineTitles)
    ? line.shippingLineTitles.map((t: unknown) => String(t || "")).filter(Boolean)
    : [];

  return {
    shopifyOrderId: String(line.shopifyOrderId || line.orderId || "") || null,
    orderName: String(line.orderName || name),
    shopifyLineItemId: String(line.lineItemId || "") || null,
    title: String(line.title || ""),
    sku: String(line.sku || "").trim(),
    gtin: String(line.gtin || line.barcode || "").trim() || null,
    sizeEU: String(line.sizeEU || line.variantTitle || "").replace(/^EU\s*/i, "EU ").trim() || "EU ?",
    saleChf: moneyToNumber(String(line.totalPrice ?? line.price ?? "")),
    createdAt: line.createdAt ? String(line.createdAt) : null,
    customerEmail: line.customerEmail ? String(line.customerEmail) : null,
    deliveryMode: line.deliveryMode ?? null,
    deliveryModeLabel: line.deliveryModeLabel ?? null,
    shippingLineTitles,
    isStorePickup: Boolean(line.isStorePickup),
    physicalStockQty:
      line.physicalStockQty != null && Number.isFinite(Number(line.physicalStockQty))
        ? Number(line.physicalStockQty)
        : null,
  };
}

export async function launchStockxContext(options?: {
  /** Prefer LemonPrime sticky (Shopify buy path should pass this). */
  proxy?: PlaywrightProxyConfig | null;
  /** When true (default if STOCKX_BROWSER_PROXY_MODE=always), pick next sticky. */
  useStickyProxy?: boolean;
  /**
   * Chromium profile + token set. Shopify paths omit → `"default"` (`stockx-profile`).
   * Galaxus buy MUST pass `"galaxus"` (`stockx-profile-galaxus`).
   */
  account?: "default" | "galaxus";
}): Promise<{
  ctx: BrowserContext;
  page: Page;
  proxy: PlaywrightProxyConfig | null;
  bandwidth: BandwidthTracker;
}> {
  const account = options?.account === "galaxus" ? "galaxus" : "default";
  const files = stockxAccountFiles(account);
  // VPS Xvfb / VNC: without DISPLAY Chromium dies. Default :99 like stockx login.
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(files.profileDir, lockName), { force: true }).catch(() => undefined);
    await fs.rm(path.join(files.profileDir, "Default", lockName), { force: true }).catch(() => undefined);
  }

  const wantSticky =
    options?.useStickyProxy === true ||
    (options?.useStickyProxy !== false && stockxBrowserProxyMode() === "always");
  const proxy =
    options?.proxy !== undefined
      ? options.proxy
      : wantSticky
        ? nextStockxPlaywrightProxy()
        : null;
  console.log(
    `[STOCKX-CHECKOUT] account=${account} profile=${files.profileDir}` +
      (proxy ? ` sticky proxy=${proxy.label}` : "")
  );

  try {
    const ctx = await chromium.launchPersistentContext(files.profileDir, {
      headless: false,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
      ],
      locale: "fr-CH",
      timezoneId: "Europe/Zurich",
      viewport: { width: 1440, height: 1100 },
      ...(proxy
        ? {
            proxy: {
              server: proxy.server,
              username: proxy.username,
              password: proxy.password,
            },
          }
        : {}),
    });
    // Block image/media/font + trackers, meter bytes, hard-cap runaway CF loops.
    const bandwidth = attachStockxBandwidthGuard(ctx, {
      proxyLabel: proxy?.label ?? null,
      context: "stockx-checkout",
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    return { ctx, page, proxy, bandwidth };
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(
      `StockX browser launch failed (DISPLAY=${process.env.DISPLAY}, profile=${files.profileDir}): ${msg}. ` +
        "On VPS ensure Xvfb/VNC on :99 and no stuck Chromium holding the profile lock."
    );
  }
}

function parseCheckoutTotals(text: string) {
  const subtotal = extractCheckoutSubtotalChf(text);
  const amounts = extractChfAmounts(text);
  const totalMatch =
    text.match(/Total(?:\s*Price)?\s+CHF\s*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)/i) ||
    text.match(/Total(?:\s*Price)?\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i) ||
    text.match(/Total\s*à\s*payer\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const totalChf =
    moneyToNumber(totalMatch?.[1] ?? null) ?? subtotal ?? amounts[amounts.length - 1] ?? null;
  const itemMatch = text.match(/Prix d['’]achat\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const feeMatch = text.match(/Traitement[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const shipMatch = text.match(/Livraison[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const etaMatch =
    text.match(/Recevez votre commande d['’]ici le\s*([^\n]+)/i) ||
    text.match(/Arriv(?:e|es|al)[^\n]{0,20}?([^\n]{3,40})/i);
  return {
    totalChf,
    itemChf: moneyToNumber(itemMatch?.[1] ?? null),
    feesChf: moneyToNumber(feeMatch?.[1] ?? null),
    shippingChf: moneyToNumber(shipMatch?.[1] ?? null),
    eta: etaMatch?.[1]?.trim() || null,
  };
}

export async function getStockxCheckoutState() {
  return readState();
}

/**
 * Opens the Shopify StockX profile, selects size, picks desired lane (from Shopify Express),
 * stops on "Passer commande" without clicking it.
 */
export async function previewStockxCheckout(options: {
  orderName: string;
  slug?: string | null;
  lineItemId?: string | null;
  maxAllInChf?: number;
  /** Force lane; default from Shopify Express detection. */
  desiredLane?: StockxDesiredLane | null;
}): Promise<StockxCheckoutPreview> {
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  const shopify = await loadShopifyLine(options.orderName, options.lineItemId);
  const shopifyExpress = detectShopifyExpress({
    deliveryMode: shopify.deliveryMode,
    deliveryModeLabel: shopify.deliveryModeLabel,
    shippingLineTitles: shopify.shippingLineTitles,
  });
  const desiredLane =
    options.desiredLane || desiredStockxLaneFromShopify(shopifyExpress);

  const slug = (options.slug || (await resolveSlugFromSku(shopify.sku)) || "").trim();
  if (!slug) throw new Error(`No StockX slug for SKU ${shopify.sku}`);

  const sizeNum = shopify.sizeEU.replace(/^EU\s*/i, "").trim();
  const sizeUS = convertEuToUs(shopify.sizeEU, {
    title: shopify.title,
    brand: inferBrandFromTitle(shopify.title),
  });
  const productUrl = buildStockxBuyUrl(slug, sizeUS);

  const previewId = `preview_${Date.now().toString(36)}`;
  const shotRel = `stockx-checkout-${previewId}.png`;
  const shotAbs = path.join(DATA_DIR, shotRel);

  const { ctx, page } = await launchStockxContext();

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    await dismissNoise(page);
    const sized = await selectSizeEuOrUs(page, shopify.sizeEU, sizeUS);
    if (!sized.ok) throw new Error(`Size ${shopify.sizeEU} (US ${sizeUS || "?"}) not selectable`);
    await page.waitForTimeout(1200);
    await dismissNoise(page);
    if (!(await clickBuyNow(page))) throw new Error("Buy Now button not found");
    await page.waitForTimeout(4500);
    await dismissNoise(page);

    const selected = await selectAndVerifyStockxLane(page, {
      policy: "desired",
      desired: desiredLane,
      maxAllInChf,
    });
    const lanes = selected.lanes;
    const pickOk = selected.ok;
    const pickLane = selected.ok ? selected.lane : null;

    if (await clickReviewOrder(page)) {
      await page.waitForTimeout(4500);
    }

    const pay = page.getByRole("button", { name: /Passer commande|Place Order/i }).first();
    const payVisible = await pay.isVisible({ timeout: 8000 }).catch(() => false);
    const payText = payVisible
      ? ((await pay.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim()
      : null;

    const text = await page.locator("body").innerText().catch(() => "");
    const totals = parseCheckoutTotals(text);
    const totalChf =
      totals.totalChf ??
      (selected.ok ? selected.subtotalChf : null) ??
      (pickLane?.totalChf ?? null);

    await page.screenshot({ path: shotAbs, fullPage: true }).catch(() => undefined);
    let screenshotDataUrl: string | null = null;
    try {
      const buf = await fs.readFile(shotAbs);
      screenshotDataUrl = `data:image/png;base64,${buf.toString("base64")}`;
    } catch {
      screenshotDataUrl = null;
    }

    const preview: StockxCheckoutPreview = {
      previewId,
      createdAt: new Date().toISOString(),
      orderName: shopify.orderName,
      shopifyLineItemId: shopify.shopifyLineItemId,
      title: shopify.title,
      sku: shopify.sku,
      sizeEU: `EU ${sizeNum}`,
      sizeUS,
      saleChf: shopify.saleChf,
      slug,
      productUrl,
      buyUrl: page.url(),
      desiredLane,
      shopifyExpress,
      lane: pickOk && pickLane ? pickLane.label : "UNKNOWN",
      lanes,
      itemChf: totals.itemChf,
      feesChf: totals.feesChf,
      shippingChf: totals.shippingChf,
      totalChf,
      eta: totals.eta || (pickLane?.eta ?? null),
      payButton: payText,
      withinCap: totalChf != null && totalChf <= maxAllInChf,
      marginOk: marginOk(shopify.saleChf, totalChf),
      maxAllInChf,
      screenshotRel: shotRel,
      screenshotDataUrl,
      snippet: text.slice(0, 2500),
    };

    const state = await readState();
    state.preview = { ...preview, screenshotDataUrl: null };
    await writeState(state);
    return preview;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Confirms a previous preview by re-opening the buy URL and clicking Place Order.
 * Requires exact total match + total <= cap. Re-selects desired lane (never Express unless preview was Express).
 */
export async function confirmStockxCheckout(options: {
  previewId: string;
  confirmTotalChf: number;
}): Promise<{
  ok: boolean;
  stockxOrderNumber: string | null;
  totalChf: number | null;
  error: string | null;
}> {
  const state = await readState();
  const preview = state.preview;
  if (!preview || preview.previewId !== options.previewId) {
    return { ok: false, stockxOrderNumber: null, totalChf: null, error: "Preview expired or unknown" };
  }
  if (preview.totalChf == null) {
    return { ok: false, stockxOrderNumber: null, totalChf: null, error: "Preview missing total" };
  }
  if (Math.abs(preview.totalChf - Number(options.confirmTotalChf)) > 0.011) {
    return {
      ok: false,
      stockxOrderNumber: null,
      totalChf: preview.totalChf,
      error: `Confirm total mismatch (preview ${preview.totalChf}, got ${options.confirmTotalChf})`,
    };
  }
  if (preview.totalChf > preview.maxAllInChf) {
    return {
      ok: false,
      stockxOrderNumber: null,
      totalChf: preview.totalChf,
      error: `Total ${preview.totalChf} CHF exceeds cap ${preview.maxAllInChf}`,
    };
  }
  if (!preview.buyUrl) {
    return { ok: false, stockxOrderNumber: null, totalChf: preview.totalChf, error: "Missing buy URL" };
  }

  const { ctx, page } = await launchStockxContext();
  let stockxOrderNumber: string | null = null;
  let error: string | null = null;

  try {
    await page.goto(preview.buyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    await dismissNoise(page);

    const selected = await selectAndVerifyStockxLane(page, {
      policy: "desired",
      desired: preview.desiredLane || "STANDARD",
      maxAllInChf: preview.maxAllInChf,
    });
    if (!selected.ok) {
      error = `Lane verify failed: ${selected.reason}${selected.detail ? ` (${selected.detail})` : ""}`;
    }

    if (!error && (await clickReviewOrder(page))) {
      await page.waitForTimeout(4000);
    }

    const text = await page.locator("body").innerText().catch(() => "");
    const liveTotal =
      parseCheckoutTotals(text).totalChf ??
      (selected.ok ? selected.subtotalChf : null);
    if (!error && (liveTotal == null || Math.abs(liveTotal - preview.totalChf) > 0.5)) {
      error = `Live total changed (preview ${preview.totalChf}, live ${liveTotal})`;
    } else if (!error) {
      const pay = page.getByRole("button", { name: /Passer commande|Place Order/i }).first();
      if (!(await pay.isVisible({ timeout: 8000 }).catch(() => false))) {
        error = "Place Order button not found";
      } else {
        await pay.click();
        await page.waitForTimeout(8000);
        const after = `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`;
        const orderMatch =
          after.match(/\b(0[1-3]-[A-Z0-9]{8,})\b/) ||
          after.match(/numéro de commande[^\n]*([0-9A-Z-]{8,})/i);
        stockxOrderNumber = orderMatch?.[1] ?? null;
        if (!/merci|confirmation|order|commande|buying\/orders/i.test(after) && !stockxOrderNumber) {
          error = "Order click did not show a clear confirmation";
        }
      }
    }
  } catch (e: any) {
    error = e?.message || String(e);
  } finally {
    await ctx.close().catch(() => undefined);
  }

  const result = {
    ok: !error,
    stockxOrderNumber,
    totalChf: preview.totalChf,
    error,
  };
  state.lastConfirm = {
    at: new Date().toISOString(),
    orderName: preview.orderName,
    totalChf: preview.totalChf,
    stockxOrderNumber,
    ok: result.ok,
    error,
  };
  state.preview = null;
  await writeState(state);
  return result;
}

export type StockxAutoCheckoutResult = {
  kind: "easy_buy" | "needs_human" | "skipped";
  reason?: StockxNeedsHumanReason;
  detail?: string | null;
  stockxOrderNumber?: string | null;
  totalChf?: number | null;
  link?: { orderMatchId: string | null; metafieldsOk: boolean } | null;
  needsHuman?: StockxNeedsHumanPayload | null;
};

function needsHumanBase(
  shopify: ShopifyLineCtx,
  extras: Partial<StockxNeedsHumanPayload> & {
    reason: StockxNeedsHumanReason;
    desiredLane: StockxDesiredLane;
  }
): StockxNeedsHumanPayload {
  return {
    shopifyOrderName: shopify.orderName,
    shopifyOrderId: shopify.shopifyOrderId,
    shopifyLineItemId: shopify.shopifyLineItemId,
    title: shopify.title,
    sku: shopify.sku,
    saleChf: shopify.saleChf,
    slug: extras.slug ?? null,
    productUrl: extras.productUrl ?? null,
    buyUrl: extras.buyUrl ?? null,
    sizeEU: shopify.sizeEU,
    sizeUS: extras.sizeUS ?? null,
    desiredLane: extras.desiredLane,
    lanes: extras.lanes ?? [],
    recommended: extras.recommended ?? null,
    reason: extras.reason,
    detail: extras.detail ?? null,
    screenshotRel: extras.screenshotRel ?? null,
  };
}

/**
 * Easy path: Playwright buy + OrderMatch + metafields when rules clear.
 * Ambiguous / hard → needs_human payload (caller emails).
 */
export async function runStockxAutoCheckoutForOrder(options: {
  orderName: string;
  lineItemId?: string | null;
  slug?: string | null;
  maxAllInChf?: number;
  /** When true, do not click Place Order (dry run classification + preview). */
  dryRun?: boolean;
  /** Force StockX lane (Shopify batch = STANDARD). Default: from Shopify Express detect. */
  desiredLane?: StockxDesiredLane | null;
  /** Reuse an already-warm sticky browser (batch buy). Caller owns close. */
  reuse?: { ctx: BrowserContext; page: Page } | null;
  /** Skip hard PDP goto when reuse page is already on product. */
  skipGoto?: boolean;
  /** Override Shopify size when line load unavailable / plan size. */
  sizeEUOverride?: string | null;
}): Promise<StockxAutoCheckoutResult> {
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  let shopify: ShopifyLineCtx;
  try {
    shopify = await loadShopifyLine(options.orderName, options.lineItemId);
    if (options.sizeEUOverride) {
      shopify = { ...shopify, sizeEU: options.sizeEUOverride };
    }
  } catch (e: any) {
    return {
      kind: "needs_human",
      reason: "setup",
      detail: e?.message || String(e),
      needsHuman: {
        shopifyOrderName: options.orderName,
        shopifyOrderId: null,
        shopifyLineItemId: options.lineItemId ?? null,
        title: "",
        sku: "",
        saleChf: null,
        slug: null,
        productUrl: null,
        buyUrl: null,
        sizeEU: "?",
        sizeUS: null,
        desiredLane: "STANDARD",
        lanes: [],
        recommended: null,
        reason: "setup",
        detail: e?.message || String(e),
      },
    };
  }

  if (shopify.isStorePickup) {
    const nh = needsHumanBase(shopify, { reason: "pickup", desiredLane: "STANDARD" });
    return { kind: "skipped", reason: "pickup", needsHuman: nh };
  }
  if (shopify.physicalStockQty != null && shopify.physicalStockQty > 0) {
    const nh = needsHumanBase(shopify, { reason: "physical_stock", desiredLane: "STANDARD" });
    return { kind: "skipped", reason: "physical_stock", needsHuman: nh };
  }

  if (shopify.shopifyLineItemId) {
    const existing = await prisma.orderMatch.findUnique({
      where: { shopifyLineItemId: shopify.shopifyLineItemId },
      select: { id: true, stockxOrderNumber: true },
    });
    if (existing?.stockxOrderNumber) {
      const nh = needsHumanBase(shopify, {
        reason: "already_matched",
        desiredLane: "STANDARD",
        detail: existing.stockxOrderNumber,
      });
      return { kind: "skipped", reason: "already_matched", needsHuman: nh };
    }
  }

  // Pre-buy dedupe: Gmail (StockX+GOAT) + both StockX account histories.
  // Clear unlinked STX match → link (no new purchase). GOAT-only → block.
  if (shopify.shopifyLineItemId && shopify.shopifyOrderId && shopify.createdAt) {
    const slugHint = (options.slug || (await resolveSlugFromSku(shopify.sku)) || "").trim();
    const prebuy = await runPrebuyDedupeCheck(
      {
        shopifyOrderName: shopify.orderName,
        shopifyOrderId: shopify.shopifyOrderId,
        shopifyLineItemId: shopify.shopifyLineItemId,
        shopifyCreatedAt: shopify.createdAt,
        title: shopify.title,
        sku: shopify.sku || null,
        sizeEU: shopify.sizeEU || sizeFromSku(shopify.sku),
        urlKeyHint: slugHint || null,
      },
      { linkIfClear: true }
    );
    if (prebuyBlocksNewPurchase(prebuy)) {
      const reason: StockxNeedsHumanReason =
        prebuy.verdict === "ALREADY_MATCHED" ? "already_matched" : "prebuy_dedupe";
      const nh = needsHumanBase(shopify, {
        reason,
        desiredLane: "STANDARD",
        detail: `${prebuy.verdict}: ${prebuy.detail}`,
        slug: slugHint || null,
      });
      console.log(
        `[STOCKX-AUTO] prebuy block ${shopify.orderName}: ${prebuy.verdict} ${prebuy.detail}`
      );
      return {
        kind: prebuy.verdict === "ALREADY_MATCHED" || prebuy.linkedStockxOrderNumber
          ? "skipped"
          : "needs_human",
        reason,
        detail: prebuy.detail,
        stockxOrderNumber: prebuy.linkedStockxOrderNumber ?? null,
        needsHuman: nh,
      };
    }
  }

  const shopifyExpress = detectShopifyExpress({
    deliveryMode: shopify.deliveryMode,
    deliveryModeLabel: shopify.deliveryModeLabel,
    shippingLineTitles: shopify.shippingLineTitles,
  });
  const desiredLane =
    options.desiredLane || desiredStockxLaneFromShopify(shopifyExpress);

  const slug = (options.slug || (await resolveSlugFromSku(shopify.sku)) || "").trim();
  if (!slug) {
    const nh = needsHumanBase(shopify, { reason: "slug", desiredLane });
    return { kind: "needs_human", reason: "slug", needsHuman: nh };
  }

  const sizeUS = convertEuToUs(shopify.sizeEU, {
    title: shopify.title,
    brand: inferBrandFromTitle(shopify.title),
  });
  const productUrl = buildStockxBuyUrl(slug, sizeUS);

  let ctx: BrowserContext | null = null;
  let ownsContext = false;
  try {
    let page: Page;
    if (options.reuse?.page) {
      ctx = options.reuse.ctx;
      page = options.reuse.page;
    } else {
      const launched = await launchStockxContext({
        useStickyProxy: stockxBrowserProxyMode() === "always",
      });
      ctx = launched.ctx;
      page = launched.page;
      ownsContext = true;
    }

    const fail = async (
      reason: StockxNeedsHumanReason,
      extras: Partial<StockxNeedsHumanPayload> & { detail?: string | null }
    ): Promise<StockxAutoCheckoutResult> => {
      const shot = await captureAutoScreenshot(
        page,
        `${shopify.orderName}-${reason}`
      );
      const nh = needsHumanBase(shopify, {
        reason,
        desiredLane,
        slug,
        productUrl,
        sizeUS,
        buyUrl: page.url(),
        screenshotRel: shot,
        ...extras,
      });
      return { kind: "needs_human", reason, detail: extras.detail, needsHuman: nh };
    };

    if (!options.skipGoto) {
      await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
    } else {
      await page.waitForTimeout(800);
      // Batch nav (softNavToPdp) lands on the PDP WITHOUT a ?size deep-link. For apparel
      // letter sizes (S/M/L…) the on-page grid is flaky, so apply the ?size=S deep-link
      // here — selectSizeEuOrUs then hits its urlSized fast-path instead of clicking tiles.
      const letter = apparelLetterSize(sizeUS) ?? apparelLetterSize(shopify.sizeEU);
      if (letter && !new RegExp(`[?&]size=${letter}\\b`, "i").test(page.url())) {
        await page
          .goto(buildStockxBuyUrl(slug, letter), {
            waitUntil: "domcontentloaded",
            timeout: 45_000,
          })
          .catch(() => undefined);
        await page.waitForTimeout(2500);
      }
    }
    await dismissNoise(page);

    const sized = await selectSizeEuOrUs(page, shopify.sizeEU, sizeUS);
    if (!sized.ok) {
      return fail("size_us_map", {
        buyUrl: productUrl,
        detail: sizeUS ? `EU+US select failed (US ${sizeUS})` : "EU select failed + no US map",
      });
    }

    await page.waitForTimeout(1000);
    if (!(await clickBuyNow(page))) {
      return fail("bot_fail", { detail: "Buy Now not found" });
    }
    await page.waitForTimeout(4500);
    await dismissNoise(page);
    // xpress-ship=true defaults Express radio — strip + reload so STANDARD selectable.
    try {
      const u = page.url();
      if (/xpress-ship=true/i.test(u)) {
        const cleaned = u
          .replace(/([?&])xpress-ship=true&?/i, "$1")
          .replace(/[?&]$/, "")
          .replace(/\?&/, "?");
        if (cleaned !== u) {
          await page.goto(cleaned, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(2500);
          await dismissNoise(page);
        }
      }
    } catch {
      /* keep going */
    }

    const selected = await selectAndVerifyStockxLane(page, {
      policy: "desired",
      desired: desiredLane,
      maxAllInChf,
    });
    const lanes = selected.lanes;
    if (!selected.ok) {
      const cheapest =
        [...lanes].sort((a, b) => a.totalChf - b.totalChf)[0] ?? null;
      const reason = (
        ["oos", "oos_no_ask", "express_only", "multi_price", "wrong_lane_only", "cap", "express_unparsed", "price_moved", "bot_fail", "proxy_blank"] as const
      ).includes(selected.reason as any)
        ? (selected.reason as StockxNeedsHumanReason)
        : "bot_fail";
      return fail(reason, {
        lanes,
        recommended: cheapest,
        detail: selected.detail ?? selected.reason,
      });
    }
    const pick = { ok: true as const, lane: selected.lane };

    if (!(await clickReviewOrder(page))) {
      return fail("bot_fail", {
        lanes,
        recommended: pick.lane,
        detail: "Review/confirm button missing",
      });
    }
    await page.waitForTimeout(4500);

    const text = await page.locator("body").innerText().catch(() => "");
    const totals = parseCheckoutTotals(text);
    // Pre-pay LIVE total only — never OCR confirm screen for cost.
    const totalChf = totals.totalChf ?? selected.subtotalChf;

    if (totalChf == null || totalChf > maxAllInChf) {
      return fail("cap", {
        lanes,
        recommended: pick.lane,
        detail: `total ${totalChf}`,
      });
    }

    if (Math.abs(totalChf - pick.lane.totalChf) > 0.5) {
      return fail("price_moved", {
        lanes,
        recommended: pick.lane,
        detail: `lane ${pick.lane.totalChf} → total ${totalChf}`,
      });
    }

    // Last gate before Place Order: block an Express total only when we actually PICKED a
    // STANDARD lane (click didn't stick → stuck-Express protection). A deliberate upgrade
    // or a single-Xpress-only page legitimately has an Express total, so key on the chosen
    // lane, not the customer's original desire (margin/cap already gated above/below).
    if (
      pick.lane.label === "STANDARD" &&
      liveSubtotalLooksLikeExpress(totalChf, lanes, "STANDARD")
    ) {
      return fail("price_moved", {
        lanes,
        recommended: pick.lane,
        detail: `Place Order blocked — live total ${totalChf} matches Express (picked STANDARD ${pick.lane.totalChf})`,
      });
    }

    if (!marginOk(shopify.saleChf, totalChf)) {
      return fail("margin", {
        lanes,
        recommended: pick.lane,
        detail: `sale ${shopify.saleChf} vs total ${totalChf}`,
      });
    }

    const pay = page.getByRole("button", { name: /Passer commande|Place Order/i }).first();
    if (!(await pay.isVisible({ timeout: 8000 }).catch(() => false))) {
      return fail("bot_fail", {
        lanes,
        recommended: pick.lane,
        detail: "Place Order missing",
      });
    }

    if (options.dryRun) {
      const shot = await captureAutoScreenshot(page, `${shopify.orderName}-dryrun`);
      return {
        kind: "easy_buy",
        totalChf,
        detail: shot
          ? `dry_run — would pay (shot .data/${shot})`
          : "dry_run — would pay",
        needsHuman: null,
      };
    }

    await pay.click();
    await page.waitForTimeout(8000);
    const after = `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`;
    const orderMatch =
      after.match(/\b(0[1-3]-[A-Z0-9]{8,})\b/) ||
      after.match(/numéro de commande[^\n]*([0-9A-Z-]{8,})/i);
    let stockxOrderNumber = orderMatch?.[1] ?? null;
    if (!stockxOrderNumber) {
      // Auto-resolve "paid but confirmation spinner hung": payment went through but the
      // order number never rendered. Force-refresh the buying API and match this exact
      // line (product+size, unlinked) via the same prebuy-dedupe matcher. A single
      // unambiguous fresh match → use it; otherwise fall through to human.
      try {
        const hits = await findUnlinkedStockxMatches(
          {
            shopifyOrderName: shopify.orderName,
            shopifyOrderId: shopify.shopifyOrderId ?? "",
            shopifyLineItemId: shopify.shopifyLineItemId ?? "",
            shopifyCreatedAt: shopify.createdAt ?? new Date().toISOString(),
            title: shopify.title,
            sku: shopify.sku ?? null,
            sizeEU: shopify.sizeEU ?? null,
          },
          { forceRefresh: true }
        );
        const sorted = [...hits].sort((a, b) => {
          const ta = a.purchaseDate ? Date.parse(a.purchaseDate) : 0;
          const tb = b.purchaseDate ? Date.parse(b.purchaseDate) : 0;
          return tb - ta;
        });
        if (sorted.length === 1 && sorted[0]?.orderNumber) {
          stockxOrderNumber = sorted[0].orderNumber;
          console.warn(
            `[STOCKX-CHECKOUT] bot_fail auto-resolved via buying API → ${stockxOrderNumber}`
          );
        } else if (sorted.length > 1) {
          console.warn(
            `[STOCKX-CHECKOUT] bot_fail: ${sorted.length} unlinked candidates (${sorted
              .map((h) => h.orderNumber)
              .join(",")}) — ambiguous, needs human`
          );
        }
      } catch (e: any) {
        console.warn(
          `[STOCKX-CHECKOUT] bot_fail auto-resolve failed: ${e?.message || e}`
        );
      }
    }
    if (!stockxOrderNumber) {
      return fail("bot_fail", {
        lanes,
        recommended: pick.lane,
        detail: "Paid but no StockX order number parsed (buying API had no single match) — check VNC / account",
      });
    }

    // 01- = Express, 03- = Standard. Reject an Express number only when we actually PICKED
    // a STANDARD lane (a deliberate upgrade / single-Xpress-only page legitimately yields
    // an Express order), so key on the chosen lane, not the customer's original choice.
    if (pick.lane.label === "STANDARD" && stockxOrderNumber.startsWith("01-")) {
      return fail("wrong_lane_only", {
        lanes,
        recommended: pick.lane,
        detail: `Got Express order ${stockxOrderNumber} on picked STANDARD lane`,
      });
    }

    const checkoutType = stockxOrderNumber.startsWith("01-")
      ? "EXPRESS"
      : stockxOrderNumber.startsWith("03-")
        ? "STANDARD"
        : desiredLane;

    let link: {
      orderMatchId: string | null;
      metafieldsOk: boolean;
      enrichOk?: boolean;
    } | null = null;
    if (shopify.shopifyOrderId && shopify.shopifyLineItemId) {
      const linked = await linkStockxBuyToShopify({
        shopifyOrderId: shopify.shopifyOrderId,
        shopifyOrderName: shopify.orderName,
        shopifyLineItemId: shopify.shopifyLineItemId,
        shopifyCreatedAt: shopify.createdAt,
        shopifyProductTitle: shopify.title,
        shopifySku: shopify.sku,
        shopifySizeEU: shopify.sizeEU,
        shopifyTotalPrice: shopify.saleChf ?? 0,
        shopifyCustomerEmail: shopify.customerEmail,
        stockxOrderNumber,
        stockxProductName: shopify.title,
        stockxSizeEU: shopify.sizeEU,
        stockxSkuKey: shopify.sku,
        supplierCost: totalChf,
        desiredLane,
        stockxCheckoutType: checkoutType,
        estimatedDelivery: totals.eta,
      });
      link = {
        orderMatchId: linked.orderMatchId,
        metafieldsOk: linked.metafieldsOk,
        enrichOk: linked.enrichOk,
      };
    }

    return {
      kind: "easy_buy",
      stockxOrderNumber,
      totalChf,
      link,
      needsHuman: null,
    };
  } catch (e: any) {
    const nh = needsHumanBase(shopify, {
      reason: "bot_fail",
      desiredLane,
      slug,
      productUrl,
      sizeUS,
      detail: e?.message || String(e),
    });
    return { kind: "needs_human", reason: "bot_fail", detail: e?.message, needsHuman: nh };
  } finally {
    if (ownsContext) await ctx?.close().catch(() => undefined);
  }
}

export type GalaxusAutoCheckoutResult = {
  kind: "easy_buy" | "needs_human" | "skipped";
  reason?: string;
  detail?: string | null;
  stockxOrderNumber?: string | null;
  totalChf?: number | null;
  lane?: StockxLaneLabel | StockxDesiredLane;
  pickReason?: string | null;
  link?: { matchId: string | null; unitLinkStatus: string | null } | null;
};

/**
 * Galaxus → StockX Place Order. Lane = galaxus_express_first HARD RULE
 * (EXPRESS default; STANDARD only when ~50% cheaper). NOT Shopify Express detection.
 */
export async function runStockxAutoCheckoutForGalaxusLine(options: {
  candidate: GalaxusBuyCandidate;
  maxAllInChf?: number;
  dryRun?: boolean;
  reuse?: { ctx: BrowserContext; page: Page };
  skipGoto?: boolean;
  minMargin?: number;
}): Promise<GalaxusAutoCheckoutResult> {
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  const dryRun = Boolean(options.dryRun);
  const minMargin = options.minMargin ?? GALAXUS_CSAT_MIN_MARGIN;
  const c = options.candidate;

  // Prebuy: already linked on this Galaxus line → never double-buy.
  const existing = await (prisma as any).galaxusStockxMatch.findFirst({
    where: {
      galaxusOrderLineId: c.lineId,
      stockxOrderNumber: { not: "" },
    },
    select: { stockxOrderNumber: true },
  });
  if (existing?.stockxOrderNumber) {
    return {
      kind: "skipped",
      reason: "already_matched",
      detail: `already linked ${existing.stockxOrderNumber}`,
      stockxOrderNumber: existing.stockxOrderNumber,
    };
  }

  const sizeUS = convertEuToUs(c.sizeEU, {
    title: c.productName,
    brand: inferBrandFromTitle(c.productName),
  });
  // Hard checkout deep-link — same path every time (lane pick + Place Order).
  const checkoutUrl = buildStockxCheckoutBuyUrl(c.slug, sizeUS || c.sizeEU);

  let ctx: BrowserContext | null = null;
  let ownsContext = false;
  try {
    let page: Page;
    if (options.reuse?.page) {
      ctx = options.reuse.ctx;
      page = options.reuse.page;
    } else {
      const launched = await launchStockxContext({
        account: "galaxus",
        useStickyProxy: stockxBrowserProxyMode() === "always",
      });
      ctx = launched.ctx;
      page = launched.page;
      ownsContext = true;
    }

    if (!options.skipGoto) {
      await page.goto(checkoutUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      await page.waitForTimeout(3500);
    } else {
      await page.waitForTimeout(800);
    }
    await dismissNoise(page);

    // Already on /buy/?size= (batch softNav or goto above) → skip PDP size + Buy Now.
    const onCheckout =
      /\/buy\//i.test(page.url()) ||
      (await page
        .getByRole("button", { name: /Passer commande|Place Order|Review|Confirmer/i })
        .first()
        .isVisible({ timeout: 2500 })
        .catch(() => false));
    if (!onCheckout) {
      const sized = await selectSizeEuOrUs(page, c.sizeEU, sizeUS);
      if (!sized.ok) {
        return {
          kind: "needs_human",
          reason: "size_us_map",
          detail: sizeUS ? `EU+US select failed (US ${sizeUS})` : "EU select failed + no US map",
        };
      }
      await page.waitForTimeout(1000);
      if (!(await clickBuyNow(page))) {
        return { kind: "needs_human", reason: "bot_fail", detail: "Buy Now not found" };
      }
      await page.waitForTimeout(4500);
      await dismissNoise(page);
    }

    // Strip xpress-ship default so STANDARD remains selectable when HARD RULE picks it.
    try {
      const u = page.url();
      if (/xpress-ship=true/i.test(u)) {
        const cleaned = u
          .replace(/([?&])xpress-ship=true&?/i, "$1")
          .replace(/[?&]$/, "")
          .replace(/\?&/, "?");
        if (cleaned !== u) {
          await page.goto(cleaned, { waitUntil: "domcontentloaded", timeout: 45000 });
          await page.waitForTimeout(2500);
          await dismissNoise(page);
        }
      }
    } catch {
      /* keep going */
    }

    const selected = await selectAndVerifyStockxLane(page, {
      policy: "galaxus_express_first",
      maxAllInChf,
    });
    if (!selected.ok) {
      return {
        kind: "needs_human",
        reason: selected.reason,
        detail: selected.detail ?? selected.reason,
        lane: selected.lanes[0]?.label,
      };
    }

    if (!(await clickReviewOrder(page))) {
      return {
        kind: "needs_human",
        reason: "bot_fail",
        detail: "Review/confirm button missing",
        lane: selected.lane.label,
        pickReason: selected.pickReason,
      };
    }
    await page.waitForTimeout(4500);

    const text = await page.locator("body").innerText().catch(() => "");
    const totals = parseCheckoutTotals(text);
    const totalChf = totals.totalChf ?? selected.subtotalChf;

    if (totalChf == null || totalChf > maxAllInChf) {
      return {
        kind: "needs_human",
        reason: "cap",
        detail: `total ${totalChf}`,
        lane: selected.lane.label,
        pickReason: selected.pickReason,
      };
    }
    if (Math.abs(totalChf - selected.lane.totalChf) > 0.5) {
      return {
        kind: "needs_human",
        reason: "price_moved",
        detail: `lane ${selected.lane.totalChf} → total ${totalChf}`,
        lane: selected.lane.label,
        pickReason: selected.pickReason,
      };
    }

    const m = laneMarginPct(c.sellChf, totalChf);
    if (!(m > minMargin)) {
      return {
        kind: "needs_human",
        reason: "margin",
        detail: `sell ${c.sellChf} vs total ${totalChf} margin ${(m * 100).toFixed(1)}% (floor ${(minMargin * 100).toFixed(0)}%)`,
        lane: selected.lane.label,
        pickReason: selected.pickReason,
        totalChf,
      };
    }

    const pay = page.getByRole("button", { name: /Passer commande|Place Order/i }).first();
    if (!(await pay.isVisible({ timeout: 8000 }).catch(() => false))) {
      return {
        kind: "needs_human",
        reason: "bot_fail",
        detail: "Place Order missing",
        lane: selected.lane.label,
        pickReason: selected.pickReason,
      };
    }

    if (dryRun) {
      const shot = await captureAutoScreenshot(page, `galaxus-${c.galaxusOrderId}-dryrun`);
      return {
        kind: "easy_buy",
        totalChf,
        lane: selected.lane.label,
        pickReason: selected.pickReason,
        detail: shot ? `dry_run — would pay (shot .data/${shot})` : "dry_run — would pay",
      };
    }

    await pay.click();
    await page.waitForTimeout(8000);
    const after = `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`;
    const orderMatch =
      after.match(/\b(0[1-3]-[A-Z0-9]{8,})\b/) ||
      after.match(/numéro de commande[^\n]*([0-9A-Z-]{8,})/i);
    let stockxOrderNumber = orderMatch?.[1] ?? null;

    // Confirmation spinner often hangs with no order # — scrape /buying/orders
    // in the same session (newest-first) and match size + title (+ optional CHF).
    if (!stockxOrderNumber) {
      try {
        await page.goto("https://stockx.com/buying/orders", {
          waitUntil: "domcontentloaded",
          timeout: 45_000,
        });
        await page.waitForTimeout(5000);
        const buyBody = (await page.locator("body").innerText().catch(() => "")) || "";
        const hit = recoverStockxOrderNumberFromBuyingListText(buyBody, {
          sizeEU: c.sizeEU,
          productName: c.productName,
          totalChf,
          totalToleranceChf: 3,
        });
        if (hit?.orderNumber) {
          stockxOrderNumber = hit.orderNumber;
          console.warn(
            `[STOCKX-CHECKOUT][GALAXUS] recovered order # via buying list → ${stockxOrderNumber} (score=${hit.score})`
          );
        }
      } catch (e: any) {
        console.warn(
          `[STOCKX-CHECKOUT][GALAXUS] buying-list recover failed: ${e?.message || e}`
        );
      }
    }

    if (!stockxOrderNumber) {
      return {
        kind: "needs_human",
        reason: "bot_fail",
        detail: "Paid but no StockX order number parsed — check VNC / account",
        lane: selected.lane.label,
        pickReason: selected.pickReason,
        totalChf,
      };
    }

    const checkoutType: StockxDesiredLane = stockxOrderNumber.startsWith("01-")
      ? "EXPRESS"
      : stockxOrderNumber.startsWith("03-")
        ? "STANDARD"
        : selected.lane.label === "STANDARD"
          ? "STANDARD"
          : "EXPRESS";

    const linked = await linkStockxBuyToGalaxus({
      galaxusOrderDbId: c.galaxusOrderDbId,
      galaxusOrderId: c.galaxusOrderId,
      lineId: c.lineId,
      productName: c.productName,
      gtin: c.gtin,
      sizeEU: c.sizeEU,
      styleId: c.styleId,
      sellChf: c.sellChf,
      stockxOrderNumber,
      supplierCost: totalChf,
      desiredLane: checkoutType,
      stockxCheckoutType: checkoutType,
      estimatedDelivery: totals.eta,
    });

    // Link fail (e.g. StockX # already on another Galaxus line) ≠ easy_buy.
    if (!linked.ok) {
      return {
        kind: "needs_human",
        reason: "link_fail",
        detail: linked.error ?? `paid ${stockxOrderNumber} but link failed`,
        stockxOrderNumber,
        totalChf,
        lane: selected.lane.label,
        pickReason: selected.pickReason,
        link: {
          matchId: linked.matchId,
          unitLinkStatus: linked.unitLinkStatus,
        },
      };
    }

    return {
      kind: "easy_buy",
      stockxOrderNumber,
      totalChf,
      lane: selected.lane.label,
      pickReason: selected.pickReason,
      link: {
        matchId: linked.matchId,
        unitLinkStatus: linked.unitLinkStatus,
      },
      detail: null,
    };
  } catch (e: any) {
    return {
      kind: "needs_human",
      reason: "bot_fail",
      detail: e?.message || String(e),
    };
  } finally {
    if (ownsContext) await ctx?.close().catch(() => undefined);
  }
}
