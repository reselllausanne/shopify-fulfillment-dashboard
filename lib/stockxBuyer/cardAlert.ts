/**
 * Card / payment declined by StockX: stop everything, tell the user, never retry on our own.
 *
 * - Global halt: buyer.halt (unified supervisor) AND night-buyer.halt (Galaxus worker).
 *   Neither halt text matches the paid_no_number auto-heal, so nothing clears them until
 *   `npx tsx scripts/stockx-buyer.ts resume` (after the card is funded / unlocked).
 * - Alert: Postmark email (STOCKX_ALERT_EMAIL, falls back to POSTMARK_FROM_EMAIL) + Slack webhook
 *   when configured + `.data/stockx-buyer/card-alert.json` (shown by `stockx-buyer status`).
 * - Ledger note event `payment_declined:<source>:<order>`.
 * One alert per halt: while card-alert.json is active, repeats are not re-sent.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { sendStockxEmail, postSlack } from "@/lib/stockxAuthAlert";
import { BUYER_DIR, appendEvent, haltBuyer } from "@/lib/stockxBuyer/ledger";
import { redactSecrets } from "@/lib/stockxBuyer/redact";
import { CARD_DECLINED_HALT_REASON } from "@/lib/stockxPaymentDiag";

export const CARD_ALERT_FILE = path.join(BUYER_DIR, "card-alert.json");
const NIGHT_DATA_DIR = process.env.NIGHT_BUYER_DATA_DIR || path.join(process.cwd(), ".data");
export const NIGHT_HALT_PATH = path.join(NIGHT_DATA_DIR, "night-buyer.halt");

export type CardAlert = {
  active: boolean;
  at: string;
  source: "shopify" | "galaxus";
  orderRef: string;
  title: string;
  detail: string | null;
  emailSent: boolean;
  slackSent: boolean;
};

export function cardAlertText(a: Pick<CardAlert, "source" | "orderRef" | "title" | "detail" | "at">): { subject: string; text: string } {
  return {
    subject: "[Resell] StockX: CARTE REFUSEE — buyer en pause",
    text: [
      "La carte (ou le moyen de paiement) a ete refusee par StockX.",
      "Le buyer est en pause (Shopify + Galaxus). Aucun achat n'est retente.",
      "",
      `Ligne: ${a.source} ${a.orderRef} — ${a.title}`,
      `Heure: ${a.at}`,
      `Page StockX: ${a.detail ?? "-"}`,
      "",
      "A faire: alimenter / debloquer la carte, puis reprendre:",
      "  ssh resell-vps 'docker exec -w /app resell-web-1 npx tsx scripts/stockx-buyer.ts resume'",
      "  (puis start si besoin). Dis-le a l'agent et il relance.",
    ].join("\n"),
  };
}

export async function readCardAlert(): Promise<CardAlert | null> {
  try {
    return JSON.parse(await fs.readFile(CARD_ALERT_FILE, "utf8")) as CardAlert;
  } catch {
    return null;
  }
}

/** Halt both buyers, record + send the alert once. Safe to call from several workers. Never throws. */
export async function raiseCardDeclined(input: {
  source: "shopify" | "galaxus";
  orderRef: string;
  title: string;
  detail: string | null;
}): Promise<CardAlert> {
  const at = new Date().toISOString();
  const detail = input.detail ? redactSecrets(String(input.detail)).slice(0, 300) : null;
  const reason = `${CARD_DECLINED_HALT_REASON} (${input.source} ${input.orderRef} ${input.title.slice(0, 50)})`;
  const prev = await readCardAlert();
  try {
    await haltBuyer(reason);
  } catch {
    /* keep going: night halt below */
  }
  try {
    await fs.mkdir(path.dirname(NIGHT_HALT_PATH), { recursive: true });
    await fs.writeFile(NIGHT_HALT_PATH, `${at} ${reason}\n`, "utf8");
  } catch {
    /* ignore */
  }
  await appendEvent({ t: Date.now(), ev: "note", msg: `payment_declined:${input.source}:${input.orderRef}` }).catch(() => undefined);
  if (prev?.active && Date.now() - Date.parse(prev.at) < 6 * 3600_000) return prev;
  const base = { source: input.source, orderRef: input.orderRef, title: input.title, detail, at };
  const { subject, text } = cardAlertText(base);
  const emailSent = await sendStockxEmail(subject, text).catch(() => false);
  const slackSent = await postSlack(`:credit_card: ${subject}\n${text}`).catch(() => false);
  const alert: CardAlert = { active: true, ...base, emailSent, slackSent };
  await fs.mkdir(BUYER_DIR, { recursive: true }).catch(() => undefined);
  await fs.writeFile(CARD_ALERT_FILE, JSON.stringify(alert, null, 2), "utf8").catch(() => undefined);
  console.error(`[CARD-ALERT] ${reason} email=${emailSent} slack=${slackSent}`);
  return alert;
}

export async function clearCardAlert(): Promise<void> {
  const prev = await readCardAlert();
  if (prev?.active) {
    await fs.writeFile(CARD_ALERT_FILE, JSON.stringify({ ...prev, active: false, clearedAt: new Date().toISOString() }, null, 2), "utf8").catch(() => undefined);
  }
}
