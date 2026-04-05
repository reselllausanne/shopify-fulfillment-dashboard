"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ComposedChart,
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

type ChannelKey = "shopify" | "galaxus" | "decathlon";

type DailyChannelRow = {
  date: string;
  channel: ChannelKey;
  salesChf: number;
  salesWithCogsChf: number;
  cogsChf: number;
  marginChf: number;
  ordersCount: number;
  lineItemsCount: number;
  matchedCogsCount: number;
  missingCogsCount: number;
};

type ChannelTotals = Omit<DailyChannelRow, "date" | "channel">;

type Reconciliation = {
  rows: {
    date: string;
    bookedSalesChf: number;
    matchedSalesChf: number;
    bookedOrdersCount: number;
    matchedOrdersCount: number;
  }[];
  totals: {
    bookedSalesChf: number;
    matchedSalesChf: number;
    bookedOrdersCount: number;
    matchedOrdersCount: number;
  };
} | null;

type CashflowResponse = {
  rows: DailyChannelRow[];
  totals: {
    overall: ChannelTotals;
    byChannel: Record<ChannelKey, ChannelTotals>;
  };
  reconciliation: Reconciliation;
  metadata: {
    startDate: string;
    endDate: string;
    rangeDays: number;
    timezone: string;
    channels: ChannelKey[];
  };
};

type DailySummaryRow = {
  date: string;
  shopifySales: number;
  galaxusSales: number;
  decathlonSales: number;
  totalSales: number;
  shopifyMargin: number;
  galaxusMargin: number;
  decathlonMargin: number;
  totalMargin: number;
  shopifyCoverage: number;
  galaxusCoverage: number;
  decathlonCoverage: number;
};

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  shopify: "Shopify",
  galaxus: "Galaxus",
  decathlon: "Decathlon",
};

const CHANNEL_COLORS: Record<ChannelKey, string> = {
  shopify: "#3b82f6",
  galaxus: "#10b981",
  decathlon: "#f97316",
};

