import fs from "node:fs/promises";
import path from "node:path";
import { chromium, type Page } from "playwright";
import { prisma } from "@/app/lib/prisma";
import { stockxAccountFiles } from "@/lib/stockxSessionRefresh";

const DATA_DIR = path.join(process.cwd(), ".data");
const STATE_FILE = path.join(DATA_DIR, "stockx-checkout-state.json");
const MAX_ALL_IN_CHF = 250;

export type StockxCheckoutPreview = {
  previewId: string;
  createdAt: string;
  orderName: string;
  shopifyLineItemId: string | null;
  title: string;
  sku: string;
  sizeEU: string;
  saleChf: number | null;
  slug: string;
  productUrl: string;
  buyUrl: string | null;
  lane: "STANDARD" | "EXPRESS" | "UNKNOWN";
  itemChf: number | null;
  feesChf: number | null;
  shippingChf: number | null;
  totalChf: number | null;
  eta: string | null;
  payButton: string | null;
  withinCap: boolean;
  maxAllInChf: number;
  screenshotRel: string;
  screenshotDataUrl: string | null;
  snippet: string;
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
};

function moneyToNumber(raw: string | null | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\s/g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

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
    return JSON.parse(raw) as StoredState;
  } catch {
    return { preview: null, lastConfirm: null };
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

async function selectSizeEu(page: Page, sizeEU: string) {
  const size = sizeEU.replace(/^EU\s*/i, "").trim();
  await page.getByRole("button", { name: /Taille/i }).first().click({ timeout: 8000 }).catch(() => undefined);
  await page.waitForTimeout(700);
  const euTab = page.getByRole("button", { name: /^EU$/ }).first();
  if (await euTab.isVisible({ timeout: 1000 }).catch(() => false)) await euTab.click();
  await page.waitForTimeout(400);
  const re = new RegExp(`^EU\\s*${size.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\s*2\\/3)`);
  const exact = page.locator("button").filter({ hasText: re }).first();
  if (await exact.count()) {
    await exact.click();
    return true;
  }
  return false;
}

async function clickBuyNow(page: Page) {
  for (const b of [
    page.getByRole("button", { name: /^Acheter maintenant$/i }),
    page.getByRole("button", { name: /Acheter maintenant/i }),
    page.getByRole("button", { name: /^Buy Now$/i }),
  ]) {
    const el = b.last();
    if (await el.isVisible({ timeout: 1500 }).catch(() => false)) {
      await el.click();
      return true;
    }
  }
  return false;
}

async function chooseStandardLane(page: Page) {
  // Prefer Standard ask lane; Express is usually the much higher second option.
  const body = await page.locator("body").innerText().catch(() => "");
  const amounts = extractChfAmounts(body);
  const candidates = amounts.filter((n) => n > 20 && n < MAX_ALL_IN_CHF).sort((a, b) => a - b);
  const target = candidates[0];
  if (target != null) {
    const label = String(target).replace(".", "[,.]");
    const card = page
      .locator("button,label,div[role=button],div[role=radio]")
      .filter({ hasText: new RegExp(label) })
      .first();
    if (await card.isVisible({ timeout: 2500 }).catch(() => false)) {
      await card.click().catch(() => undefined);
      return { lane: "STANDARD" as const, target };
    }
  }
  const standard = page.getByRole("button", { name: /Standard/i }).first();
  if (await standard.isVisible({ timeout: 1000 }).catch(() => false)) {
    await standard.click().catch(() => undefined);
    return { lane: "STANDARD" as const, target: target ?? null };
  }
  return { lane: "UNKNOWN" as const, target: target ?? null };
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

async function loadShopifyLine(orderName: string) {
  const name = orderName.startsWith("#") ? orderName : `#${orderName}`;
  // Lazy import keeps this module usable from scripts without pulling the full route graph twice.
  const { POST } = await import("@/app/api/shopify/order-by-name/route");
  const res = await POST(
    new Request("http://local/api/shopify/order-by-name", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ orderName: name }),
    }) as any
  );
  const json: any = await res.json();
  const line = Array.isArray(json?.lineItems) ? json.lineItems[0] : null;
  if (!line) throw new Error(`Shopify order ${name} not found or empty`);
  return {
    orderName: String(line.orderName || name),
    shopifyLineItemId: String(line.lineItemId || "") || null,
    title: String(line.title || ""),
    sku: String(line.sku || "").trim(),
    sizeEU: String(line.sizeEU || line.variantTitle || "").replace(/^EU\s*/i, "EU ").trim() || "EU ?",
    saleChf: moneyToNumber(String(line.totalPrice ?? line.price ?? "")),
  };
}

export async function getStockxCheckoutState() {
  return readState();
}

/**
 * Opens the Shopify StockX profile, selects size, forces Standard lane, stops on
 * "Passer commande" without clicking it.
 */
