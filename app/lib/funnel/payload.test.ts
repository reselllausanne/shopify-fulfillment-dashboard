import { describe, expect, it } from "vitest";
import {
  FUNNEL_MAX_EVENTS_PER_REQUEST,
  normalizeFunnelEvent,
  parseFunnelPayload,
  parseUserAgent,
  sanitizePath,
} from "./payload";

const NOW = Date.parse("2026-10-14T10:00:00.000Z");
const IPHONE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1";

function body(events: unknown[], k = "pk_test") {
  return JSON.stringify({ k, e: events });
}

describe("parseFunnelPayload", () => {
  it("rejects malformed bodies", () => {
    expect(parseFunnelPayload("", NOW)).toEqual({ ok: false, error: "empty_body" });
    expect(parseFunnelPayload("{nope", NOW)).toEqual({ ok: false, error: "invalid_json" });
    expect(parseFunnelPayload("[]", NOW)).toEqual({ ok: false, error: "invalid_payload" });
    expect(parseFunnelPayload(JSON.stringify({ e: [] }), NOW)).toEqual({
      ok: false,
      error: "missing_key",
    });
    expect(parseFunnelPayload(JSON.stringify({ k: "x", e: [] }), NOW)).toEqual({
      ok: false,
      error: "missing_events",
    });
  });

  it("rejects too many events and oversized bodies", () => {
    const many = Array.from({ length: FUNNEL_MAX_EVENTS_PER_REQUEST + 1 }, (_, i) => ({
      id: `e${i}`,
      name: "page_viewed",
    }));
    expect(parseFunnelPayload(body(many), NOW)).toEqual({ ok: false, error: "too_many_events" });
    const huge = body([{ id: "x", name: "page_viewed", productTitle: "a".repeat(70_000) }]);
    expect(parseFunnelPayload(huge, NOW)).toEqual({ ok: false, error: "body_too_large" });
  });

  it("drops unknown event names and events without id", () => {
    const res = parseFunnelPayload(
      body([
        { id: "1", name: "checkout_started" },
        { id: "2", name: "evil_event" },
        { name: "page_viewed" },
      ]),
      NOW,
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.key).toBe("pk_test");
    expect(res.events.map((e) => e.eventName)).toEqual(["checkout_started"]);
    expect(res.dropped).toBe(2);
  });
});

describe("normalizeFunnelEvent", () => {
  it("normalises a checkout_shipping_info_submitted event", () => {
    const row = normalizeFunnelEvent(
      {
        id: "sh_1",
        name: "checkout_shipping_info_submitted",
        ts: "2026-10-14T09:59:00.000Z",
        clientId: "cid",
        sessionId: "sid",
        checkoutToken: "tok",
        pagePath: "https://resell-lausanne.ch/checkouts/cn/tok/fr-ch?discount=X#top",
        referrerHost: "https://www.google.com/search?q=x",
        value: "189.9",
        currency: "chf",
        shippingMethod: "Express",
        shippingType: "shipping",
        shippingPrice: 9.9,
        countryCode: "ch",
        zipPrefix: "1003 Lausanne",
        userAgent: IPHONE_UA,
        abVariant: "B",
        itemCount: 2,
      },
      NOW,
    );
    expect(row).toMatchObject({
      eventId: "sh_1",
      occurredAt: new Date("2026-10-14T09:59:00.000Z"),
      checkoutToken: "tok",
      pagePath: "/checkouts/cn/tok/fr-ch",
      referrerHost: "www.google.com",
      value: 189.9,
      currency: "CHF",
      shippingPrice: 9.9,
      countryCode: "CH",
      zipPrefix: "10",
      deviceType: "mobile",
      os: "ios",
      browser: "safari",
      abVariant: "B",
      itemCount: 2,
    });
  });

  it("never keeps a full zip, invalid country/currency, or bad ab variant", () => {
    const row = normalizeFunnelEvent(
      {
        id: "x",
        name: "checkout_address_info_submitted",
        zipPrefix: "8001",
        countryCode: "Switzerland",
        currency: "francs",
        abVariant: "<script>",
      },
      NOW,
    );
    expect(row?.zipPrefix).toBe("80");
    expect(row?.countryCode).toBeNull();
    expect(row?.currency).toBeNull();
    expect(row?.abVariant).toBeNull();
  });

  it("falls back to server time for missing or skewed timestamps", () => {
    const future = normalizeFunnelEvent({ id: "a", name: "page_viewed", ts: "2030-01-01T00:00:00Z" }, NOW);
    const garbage = normalizeFunnelEvent({ id: "b", name: "page_viewed", ts: "yesterday" }, NOW);
    expect(future?.occurredAt.getTime()).toBe(NOW);
    expect(garbage?.occurredAt.getTime()).toBe(NOW);
  });

  it("strips PII-looking keys and nested objects from props", () => {
    const row = normalizeFunnelEvent(
      {
        id: "p",
        name: "upsell_accepted",
        props: {
          upsellVariantId: "123",
          size: "42",
          email: "a@b.ch",
          shipping_address: "Rue 1",
          nested: { a: 1 },
          sizes: ["41", "42"],
        },
      },
      NOW,
    );
    expect(row?.props).toEqual({ upsellVariantId: "123", size: "42", sizes: "41,42" });
  });

  it("flags webdriver sessions as bot", () => {
    const bot = normalizeFunnelEvent({ id: "w", name: "page_viewed", userAgent: IPHONE_UA, webdriver: true }, NOW);
    const human = normalizeFunnelEvent({ id: "h", name: "page_viewed", userAgent: IPHONE_UA, webdriver: false }, NOW);
    expect(bot).toMatchObject({ deviceType: "bot", webdriver: true, geoCountry: null });
    expect(human).toMatchObject({ deviceType: "mobile", webdriver: false });
  });

  it("rejects non-numeric money and clamps strings", () => {
    const row = normalizeFunnelEvent(
      { id: "m", name: "alert_displayed", price: "abc", value: Infinity, alertMessage: "x".repeat(1000) },
      NOW,
    );
    expect(row?.price).toBeNull();
    expect(row?.value).toBeNull();
    expect(row?.alertMessage).toHaveLength(300);
  });
});

describe("helpers", () => {
  it("sanitizePath keeps only the path", () => {
    expect(sanitizePath("/products/x?variant=1&email=a@b.ch")).toBe("/products/x");
    expect(sanitizePath("javascript:alert(1)")).toBeNull();
  });

  it("parseUserAgent detects in-app browsers and tablets", () => {
    expect(
      parseUserAgent(`${IPHONE_UA} Instagram 300.0.0.0`).browser,
    ).toBe("instagram");
    expect(
      parseUserAgent("Mozilla/5.0 (Linux; Android 13; SM-X700) AppleWebKit/537.36 Chrome/120 Safari/537.36")
        .deviceType,
    ).toBe("tablet");
    expect(
      parseUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36 Edg/120"),
    ).toEqual({ deviceType: "desktop", os: "windows", browser: "edge" });
  });
});
