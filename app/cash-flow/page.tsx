"use client";

import { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { getJson } from "@/app/lib/api";
import { formatMoneyCHF } from "@/app/utils/numbers";

type ChannelKey = "SHOPIFY" | "GALAXUS" | "DECATHLON";

type LedgerRow = {
  date: string;
  openingBalance: number;
  cashIn: number;
  cashOut: number;
  closingBalance: number;
  isForecast: boolean;
};

type LedgerResponse = {
  rows: LedgerRow[];
  kpis: {
    minBalance: number;
    currentBalance: number;
    projectedBalance: number;
  };
  confidenceByChannel: Record<ChannelKey, { observedDays: number; level: string }>;
  assumptionsUsed: Array<{
    channel: ChannelKey;
    mode: string;
    expectedDailySales: number;
    expectedDailyOrders: number | null;
    growthRatePct: number;
    payoutDelayDays: number | null;
    commissionRatePct: number;
    refundRatePct: number;
    observedDays: number;
    confidence: string;
    forecastSource: string;
  }>;
  warnings: string[];
  forecastBreakdown: {
    cashInByChannel: Record<ChannelKey, number>;
    cashOut: {
      COGS: number;
      ADS: number;
      SHIPPING: number;
      OWNER_DRAW: number;
      FIXED: number;
    };
  };
  metadata: {
    startDate: string;
    endDate: string;
    projectionEnd: string;
    scenario: string;
    timezone: string;
    channels: ChannelKey[];
    observedWindowDays?: number;
    observedWindowStart?: string;
    observedWindowEnd?: string;
  };
};

const CHANNEL_OPTIONS: { key: ChannelKey; label: string }[] = [
  { key: "SHOPIFY", label: "Shopify" },
  { key: "GALAXUS", label: "Galaxus" },
  { key: "DECATHLON", label: "Decathlon" },
];

const SCENARIO_OPTIONS = [
  { key: "base", label: "Base" },
  { key: "conservative", label: "Conservative" },
  { key: "growth", label: "Growth" },
];

type ForecastAssumption = {
  channel: ChannelKey;
  mode: "AUTO" | "MANUAL" | "HYBRID";
  expectedDailySales: number;
  expectedDailyOrders: number | null;
  growthRatePct: number;
  payoutDelayDays: number | null;
  commissionRatePct: number;
  refundRatePct: number;
};

export default function CashFlowPage() {
  const [range, setRange] = useState(30);
  const [projection, setProjection] = useState(30);
  const [scenario, setScenario] = useState("conservative");
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>([
    "SHOPIFY",
    "GALAXUS",
    "DECATHLON",
  ]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [assumptions, setAssumptions] = useState<ForecastAssumption[]>([]);
  const [savingChannel, setSavingChannel] = useState<ChannelKey | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncStartDate, setSyncStartDate] = useState(() => {
    const now = new Date();
    const year = now.getFullYear();
    return `${year}-01-01`;
  });

  const queryString = useMemo(() => {
    const params = new URLSearchParams();
    params.set("range", String(range));
    params.set("projection", String(projection));
    params.set("scenario", scenario);
    selectedChannels.forEach((channel) => params.append("channels", channel));
    return params.toString();
  }, [range, projection, scenario, selectedChannels]);

  const fetchLedger = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getJson<LedgerResponse>(`/api/cashflow/ledger?${queryString}`);
      if (!response.ok) {
        const payload: any = response.data;
        setError(payload?.details || payload?.error || "Failed to load cashflow");
        return;
      }
      setData(response.data);
    } catch (err: any) {
      setError(err.message || "Failed to load cashflow");
    } finally {
      setLoading(false);
    }
  };

  const fetchAssumptions = async () => {
    const response = await getJson<{ items: ForecastAssumption[] }>("/api/cashflow/assumptions");
    if (response.ok) {
      const items = response.data.items ?? [];
      const sorted = [...items].sort((a, b) => a.channel.localeCompare(b.channel));
      setAssumptions(sorted);
    }
  };

  useEffect(() => {
    fetchLedger();
    fetchAssumptions();
  }, [queryString]);

  const chartRows = data?.rows ?? [];
  const chartData = useMemo(
    () =>
      chartRows.map((row) => ({
        date: row.date,
        actualBalance: row.isForecast ? null : row.closingBalance,
        forecastBalance: row.isForecast ? row.closingBalance : null,
        cashIn: row.cashIn,
        cashOut: row.cashOut,
      })),
    [chartRows]
  );
  const minBalance = data?.kpis.minBalance ?? 0;
  const currentBalance = data?.kpis.currentBalance ?? 0;
  const projectedBalance = data?.kpis.projectedBalance ?? 0;
  const warnings = data?.warnings ?? [];
  const confidenceRows = data?.assumptionsUsed ?? [];
  const breakdown = data?.forecastBreakdown;
  const assumptionsUsedMap = useMemo(
    () => new Map(confidenceRows.map((row) => [row.channel, row])),
    [confidenceRows]
  );

  const toggleChannel = (channel: ChannelKey) => {
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
  };

  const updateAssumption = <K extends keyof ForecastAssumption>(
    channel: ChannelKey,
    field: K,
    value: ForecastAssumption[K]
  ) => {
    setAssumptions((prev) =>
      prev.map((item) =>
        item.channel === channel
          ? {
              ...item,
              [field]: value,
            }
          : item
      )
    );
  };

  const saveAssumption = async (channel: ChannelKey) => {
    const item = assumptions.find((row) => row.channel === channel);
    if (!item) return;
    setSavingChannel(channel);
    const updateResponse = await fetch("/api/cashflow/assumptions", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ items: [item] }),
    });
    if (updateResponse.ok) {
      await fetchLedger();
      const updated = await updateResponse.json();
      if (updated?.items) {
        setAssumptions(updated.items);
      }
    }
    setSavingChannel(null);
  };

  const syncShopifyOrders = async () => {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const response = await fetch("/api/sync/shopify-orders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ startDate: syncStartDate || undefined }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        setSyncMessage(payload?.details || payload?.error || "Sync failed");
        return;
      }
      setSyncMessage(payload?.message || "Sync complete");
      await fetchLedger();
    } catch (err: any) {
      setSyncMessage(err?.message || "Sync failed");
    } finally {
      setSyncing(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading cashflow data...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Cash Flow</h1>
          <p className="text-gray-600">
            Timing view: when money actually lands versus when orders happen.
          </p>

          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              Orders
            </a>
            <a
              href="/dashboard"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              Dashboard
            </a>
            <a
              href="/financial"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              Financial
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-emerald-100 rounded-md">
              Cash Flow (Current)
            </span>
          </nav>
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Minimum Balance</div>
            <div className="text-2xl font-bold text-red-600">
              {formatMoneyCHF(minBalance)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Most important KPI</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Current Balance</div>
            <div className="text-2xl font-bold text-gray-900">
              {formatMoneyCHF(currentBalance)}
            </div>
            <div className="text-xs text-gray-500 mt-1">End of actual range</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">
              Projected Balance ({projection}d)
            </div>
            <div className="text-2xl font-bold text-emerald-600">
              {formatMoneyCHF(projectedBalance)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Scenario: {scenario}</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Timezone</div>
            <div className="text-2xl font-bold text-gray-900">
              {data?.metadata.timezone ?? "Europe/Zurich"}
            </div>
            <div className="text-xs text-gray-500 mt-1">Cash timing reference</div>
          </div>
        </div>

        {warnings.length > 0 && (
          <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-900">
            {warnings[0]}
          </div>
        )}

        <div className="mb-2 rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-sm text-gray-700">
          <span className="font-medium text-gray-900">What “observed days” means: </span>
          For each channel we count{" "}
          <strong>distinct calendar days (Europe/Zurich) with at least one sale and a positive amount</strong>{" "}
          in the trailing window below — not “days since January”, not your chart range, and not days with zero
          net/total in the database.
          {data?.metadata.observedWindowStart && data?.metadata.observedWindowEnd ? (
            <span className="block mt-1 text-gray-600">
              History window: {data.metadata.observedWindowStart} → {data.metadata.observedWindowEnd}
              {data.metadata.observedWindowDays != null
                ? ` (${data.metadata.observedWindowDays} days)`
                : ""}
              .
            </span>
          ) : null}
        </div>

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          {confidenceRows.map((row) => (
            <div key={row.channel} className="bg-white p-4 rounded-lg shadow">
              <div className="text-sm font-medium text-gray-500">{row.channel}</div>
              <div className="text-2xl font-bold text-gray-900">
                {row.observedDays} days with sales
              </div>
              <div className="text-xs text-gray-500 mt-1">
                Confidence: {row.confidence} • Forecast source: {row.forecastSource}
              </div>
            </div>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                range === d
                  ? "bg-emerald-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              Last {d} days
            </button>
          ))}

          <div className="ml-auto flex flex-wrap items-center gap-3">
            <select
              value={projection}
              onChange={(event) => setProjection(Number(event.target.value))}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {[30, 60, 90].map((value) => (
                <option key={value} value={value}>
                  Projection {value}d
                </option>
              ))}
            </select>
            <select
              value={scenario}
              onChange={(event) => setScenario(event.target.value)}
              className="border border-gray-300 rounded-md px-3 py-2 text-sm"
            >
              {SCENARIO_OPTIONS.map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-gray-700">Channels</span>
          {CHANNEL_OPTIONS.map((option) => (
            <label key={option.key} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={selectedChannels.includes(option.key)}
                onChange={() => toggleChannel(option.key)}
              />
              {option.label}
            </label>
          ))}
        </div>

        <div className="mb-6 flex flex-wrap items-center gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3">
          <span className="text-sm font-medium text-gray-700">Sync Shopify Orders</span>
          <input
            type="date"
            value={syncStartDate}
            onChange={(event) => setSyncStartDate(event.target.value)}
            className="border border-gray-300 rounded-md px-2 py-1 text-sm"
          />
          <button
            onClick={syncShopifyOrders}
            disabled={syncing}
            className="px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-50"
          >
            {syncing ? "Syncing..." : "Sync Shopify Orders"}
          </button>
          <span className="text-xs text-gray-500">
            Saves Shopify orders into `ShopifyOrder` for cashflow.
          </span>
          {syncMessage && <span className="text-xs text-gray-600">{syncMessage}</span>}
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Cash Balance Over Time</h2>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: any) => formatMoneyCHF(value)} />
              <Legend />
              <Line
                type="monotone"
                dataKey="actualBalance"
                name="Actual Balance"
                stroke="#0f172a"
                strokeWidth={3}
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="forecastBalance"
                name="Forecast Balance"
                stroke="#0f172a"
                strokeWidth={3}
                strokeDasharray="6 6"
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {breakdown && (
          <div className="bg-white p-6 rounded-lg shadow mb-8">
            <h2 className="text-xl font-bold text-gray-900 mb-4">
              Forecast Breakdown (Projection Period)
            </h2>
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Cash In · Shopify</div>
                <div className="text-xl font-semibold text-gray-900">
                  {formatMoneyCHF(breakdown.cashInByChannel.SHOPIFY)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Cash In · Galaxus</div>
                <div className="text-xl font-semibold text-gray-900">
                  {formatMoneyCHF(breakdown.cashInByChannel.GALAXUS)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Cash In · Decathlon</div>
                <div className="text-xl font-semibold text-gray-900">
                  {formatMoneyCHF(breakdown.cashInByChannel.DECATHLON)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected COGS Out</div>
                <div className="text-xl font-semibold text-red-600">
                  {formatMoneyCHF(breakdown.cashOut.COGS)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Ads Out</div>
                <div className="text-xl font-semibold text-red-600">
                  {formatMoneyCHF(breakdown.cashOut.ADS)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Fixed Expenses</div>
                <div className="text-xl font-semibold text-red-600">
                  {formatMoneyCHF(breakdown.cashOut.FIXED)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Owner Draw</div>
                <div className="text-xl font-semibold text-red-600">
                  {formatMoneyCHF(breakdown.cashOut.OWNER_DRAW)}
                </div>
              </div>
              <div className="rounded-lg border border-gray-200 p-4">
                <div className="text-sm text-gray-500">Projected Shipping Out</div>
                <div className="text-xl font-semibold text-red-600">
                  {formatMoneyCHF(breakdown.cashOut.SHIPPING)}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-xl font-bold text-gray-900">Forecast Assumptions</h2>
              <p className="text-sm text-gray-500">
                Edit per-channel assumptions to control the forecast instantly.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Channel
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Mode
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Expected Daily Sales
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Daily Orders
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Growth %
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Payout Delay (days)
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Commission %
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Refund %
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Observed Days
                  </th>
                  <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">
                    Confidence
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">
                    Save
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assumptions.map((row) => {
                  const used = assumptionsUsedMap.get(row.channel);
                  return (
                    <tr key={row.channel}>
                      <td className="px-3 py-2 text-sm font-medium text-gray-900">
                        {row.channel}
                      </td>
                      <td className="px-3 py-2 text-sm">
                        <select
                          value={row.mode}
                          onChange={(event) =>
                            updateAssumption(row.channel, "mode", event.target.value as ForecastAssumption["mode"])
                          }
                          className="border border-gray-300 rounded-md px-2 py-1 text-sm"
                        >
                          <option value="AUTO">Auto</option>
                          <option value="MANUAL">Manual</option>
                          <option value="HYBRID">Hybrid</option>
                        </select>
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-28 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.expectedDailySales ?? 0}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "expectedDailySales",
                              Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          className="w-24 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.expectedDailyOrders ?? ""}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "expectedDailyOrders",
                              event.target.value === "" ? null : Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.growthRatePct ?? 0}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "growthRatePct",
                              Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          step="0.1"
                          className="w-24 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.payoutDelayDays ?? ""}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "payoutDelayDays",
                              event.target.value === "" ? null : Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.commissionRatePct ?? 0}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "commissionRatePct",
                              Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <input
                          type="number"
                          step="0.01"
                          className="w-20 border border-gray-300 rounded-md px-2 py-1 text-sm text-right"
                          value={row.refundRatePct ?? 0}
                          onChange={(event) =>
                            updateAssumption(
                              row.channel,
                              "refundRatePct",
                              Number(event.target.value)
                            )
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-sm text-right text-gray-700">
                        {used?.observedDays ?? 0}
                      </td>
                      <td className="px-3 py-2 text-sm text-gray-700">
                        {used?.confidence ?? "-"}
                      </td>
                      <td className="px-3 py-2 text-sm text-right">
                        <button
                          onClick={() => saveAssumption(row.channel)}
                          className="px-3 py-1 rounded-md bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 disabled:opacity-50"
                          disabled={savingChannel === row.channel}
                        >
                          {savingChannel === row.channel ? "Saving..." : "Save"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Daily Cash Ledger</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Date
                  </th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                    Type
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Opening
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Cash In
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Cash Out
                  </th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                    Closing
                  </th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {chartRows.map((row) => (
                  <tr key={row.date} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                      {row.date}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                      {row.isForecast ? "Forecast" : "Actual"}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                      {formatMoneyCHF(row.openingBalance)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-emerald-600">
                      {formatMoneyCHF(row.cashIn)}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-red-600">
                      {formatMoneyCHF(row.cashOut)}
                    </td>
                    <td
                      className={`px-4 py-3 whitespace-nowrap text-sm text-right font-medium ${
                        row.closingBalance < 0 ? "text-red-600" : "text-gray-900"
                      }`}
                    >
                      {formatMoneyCHF(row.closingBalance)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-900">
          <div className="font-semibold mb-2">Assumptions</div>
          <ul className="list-disc ml-5 space-y-1">
            <li>Shopify payout timing uses payment gateway names; missing gateways fall back to Shopify Payments.</li>
            <li>COGS timing uses same-day outflow unless you configure a rule.</li>
            <li>Shipping costs are spread evenly across the month of recorded variable costs.</li>
            <li>Owner draw defaults to 400 CHF weekly (Friday) if not configured.</li>
            <li>Forecasts use per-channel mode (auto/manual/hybrid) and your saved assumptions.</li>
            <li>Conservative scenario blocks positive growth and scales daily sales down.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
