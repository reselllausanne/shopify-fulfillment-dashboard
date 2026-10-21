import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { prisma } from "@/app/lib/prisma";
import { stockxAccountFiles } from "@/lib/stockxSessionRefresh";
import {
  chooseLane,
  classifyLaneLabel,
  marginOk,
  moneyToNumber,
  parseLaneCardsFromText,
} from "@/lib/stockxAutoCheckout/chooseLane";
import {
  detectShopifyExpress,
  desiredStockxLaneFromShopify,
} from "@/lib/stockxAutoCheckout/detectShopifyExpress";
import {
  buildStockxBuyUrl,
  convertEuToUs,
  inferBrandFromTitle,
} from "@/lib/stockxAutoCheckout/sizeUsFallback";
import { linkStockxBuyToShopify } from "@/lib/stockxAutoCheckout/linkAfterBuy";
import {
  MAX_ALL_IN_CHF,
  type StockxDesiredLane,
  type StockxLaneCard,
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
  lane: "STANDARD" | "EXPRESS" | "UNKNOWN";
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
  const usRe = new RegExp(
    `^(US\\s*)?${sizeUS.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
    "i"
  );
  const usBtn = page.locator("button").filter({ hasText: usRe }).first();
  if (await usBtn.count()) {
    await usBtn.click();
    return { ok: true, used: "US" };
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
      if (!/\b(Standard|Express|Xpress)\b/i.test(text)) continue;
      if (!/\d/.test(text) || !/CHF/i.test(text)) continue;
      const labelMatch = text.match(/\b(Standard|Express|Xpress)\b/i);
      const priceMatch = text.match(/(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
      if (!labelMatch || !priceMatch) continue;
      const cleaned = priceMatch[1].replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
      const totalChf = Number(cleaned);
      if (!Number.isFinite(totalChf)) continue;
      const etaMatch = text.match(/(?:d['’]ici le|by|ETA)\s*([^·|]{3,40})/i);
      out.push({
        rawLabel: labelMatch[1],
        totalChf,
        eta: etaMatch?.[1]?.trim() || null,
      });
    }
    return out;
  });

  if (fromDom.length) {
    const seen = new Set<string>();
    return fromDom
      .map((row) => ({
        label: classifyLaneLabel(row.rawLabel),
        rawLabel: row.rawLabel,
        totalChf: row.totalChf,
        eta: row.eta,
      }))
      .filter((lane) => {
        const key = `${lane.label}:${lane.totalChf.toFixed(2)}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  const body = await page.locator("body").innerText().catch(() => "");
  return parseLaneCardsFromText(body);
}

async function clickLaneCard(page: Page, lane: StockxLaneCard): Promise<boolean> {
  const label = String(lane.totalChf).replace(".", "[,.]");
  const card = page
    .locator("button,label,div[role=button],div[role=radio]")
    .filter({ hasText: new RegExp(`\\b${lane.rawLabel}\\b`, "i") })
    .filter({ hasText: new RegExp(label) })
    .first();
  if (await card.isVisible({ timeout: 2500 }).catch(() => false)) {
    await card.click().catch(() => undefined);
    return true;
  }
  const byName = page.getByRole("button", { name: new RegExp(lane.rawLabel, "i") }).first();
  if (await byName.isVisible({ timeout: 1000 }).catch(() => false)) {
    await byName.click().catch(() => undefined);
    return true;
  }
  return false;
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

type ShopifyLineCtx = {
  shopifyOrderId: string | null;
  orderName: string;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
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

async function loadShopifyLine(
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

async function launchStockxContext() {
  const files = stockxAccountFiles("default");
  // VPS Xvfb / VNC: without DISPLAY Chromium dies. Default :99 like stockx login.
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(files.profileDir, lockName), { force: true }).catch(() => undefined);
    await fs.rm(path.join(files.profileDir, "Default", lockName), { force: true }).catch(() => undefined);
  }
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
    });
    const page = ctx.pages()[0] || (await ctx.newPage());
    return { ctx, page };
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(
      `StockX browser launch failed (DISPLAY=${process.env.DISPLAY}, profile=${files.profileDir}): ${msg}. ` +
        "On VPS ensure Xvfb/VNC on :99 and no stuck Chromium holding the profile lock."
    );
  }
}

