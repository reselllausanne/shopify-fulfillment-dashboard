"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ShopRow = {
  key: string;
  code: string;
  name: string;
  baseUrl: string;
  currency: string;
  gated: boolean;
  withGtin: number;
  inStock: number;
  running: boolean;
  lastRun: {
    status: string;
    startedAt: string;
    finishedAt: string | null;
    productsListed: number;
    variantsUpserted: number;
    withGtin: number;
    errors: number;
    message: string | null;
  } | null;
};

type Overview = {
  ok: boolean;
  configured: boolean;
  message?: string;
  totals?: { shops: number; withGtin: number; inStock: number; running: number; inFeed: number };
  shops?: ShopRow[];
  generatedAt?: string;
};

const nf = new Intl.NumberFormat("en-US");
const fmtNum = (n: number | null | undefined) => (n == null ? "—" : nf.format(n));

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "never";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "never";
  return d.toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: string }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${accent || "text-slate-900"}`}>{value}</div>
    </div>
  );
}

export default function ScraperPage() {
  const [ov, setOv] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await fetch("/api/scraper/overview", { cache: "no-store" });
      const json = (await res.json()) as Overview;
      if (!res.ok || json.ok === false) throw new Error((json as any)?.error || `HTTP ${res.status}`);
      setOv(json);
    } catch (e: any) {
      setError(e?.message || "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // Auto-poll while any shop is scraping.
  useEffect(() => {
    const running = (ov?.totals?.running ?? 0) > 0;
    if (running && !pollRef.current) {
      pollRef.current = setInterval(load, 5000);
    } else if (!running && pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [ov?.totals?.running, load]);

  const scrape = useCallback(
    async (shopKey?: string) => {
      setBusy(shopKey || "all");
      setError(null);
      try {
        const qs = shopKey ? `?shop=${encodeURIComponent(shopKey)}` : "";
        const res = await fetch(`/api/scraper/scrape${qs}`, { method: "POST" });
        const json = await res.json();
        if (!res.ok || json.ok === false) throw new Error(json.error || `HTTP ${res.status}`);
        await load();
      } catch (e: any) {
        setError(e?.message || "Scrape failed");
      } finally {
        setBusy(null);
      }
    },
    [load]
  );

  const configured = ov?.configured !== false;
  const shops = ov?.shops || [];
  const totals = ov?.totals;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="mx-auto max-w-6xl px-6 py-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-slate-900">Scraped Websites</h1>
            <p className="mt-1 text-sm text-slate-500">
              Shopify catalogs scraped into the main product DB (inspect on the Galaxus pricing page).
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => load()}
              disabled={loading}
              className="rounded-lg border border-slate-300 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            >
              Refresh stats
            </button>
            {configured && shops.length > 0 ? (
              <button
                onClick={() => scrape()}
                disabled={busy !== null}
                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-50"
              >
                {busy === "all" ? "Starting…" : "Scrape all"}
              </button>
            ) : null}
          </div>
        </div>

        {ov?.generatedAt ? (
          <div className="mt-1 text-xs text-slate-400">Updated {fmtDate(ov.generatedAt)}</div>
        ) : null}

        {error ? (
          <div className="mt-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">{error}</div>
        ) : null}

        {!configured ? (
          <div className="mt-6 rounded-xl border border-amber-200 bg-amber-50 p-6 text-sm text-amber-800">
            <div className="text-base font-semibold">No websites configured</div>
            <p className="mt-2 max-w-2xl">{ov?.message}</p>
            <pre className="mt-3 overflow-auto rounded-lg bg-amber-100/60 p-3 text-xs">
{`# .env — comma-separated  KEY|Name|baseUrl   (KEY = 3 letters)
SCRAPER_SHOPS=WEL|WellPlayed|https://www.wellplayed.ch`}
            </pre>
          </div>
        ) : null}

        {configured ? (
          <>
            <div className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              <StatCard label="Websites" value={fmtNum(totals?.shops)} />
              <StatCard label="GTIN variants" value={fmtNum(totals?.withGtin)} accent="text-emerald-600" />
              <StatCard label="In stock" value={fmtNum(totals?.inStock)} />
              <StatCard label="Scraping now" value={fmtNum(totals?.running)} accent={totals?.running ? "text-sky-600" : undefined} />
            </div>

            <div className="mt-6 space-y-3">
              {loading && shops.length === 0 ? (
                <div className="rounded-xl border border-slate-200 bg-white p-6 text-sm text-slate-400">Loading…</div>
              ) : null}

              {shops.map((s) => {
                const running = s.running || busy === s.key;
                return (
                  <div
                    key={s.key}
                    className="flex flex-col gap-4 rounded-xl border border-slate-200 bg-white p-4 shadow-sm md:flex-row md:items-center md:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-slate-900">{s.name}</span>
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                          {s.code}
                        </span>
                        {s.gated ? (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500 ring-1 ring-inset ring-slate-500/20">
                            Gated · not sent to Galaxus
                          </span>
                        ) : (
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-medium text-emerald-700 ring-1 ring-inset ring-emerald-600/20">
                            In Galaxus feed
                          </span>
                        )}
                      </div>
                      <a
                        href={s.baseUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-0.5 block truncate text-xs text-slate-400 hover:text-slate-600 hover:underline"
                      >
                        {s.baseUrl}
                      </a>
                    </div>

                    <div className="flex items-center gap-6">
                      <div className="text-center">
                        <div className="text-lg font-semibold text-emerald-600">{fmtNum(s.withGtin)}</div>
                        <div className="text-[11px] text-slate-500">GTIN variants</div>
                      </div>
                      <div className="text-center">
                        <div className="text-lg font-semibold text-slate-900">{fmtNum(s.inStock)}</div>
                        <div className="text-[11px] text-slate-500">in stock</div>
                      </div>
                      <div className="min-w-[130px] text-center">
                        {running ? (
                          <div className="inline-flex items-center gap-1.5 text-sm font-medium text-sky-600">
                            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-500" />
                            scraping…
                          </div>
                        ) : (
                          <div
                            className={`text-sm font-medium ${
                              s.lastRun?.status === "error" ? "text-rose-600" : "text-slate-700"
                            }`}
                          >
                            {s.lastRun?.status === "error" ? "last run failed" : fmtDate(s.lastRun?.finishedAt)}
                          </div>
                        )}
                        <div className="text-[11px] text-slate-400">last scrape</div>
                      </div>
                    </div>

                    <button
                      onClick={() => scrape(s.key)}
                      disabled={busy !== null || running}
                      className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-700 disabled:opacity-40 md:w-28"
                    >
                      {running ? "Running" : "Scrape"}
                    </button>
                  </div>
                );
              })}
            </div>

            {shops.some((s) => s.lastRun?.status === "error") ? (
              <div className="mt-4 space-y-1 text-xs text-rose-600">
                {shops
                  .filter((s) => s.lastRun?.status === "error")
                  .map((s) => (
                    <div key={s.key}>
                      <span className="font-medium">{s.name}:</span> {s.lastRun?.message}
                    </div>
                  ))}
              </div>
            ) : null}
          </>
        ) : null}
      </div>
    </div>
  );
}
