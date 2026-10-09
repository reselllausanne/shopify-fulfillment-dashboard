/**
 * StockX bearer death is silent otherwise: auto-link and AWB sync just return
 * "no_stockx_token" every hour while parcels pile up unlinked. Shout instead.
 */

const DEDUP_MS = 3 * 60 * 60 * 1000;
const globalKey = "__resell_stockx_auth_alerts_v1";

function recentAlerts(): Map<string, number> {
  const g = globalThis as typeof globalThis & { [globalKey]?: Map<string, number> };
  if (!g[globalKey]) g[globalKey] = new Map();
  return g[globalKey]!;
}

function shouldSend(key: string): boolean {
  const now = Date.now();
  const last = recentAlerts().get(key) ?? 0;
  if (now - last < DEDUP_MS) return false;
  recentAlerts().set(key, now);
  return true;
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

async function postEmail(subject: string, text: string): Promise<boolean> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  const to = process.env.STOCKX_ALERT_EMAIL?.trim() || from;
  if (!serverToken || !from || !to) return false;
  try {
    const res = await fetch("https://api.postmarkapp.com/email", {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "X-Postmark-Server-Token": serverToken,
      },
      body: JSON.stringify({
        From: from,
        To: to,
        Subject: subject,
        TextBody: text,
        MessageStream: process.env.POSTMARK_MESSAGE_STREAM?.trim() || "outbound",
      }),
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
}): Promise<{ sent: boolean; reason?: string }> {
  const key = `stockx-auth:${params.account}`;
  if (!shouldSend(key)) return { sent: false, reason: "deduped" };
  const subject = `[Resell] StockX token DEAD (${params.account}) — auto-link + AWB stopped`;
  const text = [
    `StockX account "${params.account}" has no valid bearer and auto-login failed.`,
    `Error: ${String(params.error ?? "unknown").slice(0, 300)}`,
    params.pendingGalaxusOrders != null
      ? `Galaxus orders waiting for StockX auto-link: ${params.pendingGalaxusOrders}`
      : null,
    "",
    "Until fixed: no Galaxus auto-link, no AWB on scan, parcels show NOT_FOUND.",
    "Fix: paste a fresh StockX token for this account in the dashboard (StockX tools),",
    "or set STOCKX_GALAXUS_EMAIL/STOCKX_GALAXUS_PASSWORD (galaxus) / STOCKX_EMAIL/STOCKX_PASSWORD (default) on the VPS.",
    `At: ${new Date().toISOString()}`,
  ]
    .filter((line) => line !== null)
    .join("\n");
  const [slack, email] = await Promise.all([postSlack(`:rotating_light: ${subject}\n${text}`), postEmail(subject, text)]);
  if (!slack && !email) {
    recentAlerts().delete(key);
    return { sent: false, reason: "no_channel_configured_or_failed" };
  }
  return { sent: true };
}
