import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  notifyGalaxusFeedFailure,
  notifyGalaxusFeedStale,
} from "@/galaxus/ops/feedFailureAlert";

describe("notifyGalaxusFeedFailure", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.stubEnv("GALAXUS_ALERT_SLACK_WEBHOOK_URL", "https://hooks.slack.com/test");
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
});