function parseCheckoutTotals(text: string) {
  const amounts = extractChfAmounts(text);
  const totalMatch = text.match(/Total\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const totalChf = moneyToNumber(totalMatch?.[1] ?? null) ?? amounts[amounts.length - 1] ?? null;
  const itemMatch = text.match(/Prix d['’]achat\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const feeMatch = text.match(/Traitement[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const shipMatch = text.match(/Livraison[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
  const etaMatch = text.match(/Recevez votre commande d['’]ici le\s*([^\n]+)/i);
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

    const lanes = await parseLanesFromPage(page);
    const pick = chooseLane(desiredLane, lanes, maxAllInChf);
    if (pick.ok) {
      await clickLaneCard(page, pick.lane);
      await page.waitForTimeout(1000);
    }

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
    const totalChf = totals.totalChf ?? (pick.ok ? pick.lane.totalChf : null);

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
      lane: pick.ok ? pick.lane.label : "UNKNOWN",
      lanes,
      itemChf: totals.itemChf,
      feesChf: totals.feesChf,
      shippingChf: totals.shippingChf,
      totalChf,
      eta: totals.eta || (pick.ok ? pick.lane.eta ?? null : null),
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

    const lanes = await parseLanesFromPage(page);
    const pick = chooseLane(preview.desiredLane || "STANDARD", lanes, preview.maxAllInChf);
    if (pick.ok) await clickLaneCard(page, pick.lane);

    if (await clickReviewOrder(page)) {
      await page.waitForTimeout(4000);
    }

    const text = await page.locator("body").innerText().catch(() => "");
    const liveTotal = parseCheckoutTotals(text).totalChf;
    if (liveTotal == null || Math.abs(liveTotal - preview.totalChf) > 0.5) {
      error = `Live total changed (preview ${preview.totalChf}, live ${liveTotal})`;
    } else {
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
}): Promise<StockxAutoCheckoutResult> {
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  let shopify: ShopifyLineCtx;
  try {
    shopify = await loadShopifyLine(options.orderName, options.lineItemId);
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

  const shopifyExpress = detectShopifyExpress({
    deliveryMode: shopify.deliveryMode,
    deliveryModeLabel: shopify.deliveryModeLabel,
    shippingLineTitles: shopify.shippingLineTitles,
  });
  const desiredLane = desiredStockxLaneFromShopify(shopifyExpress);

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

  let ctx: Awaited<ReturnType<typeof launchStockxContext>>["ctx"] | null = null;
  try {
    const launched = await launchStockxContext();
    ctx = launched.ctx;
    const { page } = launched;

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

    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
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

    const lanes = await parseLanesFromPage(page);
    const pick = chooseLane(desiredLane, lanes, maxAllInChf);
    if (!pick.ok) {
      const cheapest =
        [...lanes].sort((a, b) => a.totalChf - b.totalChf)[0] ?? null;
      return fail(pick.reason, { lanes, recommended: cheapest });
    }

    await clickLaneCard(page, pick.lane);
    await page.waitForTimeout(800);

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
    const totalChf = totals.totalChf ?? pick.lane.totalChf;

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
    const stockxOrderNumber = orderMatch?.[1] ?? null;
    if (!stockxOrderNumber) {
      return fail("bot_fail", {
        lanes,
        recommended: pick.lane,
        detail: "Paid but no StockX order number parsed — check VNC / account",
      });
    }

    // 01- = Express, 03- = Standard — reject Express number if Shopify was Standard
    if (!shopifyExpress && stockxOrderNumber.startsWith("01-")) {
      return fail("wrong_lane_only", {
        lanes,
        recommended: pick.lane,
        detail: `Got Express order ${stockxOrderNumber} on Standard Shopify`,
      });
    }

    const checkoutType = stockxOrderNumber.startsWith("01-")
      ? "EXPRESS"
      : stockxOrderNumber.startsWith("03-")
        ? "STANDARD"
        : desiredLane;

    let link: { orderMatchId: string | null; metafieldsOk: boolean } | null = null;
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
      link = { orderMatchId: linked.orderMatchId, metafieldsOk: linked.metafieldsOk };
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
    await ctx?.close().catch(() => undefined);
  }
}
