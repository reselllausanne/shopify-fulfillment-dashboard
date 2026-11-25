import { formatInTimeZone } from "date-fns-tz";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { attemptCancelRebuy } from "@/lib/stockxDelayRebuy/attemptCancelRebuy";
import {
  isAutoRebuyOnCancelEnabled,
  isCustomerDelayMailEnabled,
} from "@/lib/stockxDelayRebuy/flags";
import { sendCustomerDelayMail } from "@/lib/stockxDelayRebuy/sendCustomer";

/**
 * Stale CANCELLED/REFUNDED StockX buys on Shopify orders that are still open.
 *
 * Why: processFromOpsAlerts only handles FRESH alerts ("no backlog flood"). A cancel that
 * was alerted while the rebuy/mail flags were off (or whose rebuy failed) was never retried
 * and the customer waited weeks (#7440).
 *
 * Every run (called from the 20-min ops-alerts cron, fire-and-forget):
 *  - finds open Shopify matches still CANCELLED/REFUNDED, cancelled >= MIN_AGE_H ago
 *  - retries attemptCancelRebuy (precheck buyable + loss cap inside), max 1 checkout/run,
 *    6h cooldown, max 3 checkouts per match. On success linkAfterBuy sends the
 *    CANCEL_REBUY_LEGIT mail and resets milestones so tracking restarts.
 *  - if not rebought after 24h: customer ORDER_CANCELED mail (deduped by StockXStatusEvent)
 *  - ntfy: immediate on rebuy success / first failure, daily 08:00 Zurich digest of all unresolved.
 *
 * Kill switch: STOCKX_CANCEL_SWEEP=0.
 */

const H = 3_600_000;
const MIN_AGE_H = 6;
const MAIL_AFTER_H = 24;
const COOLDOWN_H = 6;
const MAX_CHECKOUTS_PER_MATCH = 3;
const MAX_CHECKOUTS_PER_RUN = 1;
const MAX_ORDER_AGE_DAYS = 60;
const DIGEST_HOUR_ZURICH = 8;
const TZ = "Europe/Zurich";

const T_SWEEP = "CANCEL_SWEEP";
const T_RESOLVED = "CANCEL_SWEEP_RESOLVED";
const T_FIRSTFAIL = "CANCEL_SWEEP_FIRSTFAIL";
const T_DIGEST = "CANCEL_SWEEP_DIGEST";

let running = false;

export type LiveShopifyState = {
  cancelledAt?: string | null;
  displayFinancialStatus?: string | null;
  displayFulfillmentStatus?: string | null;
};

/** Pure: is the Shopify order already settled (nothing left for the sweep to do)? */
export function isShopifyOrderResolved(s: LiveShopifyState | null): boolean {
  if (!s) return false;
  if (s.cancelledAt) return true;
  const fin = String(s.displayFinancialStatus ?? "").toUpperCase();
  if (fin.includes("REFUND") || fin.includes("VOID")) return true;
  const ful = String(s.displayFulfillmentStatus ?? "").toUpperCase();
  return ful === "FULFILLED";
}

function gid(id: string): string {
  return id.startsWith("gid://") ? id : `gid://shopify/Order/${id}`;
}

async function liveState(shopifyOrderId: string): Promise<LiveShopifyState | null> {
  try {
    const r = await shopifyGraphQL<{ order: LiveShopifyState | null }>(
      `query($id:ID!){order(id:$id){cancelledAt displayFinancialStatus displayFulfillmentStatus}}`,
      { id: gid(shopifyOrderId) },
      { estimatedQueryCost: 5 }
    );
    return r.data?.order ?? null;
  } catch (e) {
    console.error("[CANCEL-SWEEP] shopify live state failed", (e as Error).message);
    return null; // unknown -> treat as unresolved
  }
}

