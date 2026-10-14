#!/usr/bin/env npx tsx
/**
 * Read-only funnel report from funnel_events (Shopify custom pixel).
 *
 * Usage:
 *   npx tsx scripts/funnel-report.ts                    # last 28 days, by week
 *   npx tsx scripts/funnel-report.ts --days=14 --by=day
 *   npx tsx scripts/funnel-report.ts --all-countries    # include non-delivery countries
 *   npx tsx scripts/funnel-report.ts --include-bots     # keep webdriver / bot UA sessions
 *   npx tsx scripts/funnel-report.ts --json
 *
 * Session = session_id (sessionStorage in the pixel), fallback client_id.
 * Country = checkout shipping/localization country, else geo header country; sessions
 * with unknown country are kept, sessions in a known non-delivery country are dropped.
 */
import "dotenv/config";

import { prisma } from "../app/lib/prisma";

const DELIVERY_COUNTRIES = new Set(["CH", "FR", "DE", "AT", "ES", "IT", "NL"]);
const EXPRESS_RE = /express|priority|prioritaire|24\s?h|next.?day|same.?day|a-post/i;

const STEPS = [
  ["product_viewed", "pv"],
  ["checkout_started", "co"],
  ["contact", "contact"],
  ["address", "address"],
  ["shipping", "shipping"],
  ["payment", "payment"],
  ["completed", "completed"],
] as const;
type StepKey = (typeof STEPS)[number][1];

type SessionRow = {
  period: Date;
  device: string | null;
  country: string | null;
  ab: string | null;
  ship: string | null;
  bot: boolean;
} & Record<StepKey, boolean>;

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function shipClass(method: string | null): string {
  if (!method) return "(none)";
  return `${EXPRESS_RE.test(method) ? "express" : "standard"}: ${method.slice(0, 40)}`;
}

type Funnel = { sessions: number } & Record<StepKey, number>;

function emptyFunnel(): Funnel {
  return { sessions: 0, pv: 0, co: 0, contact: 0, address: 0, shipping: 0, payment: 0, completed: 0 };
}

function add(f: Funnel, s: SessionRow) {
  f.sessions++;
  for (const [, k] of STEPS) if (s[k]) f[k]++;
}

function pct(n: number, d: number): string {
  return d > 0 ? `${((100 * n) / d).toFixed(1)}%` : "-";
}

function printTable(title: string, groups: Map<string, Funnel>, sortByKey = false) {
  const rows = [...groups.entries()].sort((a, b) =>
    sortByKey ? a[0].localeCompare(b[0]) : b[1].sessions - a[1].sessions,
  );
  console.log(`\n== ${title}`);
  const head = ["group", "sessions", ...STEPS.map(([label]) => label), "pv→co", "co→paid", "pv→paid"];
  const body = rows.map(([g, f]) => [
    g,
    String(f.sessions),
    ...STEPS.map(([, k], i) => (i === 0 ? String(f[k]) : `${f[k]} (${pct(f[k], f[STEPS[i - 1][1]])})`)),
    pct(f.co, f.pv),
    pct(f.completed, f.co),
    pct(f.completed, f.pv),
  ]);
  const widths = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const line = (cells: string[]) => cells.map((c, i) => c.padEnd(widths[i])).join("  ");
  console.log(line(head));
  for (const r of body) console.log(line(r));
}

function groupBy(sessions: SessionRow[], key: (s: SessionRow) => string): Map<string, Funnel> {
  const out = new Map<string, Funnel>();
  for (const s of sessions) {
    const k = key(s);
    const f = out.get(k) ?? emptyFunnel();
    add(f, s);
    out.set(k, f);
  }
  return out;
}

