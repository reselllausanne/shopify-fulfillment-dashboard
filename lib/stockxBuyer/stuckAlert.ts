/**
 * One email listing the lines that hit the durable attempt cap (see attemptCap.ts).
 * A new email is sent only when a line enters the stuck list; repeats are silent.
 * Channel = existing Postmark alert mail (STOCKX_ALERT_EMAIL) + Slack webhook when configured.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { postSlack, sendStockxEmail } from "@/lib/stockxAuthAlert";
import { BUYER_DIR } from "@/lib/stockxBuyer/ledger";
import { redactSecrets } from "@/lib/stockxBuyer/redact";

export const STUCK_FILE = path.join(BUYER_DIR, "stuck-lines.json");

export type StuckLine = {
  key: string;
  source: "shopify" | "galaxus";
  orderRef: string;
  title: string;
  cls: string;
  count: number;
  detail: string | null;
  at: string;
};

type StuckFile = { lines: Record<string, StuckLine>; notified: string[] };

async function read(): Promise<StuckFile> {
  try {
    const j = JSON.parse(await fs.readFile(STUCK_FILE, "utf8")) as StuckFile;
    return { lines: j.lines ?? {}, notified: j.notified ?? [] };
  } catch {
    return { lines: {}, notified: [] };
  }
}

async function write(f: StuckFile): Promise<void> {
  await fs.mkdir(path.dirname(STUCK_FILE), { recursive: true }).catch(() => undefined);
  await fs.writeFile(STUCK_FILE, JSON.stringify(f, null, 2), "utf8").catch(() => undefined);
}

export function stuckAlertText(lines: StuckLine[]): { subject: string; text: string } {
  const rows = lines.map(
    (l) => `- ${l.source} ${l.orderRef} — ${l.title} : ${l.cls} x${l.count}${l.detail ? ` (${l.detail.slice(0, 120)})` : ""}`
  );
  return {
    subject: `[Resell] StockX: ${lines.length} ligne(s) coincee(s) — plus de retry`,
    text: [
      "Ces lignes ont echoue trop de fois avec la meme erreur: le buyer ne les retente plus (statut needs_review / max_attempts).",
      "Les autres lignes continuent normalement.",
      "",
      ...rows,
      "",
      "Liberer une ligne: npx tsx scripts/stockx-buyer.ts release <cle>  (ou monter STOCKX_BUYER_MAX_LINE_FAILS).",
    ].join("\n"),
  };
}

/** Record a stuck line; email the full stuck list once per newly stuck line. Never throws. */
export async function noteStuckLine(line: Omit<StuckLine, "at">): Promise<boolean> {
  try {
    const f = await read();
    const fresh = !f.notified.includes(line.key);
    f.lines[line.key] = { ...line, detail: line.detail ? redactSecrets(line.detail).slice(0, 200) : null, at: new Date().toISOString() };
    if (!fresh) {
      await write(f);
      return false;
    }
    const { subject, text } = stuckAlertText(Object.values(f.lines));
    const sent = await sendStockxEmail(subject, text).catch(() => false);
    await postSlack(`:no_entry: ${subject}\n${text}`).catch(() => false);
    f.notified.push(line.key);
    await write(f);
    return sent;
  } catch {
    return false;
  }
}

export async function clearStuckLine(key: string): Promise<void> {
  const f = await read();
  if (!f.lines[key] && !f.notified.includes(key)) return;
  delete f.lines[key];
  f.notified = f.notified.filter((k) => k !== key);
  await write(f);
}

export async function readStuckLines(): Promise<StuckLine[]> {
  return Object.values((await read()).lines);
}
