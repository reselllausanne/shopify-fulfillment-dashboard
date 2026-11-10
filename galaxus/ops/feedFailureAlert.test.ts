import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  notifyGalaxusFeedCrashLoop,
  notifyGalaxusFeedFailure,
  notifyGalaxusFeedStale,
  notifyGalaxusMasterSpecsFeedStale,
} from "@/galaxus/ops/feedFailureAlert";

describe("notifyGalaxusFeedFailure", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("GALAXUS_ALERT_SLACK_WEBHOOK_URL", "https://hooks.slack.com/test");
    // Keep the email fallback off unless a test opts in (local/CI env may define Postmark).
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    vi.stubEnv("POSTMARK_FROM_EMAIL", "");
    vi.stubEnv("GALAXUS_ALERT_EMAIL", "");
    vi.stubEnv("STOCKX_ALERT_EMAIL", "");
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("posts to Slack webhook", async () => {
    const calls: RequestInit[] = [];
    global.fetch = vi.fn(async (_url, init) => {
      calls.push(init ?? {});
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    const res = await notifyGalaxusFeedFailure({
      scope: "price",
      triggerSource: "shopify-post-sale",
      runId: "run-1",
      error: "SFTP timeout",
    });
    expect(res.sent).toBe(true);
    expect(calls.length).toBe(1);
    const body = JSON.parse(String(calls[0]?.body));
    expect(body.text).toContain("Galaxus feed upload FAILED");
    expect(body.text).toContain("price");
  });

  it("dedupes identical errors within 30 minutes", async () => {
    let n = 0;
    global.fetch = vi.fn(async () => {
      n += 1;
      return new Response("ok", { status: 200 });
    }) as typeof fetch;

    await notifyGalaxusFeedFailure({ scope: "stock", error: "unique-dedupe-err-xyz" });
    const second = await notifyGalaxusFeedFailure({
      scope: "stock",
      error: "unique-dedupe-err-xyz",
    });
    expect(second.sent).toBe(false);
    expect(second.reason).toBe("deduped");
    expect(n).toBe(1);
  });

  it("posts stale price feed alert", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const res = await notifyGalaxusFeedStale({
      hoursSinceSuccess: 8.5,
      lastSuccessAt: "2026-08-02T01:55:00.000Z",
    });
    expect(res.sent).toBe(true);
    const body = JSON.parse(String((global.fetch as any).mock.calls[0][1].body));
    expect(body.text).toContain("STALE");
    expect(body.text).toContain("8.5h");
  });

  it("posts stale master-specs feed alert", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const res = await notifyGalaxusMasterSpecsFeedStale({
      hoursSinceSuccess: 31,
      lastSuccessAt: "2026-09-05T01:00:00.000Z",
    });
    expect(res.sent).toBe(true);
    const body = JSON.parse(String((global.fetch as any).mock.calls[0][1].body));
    expect(body.text).toContain("master/specs");
    expect(body.text).toContain("31h");
    expect(body.text).toContain("push-master-specs");
  });

  it("falls back to Postmark email when no Slack webhook is configured", async () => {
    vi.stubEnv("GALAXUS_ALERT_SLACK_WEBHOOK_URL", "");
    vi.stubEnv("BEATBOT_ALERT_SLACK_WEBHOOK_URL", "");
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "pm-token");
    vi.stubEnv("POSTMARK_FROM_EMAIL", "from@example.com");
    vi.stubEnv("GALAXUS_ALERT_EMAIL", "ops@example.com");
    const calls: Array<{ url: string; init: RequestInit }> = [];
    global.fetch = vi.fn(async (url, init) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response("{}", { status: 200 });
    }) as typeof fetch;

    const res = await notifyGalaxusFeedFailure({ scope: "price", error: "email-fallback-err-1" });
    expect(res.sent).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.postmarkapp.com/email");
    const payload = JSON.parse(String(calls[0].init.body));
    expect(payload.To).toBe("ops@example.com");
    expect(payload.Subject).toContain("Galaxus feed upload FAILED");
  });

  it("does not claim the dedupe slot when no channel delivered (retry next tick)", async () => {
    vi.stubEnv("GALAXUS_ALERT_SLACK_WEBHOOK_URL", "");
    vi.stubEnv("BEATBOT_ALERT_SLACK_WEBHOOK_URL", "");
    vi.stubEnv("SLACK_WEBHOOK_URL", "");
    vi.stubEnv("POSTMARK_SERVER_TOKEN", "");
    vi.stubEnv("POSTMARK_FROM_EMAIL", "");
    global.fetch = vi.fn(async () => new Response("{}", { status: 200 })) as typeof fetch;

    const first = await notifyGalaxusFeedFailure({ scope: "stock", error: "no-channel-err-2" });
    expect(first.sent).toBe(false);
    expect(first.reason).toBe("no_alert_channel_configured");

    // Channel appears later: the same error must still alert (slot was not burned).
    vi.stubEnv("GALAXUS_ALERT_SLACK_WEBHOOK_URL", "https://hooks.slack.com/test");
    const second = await notifyGalaxusFeedFailure({ scope: "stock", error: "no-channel-err-2" });
    expect(second.sent).toBe(true);
  });

  it("posts crash-loop hard-stop alert", async () => {
    global.fetch = vi.fn(async () => new Response("ok", { status: 200 })) as typeof fetch;
    const res = await notifyGalaxusFeedCrashLoop({
      scope: "master-specs",
      crashCount: 4,
      windowHours: 2,
    });
    expect(res.sent).toBe(true);
    const body = JSON.parse(String((global.fetch as any).mock.calls[0][1].body));
    expect(body.text).toContain("CRASH LOOP");
    expect(body.text).toContain("master-specs");
  });
});