export default function CashFlowPage() {
  const [range, setRange] = useState(30);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<CashflowResponse | null>(null);

  const fetchCashflow = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await getJson<CashflowResponse>(
        `/api/metrics/cashflow/daily?range=${range}`
      );
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

  useEffect(() => {
    fetchCashflow();
  }, [range]);

  const dailySummary = useMemo<DailySummaryRow[]>(() => {
    if (!data) return [];
    const byDate = new Map<string, DailySummaryRow>();

    const ensureDate = (date: string) => {
      if (!byDate.has(date)) {
        byDate.set(date, {
          date,
          shopifySales: 0,
          galaxusSales: 0,
          decathlonSales: 0,
          totalSales: 0,
          shopifyMargin: 0,
          galaxusMargin: 0,
          decathlonMargin: 0,
          totalMargin: 0,
          shopifyCoverage: 0,
          galaxusCoverage: 0,
          decathlonCoverage: 0,
        });
      }
      return byDate.get(date)!;
    };

    data.rows.forEach((row) => {
      const entry = ensureDate(row.date);
      const coverage =
        row.lineItemsCount > 0 ? (row.matchedCogsCount / row.lineItemsCount) * 100 : 0;

      if (row.channel === "shopify") {
        entry.shopifySales = row.salesChf;
        entry.shopifyMargin = row.marginChf;
        entry.shopifyCoverage = coverage;
      }
      if (row.channel === "galaxus") {
        entry.galaxusSales = row.salesChf;
        entry.galaxusMargin = row.marginChf;
        entry.galaxusCoverage = coverage;
      }
      if (row.channel === "decathlon") {
        entry.decathlonSales = row.salesChf;
        entry.decathlonMargin = row.marginChf;
        entry.decathlonCoverage = coverage;
      }
    });

    const rows = Array.from(byDate.values()).map((row) => {
      const totalSales = row.shopifySales + row.galaxusSales + row.decathlonSales;
      const totalMargin = row.shopifyMargin + row.galaxusMargin + row.decathlonMargin;
      return {
        ...row,
        totalSales: Number(totalSales.toFixed(2)),
        totalMargin: Number(totalMargin.toFixed(2)),
      };
    });

    return rows.sort((a, b) => a.date.localeCompare(b.date));
  }, [data]);

  const overall = data?.totals.overall;
  const coveragePct =
    overall && overall.lineItemsCount > 0
      ? (overall.matchedCogsCount / overall.lineItemsCount) * 100
      : 0;
  const shopifyRecon = data?.reconciliation?.totals;

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
            Multi-channel sales, matched COGS, and coverage diagnostics per day.
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

        <div className="mb-6 flex flex-wrap gap-2">
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
          <button
            onClick={fetchCashflow}
            className="ml-auto px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mb-6 p-4 rounded-md bg-red-50 border border-red-200 text-red-700">
            {error}
          </div>
        )}

        {data && overall && (
          <>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-6 mb-8">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">Total Sales</div>
                <div className="text-2xl font-bold text-blue-600">
                  {formatMoneyCHF(overall.salesChf)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {data.metadata.startDate} → {data.metadata.endDate}
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">COGS (Matched)</div>
                <div className="text-2xl font-bold text-orange-600">
                  {formatMoneyCHF(overall.cogsChf)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Only lines with cost</div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">
                  Gross Margin (Matched)
                </div>
                <div className="text-2xl font-bold text-emerald-600">
                  {formatMoneyCHF(overall.marginChf)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Coverage: {coveragePct.toFixed(1)}%
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">COGS Coverage</div>
                <div className="text-2xl font-bold text-purple-600">
                  {overall.matchedCogsCount}/{overall.lineItemsCount}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  {overall.missingCogsCount} lines missing cost
                </div>
              </div>

              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">Shopify Recon</div>
                <div className="text-2xl font-bold text-gray-900">
                  {formatMoneyCHF(shopifyRecon?.matchedSalesChf || 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Booked: {formatMoneyCHF(shopifyRecon?.bookedSalesChf || 0)}
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow mb-8">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-gray-900">
                  Daily Sales by Channel
                </h2>
                <span className="text-xs text-gray-500">
                  Timezone: {data.metadata.timezone}
                </span>
              </div>
              <ResponsiveContainer width="100%" height={380}>
                <ComposedChart data={dailySummary}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip formatter={(value: any) => formatMoneyCHF(value)} />
                  <Legend />
                  {(["shopify", "galaxus", "decathlon"] as ChannelKey[]).map(
                    (channel) => (
                      <Line
                        key={channel}
                        type="monotone"
                        dataKey={`${channel}Sales`}
                        name={`${CHANNEL_LABELS[channel]} Sales`}
                        stroke={CHANNEL_COLORS[channel]}
                        strokeWidth={2}
                        dot={false}
                      />
                    )
                  )}
                  <Line
                    type="monotone"
                    dataKey="totalSales"
                    name="Total Sales"
                    stroke="#111827"
                    strokeWidth={3}
                    dot={false}
                  />
                </ComposedChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-bold text-gray-900 mb-4">
                Daily Breakdown
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                        Date
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Total Sales
                      </th>
                      {(["shopify", "galaxus", "decathlon"] as ChannelKey[]).map(
                        (channel) => (
                          <th
                            key={`${channel}-sales`}
                            className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"
                          >
                            {CHANNEL_LABELS[channel]} Sales
                          </th>
                        )
                      )}
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                        Matched Margin
                      </th>
                      {(["shopify", "galaxus", "decathlon"] as ChannelKey[]).map(
                        (channel) => (
                          <th
                            key={`${channel}-coverage`}
                            className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase"
                          >
                            {CHANNEL_LABELS[channel]} COGS %
                          </th>
                        )
                      )}
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                    {dailySummary.map((row) => (
                      <tr key={row.date} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {row.date}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                          {formatMoneyCHF(row.totalSales)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                          {formatMoneyCHF(row.shopifySales)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-emerald-600">
                          {formatMoneyCHF(row.galaxusSales)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                          {formatMoneyCHF(row.decathlonSales)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900 font-medium">
                          {formatMoneyCHF(row.totalMargin)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                          {row.shopifyCoverage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-emerald-600">
                          {row.galaxusCoverage.toFixed(1)}%
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                          {row.decathlonCoverage.toFixed(1)}%
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
