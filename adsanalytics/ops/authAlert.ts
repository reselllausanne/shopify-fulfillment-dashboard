function alertWebhookUrl(): string {
  return (
    process.env.ADS_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.GALAXUS_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.BEATBOT_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim() ||
    ""
  );
}

async function postSlack(text: string): Promise<{ sent: boolean; reason?: string }> {
  const webhook = alertWebhookUrl();
  if (!webhook) return { sent: false, reason: "no_webhook_configured" };
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) return { sent: false, reason: `slack_http_${res.status}` };
    return { sent: true };
  } catch {
    return { sent: false, reason: "slack_fetch_error" };
  }
}

/**
 * A revoked refresh token cannot be recovered headlessly: someone has to click Allow.
 * The only useful automation is shouting on the first failed day instead of letting
 * nightly jobs fail silently for a week.
 */
export async function notifyAdsAuthBroken(params: {
  adsOk: boolean;
  merchantOk: boolean;
  failures: string[];
}): Promise<{ sent: boolean; reason?: string }> {
  const text = [
    ":rotating_light: *Google auth BROKEN — ads pipeline halted*",
    `• Ads API: ${params.adsOk ? "ok" : "FAILED"}`,
    `• Merchant API: ${params.merchantOk ? "ok" : "FAILED"}`,
    `• details: ${params.failures.join(" | ").slice(0, 400)}`,
    `• at: ${new Date().toISOString()}`,
    "",
    "Explorer routing is stopped until a human re-consents:",
    "  npm run ads -- auth:oauth   (then push .env to the VPS)",
    "If this repeats every ~7 days, the OAuth consent screen is still in Testing:",
    "publish it to In production at https://console.cloud.google.com/auth/audience",
  ].join("\n");
  return postSlack(text);
}
