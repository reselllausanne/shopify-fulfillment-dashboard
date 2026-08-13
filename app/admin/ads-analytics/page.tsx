"use client";

import { useEffect, useMemo, useState } from "react";

type Step = {
  step: string;
  count: number;
  pctOfPrevious: number | null;
  pctOfTotal: number | null;
  impressions: number;
  clicks: number;
  spendChf: number;
  conversions: number;
  valueChf: number;
  roas: number | null;
};

type ReportPayload = {
  ok: boolean;
  days: number;
  granularity: "offer" | "variant" | "model";
  inventoryMeta: { lastInventorySyncAt: string | null; stale: boolean };
  funnel: {
    periods: { current: { start: string; end: string }; prior: { start: string; end: string }; yoy: { start: string; end: string } };
    current: {
      totals: {
        entities: number;
        targeted: number;
        notTargeted: number;
        unmapped: number;
        impressions: number;
        clicks: number;
        spendChf: number;
        conversions: number;
        valueChf: number;
        roas: number | null;
        ctr: number | null;
        cpc: number | null;
        cvr: number | null;
        aov: number | null;
        grossAdContributionChf: number;
      };
      steps: Step[];
      concentration: Record<string, Record<string, number>>;
      zombieReadiness: Record<string, Record<string, number>>;
      economicSegments: Record<string, Record<string, number> | string>;
      distributions: Record<string, Record<string, number>>;
    };
    prior: { totals: { roas: number | null; spendChf: number; valueChf: number; conversions: number } };
    yoy: { totals: { roas: number | null; spendChf: number; valueChf: number; conversions: number } };
  };
};

const TABS = [
  "Overview",
  "Inventory Funnel",
  "Performance Funnel",
  "ROAS Diagnosis",
  "Campaigns",
  "Models",
  "Data Quality",
] as const;

function fmtNumber(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-CH").format(value);
}

function fmtMoney(value: number | null | undefined): string {
  if (value == null) return "—";
  return new Intl.NumberFormat("fr-CH", { style: "currency", currency: "CHF", maximumFractionDigits: 2 }).format(value);
}

function fmtPct(value: number | null | undefined): string {
  if (value == null) return "—";
  return `${value.toFixed(2)}%`;
}