export async function ntfy(title: string, body: string, urgent = false): Promise<void> {
  const topic = process.env.SAV_NTFY_TOPIC;
  if (!topic) return;
  await fetch(`${process.env.SAV_NTFY_URL || "https://ntfy.sh"}/${topic}`, {
    method: "POST",
    headers: { Title: title, Priority: urgent ? "high" : "default", Tags: urgent ? "rotating_light" : "clipboard" },
    body: body.slice(0, 3500),
  }).catch(() => {});
}

async function once(alertType: string, refKey: string, data: { orderRef?: string; detail?: string }) {
  try {
    await prisma.stockxOrderAlert.create({ data: { scope: "shopify", alertType, refKey, ...data } });
    return true;
  } catch {
    return false; // unique violation = already done
  }
}

export type SweepResult = {
  ran: boolean;
  candidates: number;
  rebuyAttempts: number;
  rebought: string[];
  mailed: string[];
  resolved: string[];
};

export async function runStaleCancelSweep(): Promise<SweepResult> {
  const out: SweepResult = { ran: false, candidates: 0, rebuyAttempts: 0, rebought: [], mailed: [], resolved: [] };
  if (process.env.STOCKX_CANCEL_SWEEP === "0" || running) return out;
  running = true;
  out.ran = true;
  try {
    const since = new Date(Date.now() - MAX_ORDER_AGE_DAYS * 24 * H);
    const matches = await prisma.orderMatch.findMany({
      where: {
        supplierSource: "STOCKX",
        stockxStatus: { in: ["CANCELLED", "REFUNDED"] },
        shopifyCreatedAt: { gte: since },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyProductTitle: true,
        shopifySizeEU: true,
        updatedAt: true,
      },
      orderBy: { shopifyCreatedAt: "asc" },
    });
    if (!matches.length) return out;

    const ids = matches.map((m) => m.id);
    const [cancelAlerts, sweepRows, resolvedRows] = await Promise.all([
      prisma.stockxOrderAlert.findMany({
        where: { scope: "shopify", alertType: "CANCELLED", refKey: { in: ids } },
        select: { refKey: true, sentAt: true },
      }),
      prisma.stockxOrderAlert.findMany({
        where: { scope: "shopify", alertType: T_SWEEP, sentAt: { gte: new Date(Date.now() - 30 * 24 * H) } },
        select: { refKey: true, detail: true, sentAt: true },
      }),
      prisma.stockxOrderAlert.findMany({
        where: { scope: "shopify", alertType: T_RESOLVED, refKey: { in: ids } },
        select: { refKey: true },
      }),
    ]);
    const cancelledSince = new Map(cancelAlerts.map((a) => [a.refKey, a.sentAt]));
    const resolvedSet = new Set(resolvedRows.map((r) => r.refKey));
    const rowsFor = (id: string) => sweepRows.filter((r) => r.refKey.startsWith(id + "|"));

    const open = matches.filter((m) => !resolvedSet.has(m.id));
    out.candidates = open.length;
    const unresolved: Array<{ name: string; ageDays: number; note: string }> = [];
    let checkouts = 0;
    const now = Date.now();

    for (const m of open) {
      const since0 = cancelledSince.get(m.id) ?? m.updatedAt;
      const ageH = (now - since0.getTime()) / H;
      if (ageH < MIN_AGE_H) continue;

      const rows = rowsFor(m.id);
      const last = rows.reduce<Date | null>((a, r) => (!a || r.sentAt > a ? r.sentAt : a), null);
      const cooling = last != null && now - last.getTime() < COOLDOWN_H * H;
      const lastNote = rows.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime())[0]?.detail ?? "pas encore tenté";
      if (cooling) {
        unresolved.push({ name: m.shopifyOrderName, ageDays: ageH / 24, note: lastNote });
        continue;
      }

      const live = await liveState(m.shopifyOrderId);
      if (isShopifyOrderResolved(live)) {
        await once(T_RESOLVED, m.id, { orderRef: m.shopifyOrderName, detail: JSON.stringify(live) });
        out.resolved.push(m.shopifyOrderName);
        continue;
      }

      let note = "";
      const priorCheckouts = rows.filter((r) => String(r.detail ?? "").startsWith("checkout")).length;
      if (isAutoRebuyOnCancelEnabled() && checkouts < MAX_CHECKOUTS_PER_RUN && priorCheckouts < MAX_CHECKOUTS_PER_MATCH) {
        let r: Awaited<ReturnType<typeof attemptCancelRebuy>> | null = null;
        try {
          r = await attemptCancelRebuy(m.id);
        } catch (e) {
          note = `erreur rachat: ${String((e as Error).message).slice(0, 120)}`;
        }
        if (r) {
          const reachedCheckout = !r.skipped;
          if (reachedCheckout) {
            checkouts += 1;
            out.rebuyAttempts += 1;
          }
          if (r.bought) {
            out.rebought.push(m.shopifyOrderName);
            note = `checkout BOUGHT ${r.newStockxOrderNumber ?? ""}`;
            await ntfy(
              `Rachat OK ${m.shopifyOrderName}`,
              `${m.shopifyProductTitle} (${m.shopifySizeEU ?? "?"}) racheté, nouvelle commande ${r.newStockxOrderNumber ?? "?"}. Mail client + tracking relancés.`,
              false
            );
          } else {
            note = `${reachedCheckout ? "checkout " : ""}${r.reason ?? "?"}${r.detail ? `: ${String(r.detail).slice(0, 120)}` : ""}`;
          }
        }
      } else {
        note = isAutoRebuyOnCancelEnabled()
          ? priorCheckouts >= MAX_CHECKOUTS_PER_MATCH
            ? "max tentatives atteint"
            : "file d'attente (1 rachat par run)"
          : "auto-rebuy désactivé";
      }

      if (!out.rebought.includes(m.shopifyOrderName)) {
        if (ageH >= MAIL_AFTER_H && isCustomerDelayMailEnabled()) {
          try {
            const mail = await sendCustomerDelayMail({ orderMatchId: m.id, kind: "ORDER_CANCELED" });
            if (mail.sent) {
              out.mailed.push(m.shopifyOrderName);
              note += " | mail client envoyé";
            }
          } catch (e) {
            note += ` | mail erreur ${String((e as Error).message).slice(0, 80)}`;
          }
        }
        unresolved.push({ name: m.shopifyOrderName, ageDays: ageH / 24, note });
        if (await once(T_FIRSTFAIL, m.id, { orderRef: m.shopifyOrderName, detail: note })) {
          await ntfy(
            `Annulé non racheté ${m.shopifyOrderName}`,
            `${m.shopifyProductTitle} (${m.shopifySizeEU ?? "?"}), annulé depuis ${(ageH / 24).toFixed(1)} j.\n${note}\nDécide : rachat manuel ou remboursement.`,
            true
          );
        }
      }

      await prisma.stockxOrderAlert
        .create({
          data: {
            scope: "shopify",
            alertType: T_SWEEP,
            refKey: `${m.id}|${now}`,
            orderRef: m.shopifyOrderName,
            detail: note.slice(0, 500),
          },
        })
        .catch(() => {});
    }

    // Daily digest, 08:00 Zurich, once per day.
    const hour = Number(formatInTimeZone(new Date(), TZ, "H"));
    if (hour === DIGEST_HOUR_ZURICH && unresolved.length) {
      const day = formatInTimeZone(new Date(), TZ, "yyyy-MM-dd");
      if (await once(T_DIGEST, day, { detail: String(unresolved.length) })) {
        const lines = unresolved
          .sort((a, b) => b.ageDays - a.ageDays)
          .map((u) => `${u.name}: ${u.ageDays.toFixed(1)} j, ${u.note}`);
        await ntfy(`${unresolved.length} commande(s) annulée(s) non résolue(s)`, lines.join("\n"), true);
      }
    }
    return out;
  } finally {
    running = false;
  }
}
