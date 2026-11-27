import type { Page } from "playwright";
import {
  lastCheckoutTotalChf,
  promoApplyOutcome,
  promoRejectReason,
  type PromoAccount,
} from "@/lib/stockxPromo/codes";
import { claimNextPromo, markPromoRejected, releasePromoHold } from "@/lib/stockxPromo/store";

export type PromoApplyResult = {
  appliedCode: string | null;
  totalChf: number | null;
  outcome: "none" | "no_field" | "rejected" | "applied" | "unchanged";
};

function norm(value: string | null | undefined): string {
  return (value || "").replace(/\s+/g, " ").trim();
}

/** Tag the review-page discount input + ADD button. Clicks the disclosure once if the field is hidden. */
async function tagDiscountControls(page: Page, clickToggle: boolean): Promise<boolean> {
  // String IIFE: tsx keepNames injects __name into nested functions, which the page does not have.
  const click = clickToggle ? "true" : "false";
  return Boolean(await page.evaluate(`(function(click){
    function normText(value){ return (value || "").replace(/\\s+/g, " ").trim(); }
    function visible(el){
      var box = el.getBoundingClientRect();
      var style = window.getComputedStyle(el);
      return box.width > 2 && box.height > 2 && style.visibility !== "hidden" && style.display !== "none";
    }
    function scoreInput(el){
      if (!visible(el) || el.disabled || el.type === "hidden" || el.type === "checkbox" || el.type === "radio") return 0;
      var blob = (el.name + " " + (el.placeholder || "") + " " + (el.getAttribute("aria-label") || "") + " " + el.id).toLowerCase();
      if (/search|recherche|query/.test(blob)) return 0;
      if (/discount|promo|coupon|réduction|reduction/.test(blob)) return 2;
      if (/\\bcode\\b/.test(blob)) return 1;
      return 0;
    }
    function tag(){
      var inputs = Array.prototype.slice.call(document.querySelectorAll("input"));
      var best = null, bestScore = 0;
      for (var i = 0; i < inputs.length; i++) {
        var score = scoreInput(inputs[i]);
        if (score > bestScore) { best = inputs[i]; bestScore = score; }
      }
      if (!best) return false;
      best.setAttribute("data-stx-promo", "1");
      var scope = best.closest("form, section, li, div") || document.body;
      var buttons = Array.prototype.slice.call(scope.querySelectorAll("button, [role='button']"));
      function labelOk(el){ return /^(add|ajouter|apply|appliquer)(?:\\s+code)?$/i.test(normText(el.textContent)); }
      var button = null;
      for (var b = 0; b < buttons.length; b++) {
        if (visible(buttons[b]) && labelOk(buttons[b])) { button = buttons[b]; break; }
      }
      if (!button) {
        var all = Array.prototype.slice.call(document.querySelectorAll("button"));
        for (var a = 0; a < all.length; a++) {
          if (visible(all[a]) && labelOk(all[a])) { button = all[a]; break; }
        }
      }
      if (!button) return false;
      button.setAttribute("data-stx-promo-add", "1");
      return true;
    }
    if (tag()) return true;
    if (!click) return false;
    var nodes = Array.prototype.slice.call(document.querySelectorAll("button, a, label, span, div, p"));
    for (var n = 0; n < nodes.length; n++) {
      var text = normText(nodes[n].textContent);
      if (text.length > 0 && text.length < 48 && /discount code|code promo|code de r[ée]duction|promo code|add promo|ajouter un code/i.test(text)) {
        nodes[n].click();
        break;
      }
    }
    return false;
  })(${click})`);
}

async function clearTaggedField(page: Page): Promise<void> {
  const input = page.locator("[data-stx-promo='1']").first();
  if (await input.isVisible({ timeout: 500 }).catch(() => false)) {
    await input.fill("").catch(() => undefined);
  }
}

/**
 * Apply the oldest unused code for this account. One code only.
 * Rejected → status rejected, field cleared, caller pays with no code.
 * Applied (total down) → caller marks used only after Place Order succeeds.
 */
export async function applyOneStockxPromo(
  page: Page,
  account: PromoAccount,
  totalBefore: number | null
): Promise<PromoApplyResult> {
  const claimed = await claimNextPromo(account);
  if (!claimed) return { appliedCode: null, totalChf: totalBefore, outcome: "none" };

  const failOpen = async (outcome: PromoApplyResult["outcome"]): Promise<PromoApplyResult> => {
    await releasePromoHold(claimed.code).catch(() => undefined);
    return { appliedCode: null, totalChf: totalBefore, outcome };
  };

  let ready = false;
  try {
    ready = await tagDiscountControls(page, true);
  } catch (error) {
    console.warn(`[STOCKX-PROMO] ${account} discount field failed (${(error as Error)?.message || error}) — pay without code`);
    return failOpen("no_field");
  }
  if (!ready) {
    await page.waitForTimeout(400);
    ready = await tagDiscountControls(page, false);
  }
  if (!ready) {
    console.warn(`[STOCKX-PROMO] ${account} no discount field — skip ${claimed.code}`);
    return failOpen("no_field");
  }

  const input = page.locator("[data-stx-promo='1']").first();
  const add = page.locator("[data-stx-promo-add='1']").first();
  await input.fill(claimed.code);
  const beforeBody = norm(await page.locator("body").innerText().catch(() => ""));
  const before = lastCheckoutTotalChf(beforeBody) ?? totalBefore;
  await add.click({ timeout: 5000 }).catch(async () => {
    await add.click({ force: true, timeout: 3000 });
  });
  await page.waitForTimeout(2500);
  const body = norm(await page.locator("body").innerText().catch(() => ""));
  const after = lastCheckoutTotalChf(body);
  const outcome = promoApplyOutcome({ before, after, body });

  if (outcome === "rejected") {
    const reason = promoRejectReason(body);
    await markPromoRejected(claimed.code, reason);
    await clearTaggedField(page);
    console.warn(`[STOCKX-PROMO] ${account} rejected ${claimed.code} — pay without code`);
    return { appliedCode: null, totalChf: totalBefore, outcome: "rejected" };
  }

  if (outcome === "applied") {
    const totalChf = after != null && before != null && after < before ? after : before;
    console.warn(`[STOCKX-PROMO] ${account} applied ${claimed.code} total ${before} → ${totalChf}`);
    return { appliedCode: claimed.code, totalChf, outcome: "applied" };
  }

  await clearTaggedField(page);
  console.warn(`[STOCKX-PROMO] ${account} ${claimed.code} did not change the total — pay without code`);
  return failOpen("unchanged");
}
