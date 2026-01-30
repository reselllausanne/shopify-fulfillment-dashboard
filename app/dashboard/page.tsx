"use client";

import React, { useState, useEffect } from "react";
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { formatMoneyCHF, formatPercent } from "@/app/utils/numbers";
import { getJson, postJson } from "@/app/lib/api";

interface DailyRow {
  date: string;
  salesChf: number;
  costChf: number;
  marginChf: number;
  marginPct: number;
  returnMarginLostChf: number;
  returnedStockValueChf: number;
  adsSpendChf: number;
  netAfterAdsChf: number;
  ordersCount: number;
  lineItemsCount: number;
  missingCostCount: number;
  missingSellDateCount: number;
}

type DailyDetailRow = {
  shopifyOrderId: string;
  shopifyOrderName: string;
  shopifyProductTitle: string;
  shopifySku: string | null;
  shopifySizeEU: string | null;
  shopifyCreatedAt: string;
  stockxOrderNumber: string | null;
  supplierSource: string | null;
  returnReason?: string | null;
  revenue: number;
  cost: number;
  margin: number;
};

interface DailyMetrics {
  rows: DailyRow[];
  totals: {
    salesChf: number;
    costChf: number;
    marginChf: number;
    marginPct: number;
    adsSpendChf: number;
    netAfterAdsChf: number;
    ordersCount: number;
    lineItemsCount: number;
    missingCostCount: number;
    missingSellDateCount: number;
  };
  metadata: {
    dateMode: string;
    startDate: string;
    endDate: string;
    range: number;
  };
}

type KPIProps = {
  title: string;
  value: number;
  detail?: string;
  color?: "blue" | "green" | "purple" | "orange" | "red" | "gray" | "teal";
  trendColor?: string;
};

const KPI_COLORS: Record<string, string> = {
  blue: "text-blue-600 border-blue-200 shadow-blue-50",
  green: "text-green-700 border-green-200 shadow-green-50",
  purple: "text-purple-600 border-purple-200 shadow-purple-50",
  orange: "text-orange-600 border-orange-200 shadow-orange-50",
  red: "text-red-600 border-red-200 shadow-red-50",
  gray: "text-gray-700 border-gray-200 shadow-gray-50",
  teal: "text-teal-600 border-teal-200 shadow-teal-50",
};

function KPI({ title, value, detail, color = "gray", trendColor }: KPIProps) {
  const classes = KPI_COLORS[color] || KPI_COLORS.gray;
  return (
    <div className={`bg-white p-6 rounded-lg shadow-sm border ${classes}`}>
      <div className="text-sm text-gray-600 mb-1">{title}</div>
      <div className="text-2xl font-bold">
        {formatMoneyCHF(value)}
        {trendColor && <span className={`ml-2 px-2 py-0.5 text-xs rounded ${trendColor}`}>{trendColor}</span>}
      </div>
      {detail && <div className="text-xs text-gray-500 mt-1">{detail}</div>}
    </div>
  );
}