export async function previewStockxCheckout(options: {
  orderName: string;
  slug?: string | null;
  maxAllInChf?: number;
}): Promise<StockxCheckoutPreview> {
  const maxAllInChf = Math.min(MAX_ALL_IN_CHF, Number(options.maxAllInChf ?? MAX_ALL_IN_CHF));
  const shopify = await loadShopifyLine(options.orderName);
  const slug = (options.slug || (await resolveSlugFromSku(shopify.sku)) || "").trim();
  if (!slug) throw new Error(`No StockX slug for SKU ${shopify.sku}`);

  const sizeNum = shopify.sizeEU.replace(/^EU\s*/i, "").trim();
  const productUrl = `https://stockx.com/fr-fr/${slug}`;
  const files = stockxAccountFiles("default");
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";

  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(files.profileDir, lockName), { force: true }).catch(() => undefined);
    await fs.rm(path.join(files.profileDir, "Default", lockName), { force: true }).catch(() => undefined);
  }

  const previewId = `preview_${Date.now().toString(36)}`;
  const shotRel = `stockx-checkout-${previewId}.png`;
  const shotAbs = path.join(DATA_DIR, shotRel);

  const ctx = await chromium.launchPersistentContext(files.profileDir, {
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1440, height: 1100 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());

  try {
    await page.goto(productUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(3500);
    await dismissNoise(page);
    const sized = await selectSizeEu(page, shopify.sizeEU);
    if (!sized) throw new Error(`Size ${shopify.sizeEU} not selectable`);
    await page.waitForTimeout(1200);
    await dismissNoise(page);
    if (!(await clickBuyNow(page))) throw new Error("Buy Now button not found");
    await page.waitForTimeout(4500);
    await dismissNoise(page);

    const lanePick = await chooseStandardLane(page);
    await page.waitForTimeout(1000);

    const review = page.getByRole("button", { name: /Vérifier la commande|Review Order/i }).first();
    if (await review.isVisible({ timeout: 6000 }).catch(() => false)) {
      await review.click();
      await page.waitForTimeout(4500);
    }

    const pay = page.getByRole("button", { name: /Passer commande|Place Order/i }).first();
    const payVisible = await pay.isVisible({ timeout: 8000 }).catch(() => false);
    const payText = payVisible
      ? ((await pay.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim()
      : null;

    const text = await page.locator("body").innerText().catch(() => "");
    const amounts = extractChfAmounts(text);
    // Prefer explicit "Total … 86,74 CHF" block when present.
    const totalMatch = text.match(/Total\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
    const totalChf = moneyToNumber(totalMatch?.[1] ?? null) ?? amounts[amounts.length - 1] ?? null;
    const itemMatch = text.match(/Prix d['’]achat\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
    const feeMatch = text.match(/Traitement[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
    const shipMatch = text.match(/Livraison[^\d]*(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
    const etaMatch = text.match(/Recevez votre commande d['’]ici le\s*([^\n]+)/i);

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
      saleChf: shopify.saleChf,
      slug,
      productUrl,
      buyUrl: page.url(),
      lane: lanePick.lane,
      itemChf: moneyToNumber(itemMatch?.[1] ?? null),
      feesChf: moneyToNumber(feeMatch?.[1] ?? null),
      shippingChf: moneyToNumber(shipMatch?.[1] ?? null),
      totalChf,
      eta: etaMatch?.[1]?.trim() || null,
      payButton: payText,
      withinCap: totalChf != null && totalChf <= maxAllInChf,
      maxAllInChf,
      screenshotRel: shotRel,
      screenshotDataUrl,
      snippet: text.slice(0, 2500),
    };

    const state = await readState();
    // Do not persist the heavy data-URL screenshot in state JSON.
    state.preview = { ...preview, screenshotDataUrl: null };
    await writeState(state);
    return preview;
  } finally {
    await ctx.close().catch(() => undefined);
  }
}

/**
 * Confirms a previous preview by re-opening the buy URL and clicking Place Order.
 * Requires exact total match + total <= cap.
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

  const files = stockxAccountFiles("default");
  if (!process.env.DISPLAY) process.env.DISPLAY = ":99";
  for (const lockName of ["SingletonLock", "SingletonCookie", "SingletonSocket"]) {
    await fs.rm(path.join(files.profileDir, lockName), { force: true }).catch(() => undefined);
    await fs.rm(path.join(files.profileDir, "Default", lockName), { force: true }).catch(() => undefined);
  }

  const ctx = await chromium.launchPersistentContext(files.profileDir, {
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
    locale: "fr-CH",
    timezoneId: "Europe/Zurich",
    viewport: { width: 1440, height: 1100 },
  });
  const page = ctx.pages()[0] || (await ctx.newPage());
  let stockxOrderNumber: string | null = null;
  let error: string | null = null;

  try {
    await page.goto(preview.buyUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(4000);
    await dismissNoise(page);
    await chooseStandardLane(page);
    const review = page.getByRole("button", { name: /Vérifier la commande|Review Order/i }).first();
    if (await review.isVisible({ timeout: 4000 }).catch(() => false)) {
      await review.click();
      await page.waitForTimeout(4000);
    }

    const text = await page.locator("body").innerText().catch(() => "");
    const totalMatch = text.match(/Total\s+(\d{1,3}(?:[’'\s]\d{3})*(?:[.,]\d{2})?)\s*CHF/i);
    const liveTotal = moneyToNumber(totalMatch?.[1] ?? null);
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
  // Invalidate preview after confirm attempt so a double-click cannot rebuy.
  state.preview = null;
  await writeState(state);
  return result;
}
