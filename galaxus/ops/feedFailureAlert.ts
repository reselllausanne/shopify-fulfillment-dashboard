import type { FeedScope, FeedTriggerSource } from "./types";

const DEDUP_MS = 30 * 60 * 1000;
const recentAlerts = new Map<string, number>();

function alertWebhookUrl(): string {
  return (
    process.env.GALAXUS_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.BEATBOT_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim() ||
    ""
  );
}

function shouldSendAlert(key: string): boolean {
  const now = Date.now();
  const last = recentAlerts.get(key) ?? 0;
  if (now - last < DEDUP_MS) return false;
  recentAlerts.set(key, now);
  return true;
}

async function postSlack(text: string): Promise<{ sent: boolean; reason?: string }> {
  const webhook = alertWebhookUrl();
  if (!webhook) {
    return { sent: false, reason: "no_webhook_configured" };
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      console.error("[GALAXUS][FEED][ALERT] Slack webhook failed", res.status, body.slice(0, 200));
      return { sent: false, reason: `slack_http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[GALAXUS][FEED][ALERT] Slack notify failed", err);
    return { sent: false, reason: "slack_fetch_error" };
  }
}

/** Slack incoming webhook → channel notif on phone (enable Slack mobile alerts for that channel). */
export async function notifyGalaxusFeedFailure(params: {
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
  runId?: string;
  error: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const errorShort = String(params.error ?? "").trim().slice(0, 240);
  const dedupeKey = `fail:${params.scope}:${errorShort.slice(0, 80)}`;
  if (!shouldSendAlert(dedupeKey)) {
    return { sent: false, reason: "deduped" };
  }

  const text = [
    ":rotating_light: *Galaxus feed upload FAILED*",
    `• scope: \`${params.scope}\``,
    params.triggerSource ? `• trigger: \`${params.triggerSource}\`` : null,
    params.runId ? `• runId: \`${params.runId}\`` : null,
    `• error: ${errorShort}`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Trigger marked FAILED (not auto-retried). Fix then push from Galaxus ops UI.",
  ]
    .filter(Boolean)
    .join("\n");

  return postSlack(text);
}

/** No successful price feed for too long — outage detector. */
export async function notifyGalaxusFeedStale(params: {
  hoursSinceSuccess: number | null;
  lastSuccessAt: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!shouldSendAlert("stale:price-feed")) {
    return { sent: false, reason: "deduped" };
  }
  const age =
    params.hoursSinceSuccess == null
      ? "never / unknown"
      : `${params.hoursSinceSuccess}h ago`;
  const text = [
    ":warning: *Galaxus price feed STALE*",
    `• last successful price/stock-price: ${params.lastSuccessAt ?? "none"} (${age})`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Prices on Galaxus may be outdated. Check Galaxus ops → Push price.",
  ].join("\n");
  return postSlack(text);
}
