import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Public endpoint for the Black Friday landing size click.
 * - Only touches EXISTING Klaviyo profiles. Never creates a profile, never subscribes.
 * - Refuses holds (rl_marketing_hold / rl_bf_2026_excluded) (no consent gate: sending is gated by Klaviyo itself).
 * - Saves size on the profile and fires "BFCM Registered" once (unique_id) to trigger the confirmation flow.
 */

const ALLOWED_ORIGINS = ["https://www.resell-lausanne.ch", "https://resell-lausanne.ch"];
const MAX_BODY = 4_000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 20;
const EMAIL = /^[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}$/i;
const RANGES: Record<string, string[]> = {
  "36-37.5": ["36", "36.5", "37", "37.5"],
  "38-39.5": ["38", "38.5", "39", "39.5"],
  "40-41.5": ["40", "40.5", "41", "41.5"],
  "42-43.5": ["42", "42.5", "43", "43.5"],
  "44-46": ["44", "44.5", "45", "45.5", "46"],
};
const KLAVIYO = "https://a.klaviyo.com/api";

const g = globalThis as typeof globalThis & { __bfcmRate?: Map<string, number[]> };
const rate = (g.__bfcmRate ??= new Map<string, number[]>());

function cors(origin: string | null) {
  const ok = origin && ALLOWED_ORIGINS.includes(origin);
  return {
    "Access-Control-Allow-Origin": ok ? origin : ALLOWED_ORIGINS[0],
    "Access-Control-Allow-Credentials": "true",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Accept",
    Vary: "Origin",
  };
}

function limited(key: string): boolean {
  const now = Date.now();
  const hits = (rate.get(key) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  hits.push(now);
  rate.set(key, hits);
  return hits.length > RATE_MAX;
}

function headers() {
  return {
    Authorization: `Klaviyo-API-Key ${process.env.KLAVIYO_PRIVATE_API_KEY}`,
    accept: "application/vnd.api+json",
    "content-type": "application/vnd.api+json",
    revision: "2025-10-15",
  };
}

export async function OPTIONS(req: Request) {
  return new NextResponse(null, { status: 204, headers: cors(req.headers.get("origin")) });
}

export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  const h = cors(origin);
  const reply = (body: Record<string, unknown>, status = 200) => NextResponse.json(body, { status, headers: h });

  if (!origin || !ALLOWED_ORIGINS.includes(origin)) return reply({ ok: false }, 403);
  const raw = await req.text();
  if (raw.length > MAX_BODY) return reply({ ok: false }, 413);
  let body: any;
  try {
    body = JSON.parse(raw);
  } catch {
    return reply({ ok: false }, 400);
  }

  const email = String(body?.email ?? "").trim().toLowerCase();
  const range = String(body?.size_range ?? body?.size ?? "").trim();
  const sizes = RANGES[range];
  if (!EMAIL.test(email) || !sizes) {
    // No email (anonymous visitor) or unknown range: nothing to save, not an error for the page.
    return reply({ ok: true, registered: false });
  }
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
  if (limited(`${ip}`) || limited(`e:${email}`)) return reply({ ok: false }, 429);

  try {
    const f = encodeURIComponent(`equals(email,"${email.replace(/"/g, "")}")`);
    const found = await fetch(`${KLAVIYO}/profiles/?filter=${f}&additional-fields[profile]=subscriptions`, { headers: headers() });
    if (!found.ok) {
      console.error("[bfcm/confirm] profile lookup", found.status);
      return reply({ ok: true, registered: false });
    }
    const profile = ((await found.json()).data ?? [])[0];
    if (!profile) return reply({ ok: true, registered: false });

    const props = profile.attributes.properties ?? {};
    const blocked =
      props.rl_marketing_hold === true ||
      props.rl_bf_2026_excluded === true ||
      props.rl_marketing_hold === "true" ||
      props.rl_bf_2026_excluded === "true";
    if (blocked) return reply({ ok: false, blocked: true, message: "Compte non éligible." }, 403);
    // Consent not required to store the click: Klaviyo flows/campaigns skip non-consented profiles themselves.

    const label = range.replace("-", "–");
    const first = props.rl_bf_2026_registered !== true;
    await fetch(`${KLAVIYO}/profiles/${profile.id}/`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({
        data: {
          type: "profile",
          id: profile.id,
          attributes: {
            properties: {
              rl_bf_2026_registered: true,
              rl_bf_2026_registered_at: first ? new Date().toISOString() : (props.rl_bf_2026_registered_at ?? new Date().toISOString()),
              rl_bf_2026_size_range: range,
              rl_bf_2026_sizes_eu: sizes,
              rl_bf_2026_size_label: label,
              rl_bf_2026_size_source: "landing_click",
            },
          },
        },
      }),
    });

    if (first) {
      await fetch(`${KLAVIYO}/events/`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify({
          data: {
            type: "event",
            attributes: {
              unique_id: `bf2026-registered-${profile.id}`,
              properties: { size_range: range, sizes, label },
              metric: { data: { type: "metric", attributes: { name: "BFCM Registered" } } },
              profile: { data: { type: "profile", id: profile.id } },
            },
          },
        }),
      });
    }
    return reply({ ok: true, registered: true, first });
  } catch (error) {
    console.error("[bfcm/confirm]", error instanceof Error ? error.message : error);
    // Never break the landing page UX.
    return reply({ ok: true, registered: false });
  }
}