export default function AdsAnalyticsAdminPage() {
  const [days, setDays] = useState(30);
  const [granularity, setGranularity] = useState<"offer" | "variant" | "model">("model");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ReportPayload | null>(null);

  useEffect(() => {
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch(`/api/ads-analytics/report?days=${days}&granularity=${granularity}`, {
          cache: "no-store",
        });
        const json = (await res.json()) as ReportPayload;
        if (!res.ok || !json.ok) throw new Error("Chargement impossible");
        setData(json);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    };
    void run();
  }, [days, granularity]);

  const csvUrl = useMemo(
    () => `/api/ads-analytics/report?days=${days}&granularity=${granularity}&format=csv`,
    [days, granularity]
  );

  return (
    <main className="min-h-screen bg-slate-50 p-6">
      <div className="mx-auto max-w-7xl space-y-6">
        <header className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h1 className="text-2xl font-bold text-slate-900">Ads Analytics</h1>
          <p className="mt-1 text-sm text-slate-600">
            Read-only funnel Google Shopping/PMax. Source DB snapshot + ads_product_daily.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            {[7, 14, 30, 60, 90].map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDays(d)}
                className={`rounded-md px-3 py-1.5 text-sm ${days === d ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`}
              >
                {d}d
              </button>
            ))}
            {(["offer", "variant", "model"] as const).map((g) => (
              <button
                key={g}
                type="button"
                onClick={() => setGranularity(g)}
                className={`rounded-md px-3 py-1.5 text-sm ${granularity === g ? "bg-blue-700 text-white" : "bg-blue-100 text-blue-800"}`}
              >
                {g}
              </button>
            ))}
            <a href={csvUrl} className="rounded-md bg-emerald-600 px-3 py-1.5 text-sm text-white">
              Export CSV
            </a>
          </div>
          <div className="mt-3 text-xs text-slate-500">
            Last inventory sync: {data?.inventoryMeta.lastInventorySyncAt ? new Date(data.inventoryMeta.lastInventorySyncAt).toLocaleString("fr-CH") : "—"}
            {" · "}
            Status: {data?.inventoryMeta.stale ? <span className="font-semibold text-amber-700">STALE</span> : <span className="font-semibold text-emerald-700">FRESH</span>}
          </div>
        </header>

        <nav className="flex flex-wrap gap-2">
          {TABS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => setTab(name)}
              className={`rounded-md px-3 py-1.5 text-sm ${tab === name ? "bg-slate-900 text-white" : "bg-slate-200 text-slate-700"}`}
            >
              {name}
            </button>
          ))}
        </nav>

        {loading && <section className="rounded-xl border border-slate-200 bg-white p-6">Loading…</section>}
        {error && <section className="rounded-xl border border-red-200 bg-red-50 p-6 text-red-800">{error}</section>}
        {!loading && !error && data && (
          <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            {(tab === "Overview" || tab === "Data Quality") && (
              <div className="grid gap-3 md:grid-cols-3">
                <Card label="Entities" value={fmtNumber(data.funnel.current.totals.entities)} />
                <Card label="Targeted" value={fmtNumber(data.funnel.current.totals.targeted)} />
                <Card label="Not targeted" value={fmtNumber(data.funnel.current.totals.notTargeted)} />
                <Card label="Unmapped" value={fmtNumber(data.funnel.current.totals.unmapped)} />
                <Card label="Spend" value={fmtMoney(data.funnel.current.totals.spendChf)} />
                <Card label="Value" value={fmtMoney(data.funnel.current.totals.valueChf)} />
                <Card label="ROAS" value={fmtNumber(data.funnel.current.totals.roas)} />
                <Card label="CTR" value={fmtPct(data.funnel.current.totals.ctr)} />
                <Card label="CVR" value={fmtPct(data.funnel.current.totals.cvr)} />
              </div>
            )}

            {(tab === "Inventory Funnel" || tab === "Performance Funnel") && (
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="border-b bg-slate-100 text-left text-slate-700">
                    <tr>
                      <th className="px-2 py-2">Step</th>
                      <th className="px-2 py-2">Count</th>
                      <th className="px-2 py-2">% prev</th>
                      <th className="px-2 py-2">% total</th>
                      <th className="px-2 py-2">Spend</th>
                      <th className="px-2 py-2">Value</th>
                      <th className="px-2 py-2">ROAS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.funnel.current.steps.map((s) => (
                      <tr key={s.step} className="border-b">
                        <td className="px-2 py-2">{s.step}</td>
                        <td className="px-2 py-2">{fmtNumber(s.count)}</td>
                        <td className="px-2 py-2">{fmtPct(s.pctOfPrevious)}</td>
                        <td className="px-2 py-2">{fmtPct(s.pctOfTotal)}</td>
                        <td className="px-2 py-2">{fmtMoney(s.spendChf)}</td>
                        <td className="px-2 py-2">{fmtMoney(s.valueChf)}</td>
                        <td className="px-2 py-2">{fmtNumber(s.roas)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {tab === "ROAS Diagnosis" && (
              <div className="grid gap-3 md:grid-cols-3">
                <Card label="Current ROAS" value={fmtNumber(data.funnel.current.totals.roas)} />
                <Card label="Prior ROAS" value={fmtNumber(data.funnel.prior.totals.roas)} />
                <Card label="YoY ROAS" value={fmtNumber(data.funnel.yoy.totals.roas)} />
                <Card label="Current Spend" value={fmtMoney(data.funnel.current.totals.spendChf)} />
                <Card label="Prior Spend" value={fmtMoney(data.funnel.prior.totals.spendChf)} />
                <Card label="YoY Spend" value={fmtMoney(data.funnel.yoy.totals.spendChf)} />
              </div>
            )}

            {(tab === "Campaigns" || tab === "Models") && (
              <pre className="overflow-x-auto rounded bg-slate-100 p-3 text-xs">
                {JSON.stringify(
                  {
                    concentration: data.funnel.current.concentration,
                    economicSegments: data.funnel.current.economicSegments,
                    zombieReadiness: data.funnel.current.zombieReadiness,
                    distributions: data.funnel.current.distributions,
                  },
                  null,
                  2
                )}
              </pre>
            )}
          </section>
        )}
      </div>
    </main>
  );
}

function Card({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-lg font-semibold text-slate-900">{value}</p>
    </div>
  );
}