async function main() {
  const days = Math.max(1, Number(arg("days") ?? 28));
  const by = arg("by") === "day" ? "day" : "week";
  const allCountries = arg("all-countries") === "true";
  const includeBots = arg("include-bots") === "true";
  const asJson = arg("json") === "true";
  const since = new Date(Date.now() - days * 86_400_000);

  const raw = await prisma.$queryRaw<SessionRow[]>`
    SELECT
      date_trunc(${by}::text, MIN(occurred_at) AT TIME ZONE 'Europe/Zurich') AS period,
      (array_agg(device_type ORDER BY occurred_at) FILTER (WHERE device_type IS NOT NULL))[1] AS device,
      COALESCE(
        (array_agg(country_code ORDER BY occurred_at DESC) FILTER (WHERE country_code IS NOT NULL))[1],
        (array_agg(geo_country ORDER BY occurred_at DESC) FILTER (WHERE geo_country IS NOT NULL))[1]
      ) AS country,
      (array_agg(ab_variant ORDER BY occurred_at DESC) FILTER (WHERE ab_variant IS NOT NULL))[1] AS ab,
      (array_agg(shipping_method ORDER BY occurred_at DESC) FILTER (WHERE shipping_method IS NOT NULL))[1] AS ship,
      bool_or(webdriver IS TRUE OR device_type = 'bot') AS bot,
      bool_or(event_name = 'product_viewed') AS pv,
      bool_or(event_name = 'checkout_started') AS co,
      bool_or(event_name = 'checkout_contact_info_submitted') AS contact,
      bool_or(event_name = 'checkout_address_info_submitted') AS address,
      bool_or(event_name = 'checkout_shipping_info_submitted') AS shipping,
      bool_or(event_name = 'payment_info_submitted') AS payment,
      bool_or(event_name = 'checkout_completed') AS completed
    FROM public.funnel_events
    WHERE created_at >= ${since}
      AND COALESCE(session_id, client_id) IS NOT NULL
    GROUP BY COALESCE(session_id, client_id)
  `;

  const sessions = raw.filter(
    (s) =>
      (includeBots || !s.bot) &&
      (allCountries || !s.country || DELIVERY_COUNTRIES.has(s.country)),
  );

  const alerts = await prisma.$queryRaw<{ message: string; target: string | null; n: bigint }[]>`
    SELECT alert_message AS message, alert_target AS target, COUNT(*) AS n
    FROM public.funnel_events
    WHERE created_at >= ${since}
      AND event_name = 'alert_displayed'
      AND alert_message IS NOT NULL
      AND (${includeBots}::boolean OR (webdriver IS NOT TRUE AND device_type IS DISTINCT FROM 'bot'))
    GROUP BY 1, 2
    ORDER BY n DESC
    LIMIT 15
  `;

  const periodKey = (s: SessionRow) => new Date(s.period).toISOString().slice(0, 10);
  const tables: [string, Map<string, Funnel>][] = [
    [`by ${by}`, groupBy(sessions, periodKey)],
    ["by device", groupBy(sessions, (s) => s.device ?? "(unknown)")],
    ["by country", groupBy(sessions, (s) => s.country ?? "(unknown)")],
    ["by ab variant", groupBy(sessions, (s) => s.ab ?? "(none)")],
    ["by shipping method", groupBy(sessions, (s) => shipClass(s.ship))],
  ];

  if (asJson) {
    console.log(
      JSON.stringify(
        {
          days,
          by,
          sessions: sessions.length,
          excluded: raw.length - sessions.length,
          tables: Object.fromEntries(tables.map(([t, m]) => [t, Object.fromEntries(m)])),
          alerts: alerts.map((a) => ({ ...a, n: Number(a.n) })),
        },
        null,
        2,
      ),
    );
    return;
  }

  console.log(
    `Funnel last ${days}d (since ${since.toISOString()}), sessions=${sessions.length}, excluded=${raw.length - sessions.length}` +
      ` [countries=${allCountries ? "all" : "delivery+unknown"}, bots=${includeBots ? "kept" : "dropped"}]`,
  );
  printTable("total", groupBy(sessions, () => "all"));
  printTable(tables[0][0], tables[0][1], true);
  for (const [title, m] of tables.slice(1)) printTable(title, m);

  console.log("\n== top alert_displayed");
  for (const a of alerts) console.log(`${String(a.n).padStart(6)}  ${a.target ?? "-"}  ${a.message}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