export default function DashboardPage() {
  const [metrics, setMetrics] = useState<DailyMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState(30);
  const [clearing, setClearing] = useState(false);
  const [expandedDate, setExpandedDate] = useState<string | null>(null);
  const [detailsByDate, setDetailsByDate] = useState<Record<string, DailyDetailRow[]>>({});
  const [detailsLoading, setDetailsLoading] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchMetrics();
  }, [range]);

  const clearAllOrders = async () => {
    // Double confirmation for safety
    const confirmed = window.confirm(
      "⚠️ WARNING: This will delete ALL Shopify orders and order matches!\n\n" +
      "This action cannot be undone.\n\n" +
      "This will clear:\n" +
      "  • All synced Shopify orders\n" +
      "  • All supplier order matches\n\n" +
      "It will KEEP:\n" +
      "  • Expenses\n" +
      "  • Ads Spend\n" +
      "  • Variable Costs\n\n" +
      "Are you sure you want to continue?"
    );

    if (!confirmed) {
      return;
    }

    // Second confirmation
    const doubleConfirm = window.confirm(
      "⚠️ LAST CHANCE!\n\n" +
      "You are about to delete all orders and matches.\n" +
      "This is irreversible.\n\n" +
      "Click OK to proceed, or Cancel to abort."
    );

    if (!doubleConfirm) {
      return;
    }

    try {
      setClearing(true);
      const response = await postJson<any>("/api/db/clear-orders", {});
      if (response.ok) {
        const deleted = response.data?.deleted || {};
        alert(
          `✅ Database cleared!\n\n` +
          `Deleted:\n` +
          `  • ${deleted.shopifyOrders || 0} Shopify orders\n` +
          `  • ${deleted.orderMatches || 0} order matches\n\n` +
          `Next: Reload your data from the main matching flow.`
        );
        fetchMetrics(); // Refresh metrics (will show empty)
      } else {
        alert(`❌ Clear failed: ${response.data?.error || "Unknown error"}`);
      }
    } catch (err: any) {
      alert(`❌ Error: ${err.message}`);
    } finally {
      setClearing(false);
    }
  };

  const fetchMetrics = async () => {
    try {
      setLoading(true);
      setError(null);
      // Metrics are grouped by Shopify sell date (Europe/Zurich) with costs from OrderMatch.
      const response = await getJson<DailyMetrics>(`/api/metrics/daily?range=${range}`);
      if (!response.ok) {
        const data = response.data as any;
        setError(data?.details || data?.error || "Failed to fetch metrics");
        return;
      }

      setMetrics(response.data);
    } catch (err: any) {
      console.error("[DASHBOARD] Error:", err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const toggleDayDetails = async (date: string) => {
    if (expandedDate === date) {
      setExpandedDate(null);
      return;
    }

    setExpandedDate(date);
    if (detailsByDate[date]) return;

    setDetailsLoading((prev) => ({ ...prev, [date]: true }));
    const res = await getJson<{ rows: DailyDetailRow[] }>(
      `/api/metrics/daily-details?date=${date}`
    );
    if (res.ok) {
      setDetailsByDate((prev) => ({ ...prev, [date]: res.data.rows || [] }));
    } else {
      setDetailsByDate((prev) => ({ ...prev, [date]: [] }));
    }
    setDetailsLoading((prev) => ({ ...prev, [date]: false }));
  };

  if (loading && !metrics) {
    return (
      <div className="min-h-screen bg-gray-50 p-8">
        <div className="max-w-7xl mx-auto">
          <p className="text-gray-600">Loading dashboard...</p>
        </div>
      </div>
    );
  }

  const totals = metrics?.totals;
  const primaryKpis = totals
    ? [
        { title: "Sales (Sell Date)", value: totals.salesChf, detail: "Shopify sell date", color: "blue" },
        { title: "Cost (COGS)", value: totals.costChf, detail: "Supplier cost", color: "purple" },
        {
          title: "Margin",
          value: totals.marginChf,
          detail: `${formatPercent(totals.marginPct)} real margin`,
          color: "green",
        },
        {
          title: "Returned Stock",
          value: totals.returnedStockValueChf,
          detail: "Returned inventory value",
          color: "cyan",
        },
        {
          title: "Return Margin Lost",
          value: totals.returnMarginLostChf,
          detail: "Cost - return fee",
          color: "red",
        },
        { title: "Ads Spend", value: totals.adsSpendChf, detail: "Marketing costs", color: "orange" },
        { title: "Net After Ads", value: totals.netAfterAdsChf, detail: "Margin - ads", color: "teal" },
      ]
    : [];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📊 Margin Dashboard (Sell Date)</h1>
          <p className="text-gray-600">Real COGS-based margin grouped by Shopify sell date (Europe/Zurich)</p>
          
          {/* Navigation */}
          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              🏠 Orders
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-blue-100 rounded-md">
              📊 Dashboard (Current)
            </span>
            <a
              href="/expenses"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <a
              href="/financial"
              className="px-4 py-2 bg-purple-600 text-white rounded-md hover:bg-purple-700 transition-colors font-medium"
            >
              📈 Financial Overview
            </a>
          </nav>
        </div>

        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          {[1, 7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setRange(d)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                range === d
                  ? "bg-blue-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100 border border-gray-300"
              }`}
            >
              {d === 1 ? "Today" : `Last ${d} days`}
            </button>
          ))}
          <button
            onClick={clearAllOrders}
            disabled={clearing}
            className="ml-auto px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            title="Clear all Shopify orders and order matches (keeps expenses, ads spend, etc.)"
          >
            {clearing ? "⏳ Clearing..." : "🗑️ Clear All Orders"}
          </button>
          <button
            onClick={fetchMetrics}
            className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
          >
            🔄 Refresh Metrics
          </button>
        </div>

        {/* Error Message */}
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg">
            <p className="text-red-800 font-medium">Error: {error}</p>
          </div>
        )}

        {/* Info Cards */}
        {totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Reporting Window</div>
              <div className="text-3xl font-bold text-gray-900">{range}d</div>
              <p className="text-xs text-gray-500 mt-1">Grouped by Shopify sell date (Europe/Zurich)</p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Orders Count</div>
              <div className="text-3xl font-bold text-gray-900">{totals.ordersCount}</div>
              <p className="text-xs text-gray-500 mt-1">
                Line items: {totals.lineItemsCount} • Missing cost: {totals.missingCostCount} • Missing sell date: {totals.missingSellDateCount}
              </p>
            </div>
            <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
              <div className="text-sm text-gray-600 mb-1">Margin %</div>
              <div className="text-3xl font-bold text-gray-900">{formatPercent(totals.marginPct)}</div>
              <p className="text-xs text-gray-500 mt-1">Based on matches with known cost</p>
            </div>
          </div>
        )}

        {/* KPI Cards */}
        {totals && (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
            {primaryKpis.map((card) => (
              <KPI
                key={card.title}
                title={card.title}
                value={card.value}
                detail={card.detail}
                color={card.color as any}
              />
            ))}
          </div>
        )}

        {/* Daily Chart */}
        {metrics && metrics.rows.length > 0 && (
          <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-8">
            <h2 className="text-xl font-semibold mb-4">📈 Daily Margin (sell date)</h2>
            <ResponsiveContainer width="100%" height={400}>
              <ComposedChart data={metrics.rows}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 11 }}
                  angle={-45}
                  textAnchor="end"
                  height={80}
                />
                <YAxis yAxisId="left" />
                <YAxis yAxisId="right" orientation="right" />
                <Tooltip
                  formatter={(value: any, name?: string) => {
                    const label = name || "";
                    if (label.includes("%")) return [`${Number(value).toFixed(1)}%`, label];
                    if (typeof value === "number") return [formatMoneyCHF(value), label];
                    return [value, label];
                  }}
                />
                <Legend />
                <Bar yAxisId="left" dataKey="marginChf" fill="#10b981" name="Margin CHF" />
                <Bar yAxisId="left" dataKey="adsSpendChf" fill="#f97316" name="Ads Spend CHF" />
                <Line yAxisId="right" type="monotone" dataKey="marginPct" stroke="#3b82f6" strokeWidth={3} name="Margin %" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        )}

        {/* Daily Table */}
        {metrics && metrics.rows.length > 0 && (
          <div className="bg-white rounded-lg shadow-sm border border-gray-200">
            <div className="p-6 border-b border-gray-200">
              <h2 className="text-xl font-semibold">📅 Daily Margin (Sell Date)</h2>
            </div>
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-gray-200">
                  <thead className="bg-gray-50">
                    <tr>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Date</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin %</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ads</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Orders</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Items</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Missing Cost</th>
                    </tr>
                  </thead>
                  <tbody className="bg-white divide-y divide-gray-200">
                  {metrics.rows.map((row, i) => (
                    <React.Fragment key={i}>
                    <tr
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => toggleDayDetails(row.date)}
                      title="Click to view order breakdown"
                    >
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-900 font-medium">
                        {new Date(row.date).toLocaleDateString('de-CH')}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                        CHF {row.salesChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-purple-600 font-medium">
                        CHF {row.costChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600 font-bold">
                        CHF {row.marginChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                        {row.marginPct.toFixed(1)}%
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                        CHF {row.adsSpendChf.toFixed(2)}
                          </td>
                      <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-bold ${
                        row.netAfterAdsChf >= 0 ? 'text-emerald-600' : 'text-red-600'
                      }`}>
                        CHF {row.netAfterAdsChf.toFixed(2)}
                          </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                        {row.ordersCount}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                        {row.lineItemsCount}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-right">
                        {row.missingCostCount > 0 ? (
                          <span className="text-red-600 font-medium">{row.missingCostCount}</span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right text-gray-400">
                        {expandedDate === row.date ? "▲" : "▼"}
                      </td>
                    </tr>
                    {expandedDate === row.date && (
                      <tr>
                        <td colSpan={10} className="bg-gray-50 px-4 py-4">
                          {detailsLoading[row.date] ? (
                            <div className="text-sm text-gray-500">Loading details...</div>
                          ) : (detailsByDate[row.date] || []).length === 0 ? (
                            <div className="text-sm text-gray-500">No orders found for this day.</div>
                          ) : (
                            <div className="overflow-x-auto">
                              <table className="min-w-full text-xs bg-white border border-gray-200 rounded">
                                <thead className="bg-gray-100">
                                  <tr>
                                    <th className="px-3 py-2 text-left">Time</th>
                                    <th className="px-3 py-2 text-left">Order</th>
                                    <th className="px-3 py-2 text-left">Product</th>
                                    <th className="px-3 py-2 text-right">Revenue</th>
                                    <th className="px-3 py-2 text-right">Cost</th>
                                    <th className="px-3 py-2 text-right">Margin</th>
                                    <th className="px-3 py-2 text-left">Source</th>
                                    <th className="px-3 py-2 text-left">StockX</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {(detailsByDate[row.date] || []).map((d) => (
                                    <tr key={`${d.shopifyOrderId}-${d.shopifyProductTitle}`} className="border-t">
                                      <td className="px-3 py-2 font-mono">
                                        {new Date(d.shopifyCreatedAt).toLocaleTimeString("de-CH")}
                                      </td>
                                      <td className="px-3 py-2 font-medium">{d.shopifyOrderName}</td>
                                      <td className="px-3 py-2">
                                        {d.shopifyProductTitle}
                                        {d.shopifySizeEU ? ` (${d.shopifySizeEU})` : ""}
                                      </td>
                                      <td className="px-3 py-2 text-right">CHF {d.revenue.toFixed(2)}</td>
                                      <td className="px-3 py-2 text-right">CHF {d.cost.toFixed(2)}</td>
                                      <td className={`px-3 py-2 text-right font-semibold ${
                                        d.margin < 0 ? "text-red-600" : "text-green-700"
                                      }`}>
                                        CHF {d.margin.toFixed(2)}
                                      </td>
                                      <td className="px-3 py-2">{d.supplierSource || "—"}</td>
                                      <td className="px-3 py-2 font-mono">{d.stockxOrderNumber || "—"}</td>
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                    </React.Fragment>
                  ))}
                  </tbody>
                </table>
            </div>
              </div>
            )}

        {/* Empty State */}
        {metrics && metrics.rows.length === 0 && (
          <div className="bg-white p-12 rounded-lg shadow-sm border border-gray-200 text-center">
            <p className="text-gray-600 mb-4">No data available for selected period</p>
            <p className="text-sm text-gray-500">
              Go to the <a href="/" className="text-blue-600 hover:underline">main page</a> to match orders
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
