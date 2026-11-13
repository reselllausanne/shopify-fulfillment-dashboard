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

/** True when this key is outside the dedupe window. Does NOT claim the slot. */
function shouldSendAlert(key: string): boolean {
  const last = recentAlerts.get(key) ?? 0;
  return Date.now() - last >= DEDUP_MS;
}

/** Claim the dedupe slot — only after at least one channel really delivered. */
function markAlertSent(key: string): void {
  recentAlerts.set(key, Date.now());
}

async function postSlackWebhook(text: string): Promise<{ sent: boolean; reason?: string }> {
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

/**
 * Email fallback (Postmark). The Slack webhook env vars were empty in prod, so every
 * stale / failure / crash-loop alert was silently dropped ("no_webhook_configured") while
 * Galaxus prices went un-pushed for up to 41 h. Email is configured on the VPS already.
 */
async function postEmail(subject: string, text: string): Promise<{ sent: boolean; reason?: string }> {
  const serverToken = process.env.POSTMARK_SERVER_TOKEN?.trim();
  const from = process.env.POSTMARK_FROM_EMAIL?.trim();
  const to =
    process.env.GALAXUS_ALERT_EMAIL?.trim() || process.env.STOCKX_ALERT_EMAIL?.trim() || from;
  if (!serverToken || !from || !to) {
    return { sent: false, reason: "no_email_configured" };
  }
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
      const body = await res.text().catch(() => "");
      console.error("[GALAXUS][FEED][ALERT] Postmark failed", res.status, body.slice(0, 200));
      return { sent: false, reason: `email_http_${res.status}` };
    }
    return { sent: true };
  } catch (err) {
    console.error("[GALAXUS][FEED][ALERT] Postmark error", err);
    return { sent: false, reason: "email_fetch_error" };
  }
}

/** Slack + email in parallel; delivered when at least one channel succeeds. */
async function sendAlert(
  dedupeKey: string,
  subject: string,
  text: string
): Promise<{ sent: boolean; reason?: string }> {
  const [slack, email] = await Promise.all([
    postSlackWebhook(text),
    postEmail(subject, text),
  ]);
  if (slack.sent || email.sent) {
    markAlertSent(dedupeKey);
    return { sent: true };
  }
  if (slack.reason === "no_webhook_configured" && email.reason === "no_email_configured") {
    console.error("[GALAXUS][FEED][ALERT] NO CHANNEL configured (Slack webhook + Postmark both missing)");
    return { sent: false, reason: "no_alert_channel_configured" };
  }
  return { sent: false, reason: email.reason ?? slack.reason };
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

  return sendAlert(dedupeKey, `[Resell] Galaxus feed upload FAILED (${params.scope})`, text);
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
  return sendAlert("stale:price-feed", `[Resell] Galaxus price feed STALE (${age})`, text);
}

/**
 * No successful master/specs feed for too long — silent outage detector.
 */
export async function notifyGalaxusMasterSpecsFeedStale(params: {
  hoursSinceSuccess: number | null;
  lastSuccessAt: string | null;
}): Promise<{ sent: boolean; reason?: string }> {
  if (!shouldSendAlert("stale:master-specs-feed")) {
    return { sent: false, reason: "deduped" };
  }
  const age =
    params.hoursSinceSuccess == null
      ? "never / unknown"
      : `${params.hoursSinceSuccess}h ago`;
  const text = [
    ":warning: *Galaxus master/specs feed STALE*",
    `• last successful master-specs: ${params.lastSuccessAt ?? "none"} (${age})`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Product identity, images, and categories on Galaxus may be outdated.",
    "Fix: `bash scripts/galaxus-ops-cron.sh push-master-specs` (COPY dump → oneshot SFTP).",
    "Do not use feed-worker Prisma stream — nightly cron only.",
  ].join("\n");
  return sendAlert(
    "stale:master-specs-feed",
    `[Resell] Galaxus master/specs feed STALE (${age})`,
    text
  );
}

/**
 * A partner feed (e.g. NER) is still receiving uploads but has not successfully IMPORTED in too
 * long — its stock and delist are frozen, so Galaxus keeps selling delisted/sold-out items.
 */
export async function notifyPartnerFeedImportStale(params: {
  partnerKey: string | null;
  partnerName: string | null;
  lastCompletedAt: string | null;
  hoursSinceSuccess: number | null;
}): Promise<{ sent: boolean; reason?: string }> {
  const label = params.partnerKey || params.partnerName || "unknown";
  const dedupeKey = `stale:partner-import:${label}`;
  if (!shouldSendAlert(dedupeKey)) {
    return { sent: false, reason: "deduped" };
  }
  const age =
    params.hoursSinceSuccess == null ? "never / unknown" : `${params.hoursSinceSuccess}h ago`;
  const text = [
    ":warning: *Partner feed import STALE*",
    `• partner: ${params.partnerName ?? "?"} (${params.partnerKey ?? "?"})`,
    `• last successful import: ${params.lastCompletedAt ?? "none"} (${age})`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Uploads are arriving but not importing (killed by deploy / too slow / errors).",
    "Stock + delist for this partner are FROZEN → Galaxus may oversell delisted items.",
  ].join("\n");
  return sendAlert(
    dedupeKey,
    `[Resell] Partner feed import STALE: ${label} (${age})`,
    text
  );
}

/** Crash-recovery circuit breaker tripped — stop blind OOM requeue loops. */
export async function notifyGalaxusFeedCrashLoop(params: {
  scope: FeedScope;
  crashCount: number;
  windowHours: number;
}): Promise<{ sent: boolean; reason?: string }> {
  const dedupeKey = `crash-loop:${params.scope}`;
  if (!shouldSendAlert(dedupeKey)) {
    return { sent: false, reason: "deduped" };
  }
  const text = [
    ":rotating_light: *Galaxus feed CRASH LOOP — hard stop*",
    `• scope: \`${params.scope}\``,
    `• crash recoveries in last ${params.windowHours}h: ${params.crashCount}`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Not auto-requeued. Fix heap/snapshot then push from Galaxus ops UI.",
    "Likely: master live-build OOM — rebuild master/specs snapshot on ops-background first.",
  ].join("\n");
  return sendAlert(dedupeKey, `[Resell] Galaxus feed CRASH LOOP (${params.scope})`, text);
}
