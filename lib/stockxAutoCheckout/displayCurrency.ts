/**
 * StockX display currency. The Galaxus profile can keep currency=CHF in the cookie
 * while the account preference (footer select) still renders euros. Euro amounts
 * must never be treated as CHF.
 */
import type { Page } from "playwright";

export function bodyHasChfPrice(text: string): boolean {
  return /(?:CHF\s*\d)|(?:\d+(?:[.,]\d{2})?\s*CHF)/i.test(text);
}

/** A priced checkout in euros (symbol or EUR), not merely the word in the footer. */
export function bodyHasEuroPrice(text: string): boolean {
  return /€/.test(text) || /\d+(?:[.,]\d{2})?\s*EUR\b/i.test(text);
}

/** True when this snippet's amount is marked CHF and not euro. */
export function snippetIsChfAmount(snippet: string): boolean {
  const s = String(snippet || "");
  if (/€|\bEUR\b/i.test(s) && !/CHF/i.test(s)) return false;
  return /CHF/i.test(s);
}

/**
 * Open the StockX region/currency dialog and save CHF.
 * Leaves region and language alone. Returns whether the page then shows a CHF price.
 */
export async function ensureStockxDisplayChf(page: Page): Promise<"chf" | "eur" | "unknown"> {
  const read = async () => (await page.locator("body").innerText().catch(() => "")).replace(/\s+/g, " ");
  let body = await read();
  if (bodyHasChfPrice(body) && !bodyHasEuroPrice(body)) return "chf";
  if (!bodyHasEuroPrice(body)) return bodyHasChfPrice(body) ? "chf" : "unknown";

  const buyUrl = page.url();
  const opened = await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll("button")).find(
      (n) => /EUR|CHF/.test(n.textContent || "") && n.getBoundingClientRect().width > 8
    );
    if (!b) return false;
    b.scrollIntoView({ block: "center" });
    (b as HTMLButtonElement).click();
    return true;
  });
  if (!opened) return "eur";

  const attached = await page
    .waitForFunction(() => !!document.querySelector('select[name="currency-select"]'), { timeout: 5000 })
    .then(() => true)
    .catch(() => false);
  if (!attached) return "eur";

  const saved = await page.evaluate(() => {
    const sel = document.querySelector('select[name="currency-select"]') as HTMLSelectElement | null;
    if (!sel) return "no-select";
    if (sel.value === "CHF") return "already";
    const opt = Array.from(sel.options).find((o) => o.value === "CHF" || /CHF/i.test(o.text));
    if (!opt) return "no-chf-option";
    const desc = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");
    desc?.set?.call(sel, opt.value);
    sel.dispatchEvent(new Event("input", { bubbles: true }));
    sel.dispatchEvent(new Event("change", { bubbles: true }));
    const save = Array.from(document.querySelectorAll("button")).find((n) =>
      /Enregistrer les modifications|Save changes/i.test(n.textContent || "")
    );
    (save as HTMLButtonElement | undefined)?.click();
    return sel.value;
  });
  console.warn(`[STOCKX-CHECKOUT] display currency switch → ${saved}`);
  await page.waitForTimeout(2000);
  if (buyUrl.includes("/buy/") || buyUrl.includes("stockx.com")) {
    await page.goto(buyUrl, { waitUntil: "domcontentloaded", timeout: 45000 }).catch(() => undefined);
    await page.waitForTimeout(2500);
  }
  body = await read();
  if (bodyHasChfPrice(body) && !bodyHasEuroPrice(body)) return "chf";
  if (bodyHasEuroPrice(body)) return "eur";
  return "unknown";
}
