/**
 * StockX bearer death is silent otherwise: auto-link and AWB sync just return
 * "no_stockx_token" every hour while parcels pile up unlinked. Shout instead.
 *
 * Dedup is file-backed under `.data/` so Next.js restarts cannot:
 * - erase "already alerted" (spam every deploy), nor
 * - pre-claim a slot before Postmark/Slack succeeds (silent 2h blackout).
 * First successful channel send stamps the key; failed sends leave the key clear
 * so the next cron tick retries immediately.
 */

import fs from "node:fs/promises";
import path from "node:path";

/** First remint failure emails immediately; repeats suppressed for 2h (was 3h). */
export const STOCKX_AUTH_ALERT_DEDUP_MS = 2 * 60 * 60 * 1000;
const DEDUPE_FILE = path.join(process.cwd(), ".data", "stockx-auth-alert-dedupe.json");
const memoryCache = new Map<string, number>();

type DedupeFile = { lastAlerts?: Record<string, string> };

async function readDedupeFile(): Promise<DedupeFile> {
  try {
    return JSON.parse(await fs.readFile(DEDUPE_FILE, "utf8")) as DedupeFile;
  } catch {
    return {};
  }
}

async function writeDedupeFile(state: DedupeFile): Promise<void> {
  await fs.mkdir(path.dirname(DEDUPE_FILE), { recursive: true });
  await fs.writeFile(DEDUPE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

async function lastAlertAt(key: string): Promise<number> {
  const mem = memoryCache.get(key);
  if (typeof mem === "number" && Number.isFinite(mem)) return mem;
  const file = await readDedupeFile();
  const raw = file.lastAlerts?.[key];
  const parsed = raw ? Date.parse(raw) : NaN;
  if (Number.isFinite(parsed)) {
    memoryCache.set(key, parsed);
    return parsed;
  }
  return 0;
}

async function markAlertSent(key: string, at = Date.now()): Promise<void> {
  memoryCache.set(key, at);
  const file = await readDedupeFile();
  const lastAlerts = { ...(file.lastAlerts ?? {}), [key]: new Date(at).toISOString() };
  await writeDedupeFile({ ...file, lastAlerts });
}

async function clearAlertMark(key: string): Promise<void> {
  memoryCache.delete(key);
  const file = await readDedupeFile();
  if (!file.lastAlerts?.[key]) return;
  const lastAlerts = { ...file.lastAlerts };
  delete lastAlerts[key];
  await writeDedupeFile({ ...file, lastAlerts });
}

/** True when we should attempt channels (not within dedup window). */
export async function shouldSendStockxAuthAlert(
  key: string,
  opts: { force?: boolean; now?: number; dedupMs?: number } = {}
): Promise<boolean> {
  if (opts.force) return true;
  const now = opts.now ?? Date.now();
  const dedupMs = opts.dedupMs ?? STOCKX_AUTH_ALERT_DEDUP_MS;
  const last = await lastAlertAt(key);
  return !(last > 0 && now - last < dedupMs);
}

function loginPageBaseUrl(): string {
  const raw =
    process.env.STOCKX_ALERT_BASE_URL?.trim() ||
    process.env.RETURNS_PUBLIC_BASE_URL?.trim() ||
    process.env.SHOPIFY_APP_URL?.trim() ||
    "https://solution.resell-lausanne.ch";
  return raw.replace(/\/+$/, "");
}

async function postSlack(text: string): Promise<boolean> {
  const webhook =
    process.env.STOCKX_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.GALAXUS_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim() ||
    "";
  if (!webhook) return false;
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function sendStockxEmail(
  subject: string,
  text: string,
  html?: string | null
): Promise<boolean> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  const to = process.env.STOCKX_ALERT_EMAIL?.trim() || from;
  if (!serverToken || !from || !to) return false;
  try {
    const payload: Record<string, string> = {
      From: from,
      To: to,
      Subject: subject,
      TextBody: text,
      MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
    };
    if (html) payload.HtmlBody = html;
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Postmark-Server-Token": serverToken,
      },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      console.error("[STOCKX][AUTH-ALERT] Postmark failed", res.status, (await res.text()).slice(0, 200));
    }
    return res.ok;
  } catch (err) {
    console.error("[STOCKX][AUTH-ALERT] Postmark error", err);
    return false;
  }
}

export async function notifyStockxAuthBroken(params: {
  account: string;
  error: string | null;
  pendingGalaxusOrders?: number;
  /** Bypass dedupe (ops / diagnostic). Still stamps on success. */
  force?: boolean;
}): Promise<{ sent: boolean; reason?: string }> {
  const key = `stockx-auth:${params.account}`;
  if (!(await shouldSendStockxAuthAlert(key, { force: params.force }))) {
    console.warn(`[STOCKX][AUTH-ALERT] deduped account=${params.account}`);
    return { sent: false, reason: "deduped" };
  }
  const subject = `[Resell] StockX token DEAD (${params.account}) — auto-link + AWB stopped`;
  const text = [
    `StockX account "${params.account}" has no valid bearer after cookie/silent-Auth0/warm-CDP paths failed.`,
    `Error: ${String(params.error ?? "unknown").slice(0, 300)}`,
    params.pendingGalaxusOrders != null
      ? `Galaxus orders waiting for StockX auto-link: ${params.pendingGalaxusOrders}`
      : null,
    "",
    "Until fixed: no Galaxus auto-link, no AWB on scan, parcels show NOT_FOUND.",
    "Action (once): open phone login, pass Turnstile if shown — do NOT re-type password if already logged-in SSO.",
    "Then leave warm daemon / keep-alive running; hourly remint attaches via CDP (no cold Turnstile).",
    `${loginPageBaseUrl()}/admin/stockx-login${params.account === "galaxus" ? "?account=galaxus" : ""}`,
    `VNC: ${loginPageBaseUrl()}/stockx-vnc/vnc.html?autoconnect=1&password=1234&path=stockx-vnc/websockify`,
    `At: ${new Date().toISOString()}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const [slack, email] = await Promise.all([
    postSlack(`:rotating_light: ${subject}\n${text}`),
    sendStockxEmail(subject, text),
  ]);
  if (!slack && !email) {
    await clearAlertMark(key).catch(() => undefined);
    console.error(
      `[STOCKX][AUTH-ALERT] NO CHANNEL account=${params.account} (Postmark/Slack missing or failed)`
    );
    return { sent: false, reason: "no_channel_configured_or_failed" };
  }
  await markAlertSent(key);
  console.warn(
    `[STOCKX][AUTH-ALERT] SENT account=${params.account} slack=${slack} email=${email}`
  );
  return { sent: true };
}
