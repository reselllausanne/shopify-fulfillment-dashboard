"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
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
};

type LedgerKpis = {
  minBalance: number;
  currentBalance: number;
  projectedBalance: number;
  minBalanceDate?: string;
  startingBalanceUsed?: number;
};

type LedgerMetadata = {
  startDate: string;
  endDate: string;
  projectionEnd: string;
  timezone: string;
  channels: ChannelKey[];
  sourceLayer?: string;
  eventCount?: number;
  lowConfidenceEventCount?: number;
  manualLinkedEventCount?: number;
  isEmpty?: boolean;
};

type LedgerResponse = {
  rows: LedgerRow[];
  kpis: LedgerKpis;
  metadata: LedgerMetadata;
};

const CHANNEL_OPTIONS: { key: ChannelKey; label: string }[] = [
  { key: "SHOPIFY", label: "Shopify" },
  { key: "GALAXUS", label: "Galaxus" },
  { key: "DECATHLON", label: "Decathlon" },
];

export default function CashFlowPage() {
  const [range, setRange] = useState(30);
  const [selectedChannels, setSelectedChannels] = useState<ChannelKey[]>([
    "SHOPIFY",
    "GALAXUS",
    "DECATHLON",
  ]);
  const [ledgerSource, setLedgerSource] = useState<"expected" | "legacy">("expected");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LedgerResponse | null>(null);
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
    selectedChannels.forEach((channel) => params.append("channels", channel));
    return params.toString();
  }, [range, selectedChannels]);

  const fetchLedger = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const url =
        ledgerSource === "expected"
          ? `/api/finance/cash-ledger-expected?${queryString}`
          : `/api/cashflow/ledger?${queryString}`;
      const response = await getJson<LedgerResponse>(url);
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
  }, [queryString, ledgerSource]);

  useEffect(() => {
    fetchLedger();
  }, [fetchLedger]);

  const chartRows = data?.rows ?? [];
  const minBalance = data?.kpis.minBalance ?? 0;
  const minBalanceDate = data?.kpis.minBalanceDate;
  const currentBalance = data?.kpis.currentBalance ?? 0;
  const projectedBalance = data?.kpis.projectedBalance ?? currentBalance;
  const startingUsed = data?.kpis.startingBalanceUsed;
  const meta = data?.metadata;

  const toggleChannel = (channel: ChannelKey) => {
    setSelectedChannels((prev) =>
      prev.includes(channel) ? prev.filter((c) => c !== channel) : [...prev, channel]
    );
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
            Treasury view built from expected cash events (canonical) or legacy direct calculation.
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
            <a
              href="/finance/admin"
              className="px-4 py-2 bg-slate-800 text-white rounded-md hover:bg-slate-900 transition-colors font-medium"
            >
              Finance admin
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-emerald-100 rounded-md">
              Cash Flow
            </span>
          </nav>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setLedgerSource("expected")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              ledgerSource === "expected"
                ? "bg-emerald-700 text-white"
                : "bg-white border border-gray-300 text-gray-700"
            }`}
          >
            Expected cash (ExpectedCashEvent)
          </button>
          <button
            type="button"
            onClick={() => setLedgerSource("legacy")}
            className={`px-4 py-2 rounded-md text-sm font-medium ${
              ledgerSource === "legacy"
                ? "bg-emerald-700 text-white"
                : "bg-white border border-gray-300 text-gray-700"
            }`}
          >
            Legacy ledger
          </button>
        </div>

        {ledgerSource === "expected" && meta?.isEmpty && (
          <div className="mb-4 p-4 rounded-lg border border-amber-300 bg-amber-50 text-amber-950 text-sm">
            No expected cash events in this range. Open{" "}
            <a href="/finance/admin" className="underline font-medium">
              Finance admin
            </a>{" "}
            → Materialize operating events, then Generate expected cash events.
          </div>
        )}

        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-2 xl:grid-cols-4">
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Starting balance (config)</div>
            <div className="text-2xl font-bold text-gray-900">
              {formatMoneyCHF(startingUsed ?? chartRows[0]?.openingBalance ?? 0)}
            </div>
            <div className="text-xs text-gray-500 mt-1">From CashFlowConfig</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Lowest cash point</div>
            <div className="text-2xl font-bold text-red-600">{formatMoneyCHF(minBalance)}</div>
            <div className="text-xs text-gray-500 mt-1">
              {minBalanceDate ? `on ${minBalanceDate}` : "—"}
            </div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Ending balance (range)</div>
            <div className="text-2xl font-bold text-gray-900">
              {formatMoneyCHF(projectedBalance)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Last day in table</div>
          </div>
          <div className="bg-white p-4 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Data layer</div>
            <div className="text-lg font-bold text-gray-900">
              {meta?.sourceLayer ?? "Legacy"}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {ledgerSource === "expected" && meta
                ? `${meta.eventCount ?? 0} events · ${meta.lowConfidenceEventCount ?? 0} low confidence · ${meta.manualLinkedEventCount ?? 0} manual-linked`
                : meta?.timezone ?? "Europe/Zurich"}
            </div>
          </div>
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
          <span className="text-xs text-gray-500">
            (Unallocated / null-channel expected events are always included.)
          </span>
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
          <span className="text-xs text-gray-500">Updates ShopifyOrder → materialize → generate.</span>
          {syncMessage && <span className="text-xs text-gray-600">{syncMessage}</span>}
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Cash balance</h2>
          <ResponsiveContainer width="100%" height={360}>
            <LineChart data={chartRows}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip formatter={(value: any) => formatMoneyCHF(value)} />
              <Legend />
              <Line
                type="monotone"
                dataKey="closingBalance"
                name="Closing balance"
                stroke="#0f172a"
                strokeWidth={3}
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>

        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Daily ledger</h2>
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Opening</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">In</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Out</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Closing</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {chartRows.map((row) => (
                  <tr key={row.date} className="hover:bg-gray-50">
                    <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">{row.date}</td>
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
          <div className="font-semibold mb-2">How to read this</div>
          <ul className="list-disc ml-5 space-y-1">
            <li>
              <strong>Expected cash</strong> sums <code className="bg-amber-100 px-1 rounded">ExpectedCashEvent</code> by
              expected date (gross inflows; outflows from COGS, ads, manual events, etc. after you generate).
            </li>
            <li>
              <strong>Legacy</strong> rebuilds timing from orders + rules + variable costs (older path).
            </li>
            <li>Starting balance is editable in Finance admin (CashFlowConfig).</li>
            <li>Low confidence counts include payout-rule fallbacks and weak refund timestamps.</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
