"use client";

import { useState, useEffect } from "react";
import {
  ComposedChart,
  BarChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  type PieLabelRenderProps,
} from "recharts";
import AdsSpendManager from "@/app/components/AdsSpendManager";
import MonthlyVariableCostsManager from "@/app/components/MonthlyVariableCostsManager";
import RecurringExpensesManager from "@/app/components/RecurringExpensesManager";
import { getJson } from "@/app/lib/api";
import { extractRecurringIdFromNote } from "@/app/lib/recurring-schedule";
import { toNumberSafe } from "@/app/utils/numbers";

type SalesRow = {
  date: string;
  sales: number;
  marginChf: number;
};

type Expense = {
  id: string;
  amount: number;
  isBusiness: boolean;
  date: string;
  categoryName?: string;
  accountName?: string;
  note?: string | null;
};

type ExpenseCategorySummary = { categoryName: string; total: number };

type MonthRow = {
  month: string;
  salesChf: number;
  grossMarginChf: number;
  adsSpendChf: number;
  postageShippingCostChf: number;
  fulfillmentCostChf: number;
  netAfterVariableCostsChf: number;
  marginPct: number;
  notes: string;
  returnedStockValueChf: number;
};

type YearTotals = {
  salesChf: number;
  grossMarginChf: number;
  adsSpendChf: number;
  postageShippingCostChf: number;
  fulfillmentCostChf: number;
  netAfterVariableCostsChf: number;
  marginPct: number;
  returnedStockValueChf: number;
};

type MonthlyMetricsResponse = {
  success: boolean;
  year: number;
  months: MonthRow[];
  yearTotals: YearTotals;
};

type MarketplaceTotals = {
  revenueChf: number;
  marginChf: number;
  orderCount: number;
  lineCount: number;
  unitCount: number;
};

type MarketplaceDailyRow = {
  date: string;
  decathlonMarginChf: number;
  galaxusMarginChf: number;
  totalMarginChf: number;
  decathlonLineCount: number;
  galaxusLineCount: number;
  decathlonOrderCount: number;
  galaxusOrderCount: number;
};

type MarketplaceMetricsResponse = {
  data: MarketplaceDailyRow[];
  totals: {
    decathlon: MarketplaceTotals;
    galaxus: MarketplaceTotals;
    combined: MarketplaceTotals;
  };
  period: {
    startDate: string;
    endDate: string;
    days: number;
  };
};

const VAT_RATE = 0.021; // 2.1% TVA on all sales
const COLORS = ['#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8', '#82ca9d', '#ffc658', '#ff7c7c'];

export default function FinancialOverviewPage() {
  const [days, setDays] = useState(30);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<
    "expenses" | "ads" | "variable" | "monthly" | "marketplace" | "recurring"
  >("expenses");
  
  // Data states
  const [expensesData, setExpensesData] = useState<Expense[]>([]);
  const [expensesByCategory, setExpensesByCategory] = useState<ExpenseCategorySummary[]>([]);
  const [dailyFinancials, setDailyFinancials] = useState<any[]>([]);
  const [monthlyData, setMonthlyData] = useState<MonthlyMetricsResponse | null>(null);
  const [marketplaceMetrics, setMarketplaceMetrics] = useState<MarketplaceMetricsResponse | null>(null);
  
  // Summary stats
  const [totalSales, setTotalSales] = useState(0);
  const [totalCosts, setTotalCosts] = useState(0);
  const [totalExpenses, setTotalExpenses] = useState(0);
  const [totalVAT, setTotalVAT] = useState(0);
  const [totalAdsSpend, setTotalAdsSpend] = useState(0);
  const [recurringTotals, setRecurringTotals] = useState({
    recorded: 0,
    scheduled: 0,
    recordedPersonal: 0,
    recordedBusiness: 0,
    scheduledPersonal: 0,
    scheduledBusiness: 0,
  });
  const [finalMargin, setFinalMargin] = useState(0);

  useEffect(() => {
    loadData();
  }, [days]);

  async function loadData() {
    setLoading(true);
    try {
      const from = new Date();
      from.setDate(from.getDate() - days);
      const fromStr = from.toISOString().split('T')[0];

      // Fetch all data in parallel
      const [salesJson, expensesJson, expenseSummaryJson, monthlyJson, adsJson, recurringJson, marketplaceJson] = await Promise.all([
        getJson<any>(`/api/metrics/margin?days=${days}`),
        getJson<any>(`/api/expenses?from=${fromStr}`),
        getJson<any>(`/api/expenses/summary?from=${fromStr}`),
        getJson<MonthlyMetricsResponse>(`/api/metrics/monthly?year=${new Date().getFullYear()}`),
        getJson<any>(`/api/ads-spend?from=${fromStr}`),
        getJson<any>(`/api/recurring-expenses`),
        getJson<any>(`/api/metrics/marketplace?days=${days}`),
      ]);

      // Process sales data (defensive: API may wrap rows)
      const salesRaw = salesJson.data?.data ?? salesJson.data;
      const sales = Array.isArray(salesRaw) ? salesRaw : salesRaw?.rows || [];
      const totalRev = sales.reduce((sum: number, d: SalesRow) => sum + toNumberSafe(d.sales, 0), 0);
      const totalSupplierCost = sales.reduce((sum: number, d: SalesRow) => sum + toNumberSafe(d.sales - d.marginChf, 0), 0);
      const vatAmount = totalRev * VAT_RATE;

      setTotalSales(totalRev);
      setTotalCosts(totalSupplierCost);
      setTotalVAT(vatAmount);

      // Process expenses data
      const expensesList: Expense[] = expensesJson.data?.expenses || [];
      const totalExp = expensesList.reduce((sum: number, e: Expense) => sum + toNumberSafe(e.amount, 0), 0);
      setExpensesData(expensesList);
      setTotalExpenses(totalExp);

      // Recurring expenses (scheduled + recorded)
      const recurringItems = recurringJson.data?.items || [];
      const recordedByKey = new Set<string>();
      const recordedByDay = new Map<string, number>();
      let recordedTotal = 0;
      let recordedPersonal = 0;
      let recordedBusiness = 0;

      expensesList.forEach((exp) => {
        const rid = extractRecurringIdFromNote(exp.note);
        if (!rid) return;
        const dateKey = new Date(exp.date).toISOString().split("T")[0];
        recordedByKey.add(`${rid}|${dateKey}`);
        const amount = toNumberSafe(exp.amount, 0);
        recordedTotal += amount;
        if (exp.isBusiness) recordedBusiness += amount;
        else recordedPersonal += amount;
        recordedByDay.set(dateKey, (recordedByDay.get(dateKey) || 0) + amount);
      });

      const fromDate = new Date(`${fromStr}T00:00:00.000Z`);
      const toDate = new Date();
      toDate.setUTCHours(23, 59, 59, 999);

      const getRunDate = (year: number, monthIndex: number, dayOfMonth: number) => {
        const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
        const day = Math.min(Math.max(dayOfMonth, 1), lastDay);
        return new Date(Date.UTC(year, monthIndex, day, 0, 0, 0, 0));
      };

      const scheduledByDay = new Map<string, { total: number; personal: number; business: number }>();
      let scheduledTotal = 0;
      let scheduledPersonal = 0;
      let scheduledBusiness = 0;

      const fromMonth = new Date(Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), 1));
      const toMonth = new Date(Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), 1));

      recurringItems.forEach((item: any) => {
        if (!item.active) return;
        const start = item.startDate ? new Date(item.startDate) : new Date();
        if (isNaN(start.getTime())) return;
        const end = item.endDate ? new Date(item.endDate) : null;
        if (end && !isNaN(end.getTime()) && end < fromDate) return;
        const startMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
        const interval = Math.max(Number(item.intervalMonths) || 1, 1);
        const dayOfMonth = Number(item.dayOfMonth) || 1;

        for (
          let cursor = new Date(fromMonth);
          cursor <= toMonth;
          cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
        ) {
          const monthsDiff =
            (cursor.getUTCFullYear() - startMonth.getUTCFullYear()) * 12 +
            (cursor.getUTCMonth() - startMonth.getUTCMonth());
          if (monthsDiff < 0 || monthsDiff % interval !== 0) continue;

          const runDate = getRunDate(cursor.getUTCFullYear(), cursor.getUTCMonth(), dayOfMonth);
          if (runDate < start || runDate < fromDate || runDate > toDate) continue;
          if (end && !isNaN(end.getTime()) && runDate > end) continue;

          const dateKey = runDate.toISOString().split("T")[0];
          if (recordedByKey.has(`${item.id}|${dateKey}`)) continue;

          const amount = toNumberSafe(item.amount, 0);
          scheduledTotal += amount;
          if (item.isBusiness) scheduledBusiness += amount;
          else scheduledPersonal += amount;

          const cur = scheduledByDay.get(dateKey) || { total: 0, personal: 0, business: 0 };
          cur.total += amount;
          if (item.isBusiness) cur.business += amount;
          else cur.personal += amount;
          scheduledByDay.set(dateKey, cur);
        }
      });

      setRecurringTotals({
        recorded: recordedTotal,
        scheduled: scheduledTotal,
        recordedPersonal,
        recordedBusiness,
        scheduledPersonal,
        scheduledBusiness,
      });

      // Process ads spend data
      const adsRecords = adsJson.data?.records || [];
      const totalAds = adsRecords.reduce(
        (sum: number, r: any) => sum + toNumberSafe(r.amountChf, 0),
        0
      );
      setTotalAdsSpend(totalAds);

      // Expenses by category
      const catSummary: ExpenseCategorySummary[] = expenseSummaryJson.data?.byCategory || [];
      setExpensesByCategory(catSummary);

      // Monthly data (defensive defaults)
      const normMonthly = (payload: any) => {
        const months = payload?.months ?? payload?.data?.months ?? [];
        const yearTotals =
          payload?.yearTotals ??
          payload?.data?.yearTotals ?? {
            salesChf: 0,
            grossMarginChf: 0,
            adsSpendChf: 0,
            postageShippingCostChf: 0,
            fulfillmentCostChf: 0,
            netAfterVariableCostsChf: 0,
            marginPct: 0,
            returnedStockValueChf: 0,
          };
        const year = payload?.year ?? payload?.data?.year ?? new Date().getFullYear();
        const success = payload?.success ?? payload?.data?.success ?? true;
        return { months, yearTotals, year, success };
      };
      setMonthlyData(normMonthly(monthlyJson.data ?? monthlyJson));

      const normMarketplace = (payload: any): MarketplaceMetricsResponse => {
        const raw =
          payload?.totals || payload?.period
            ? payload
            : payload?.data ?? payload ?? {};
        const data = Array.isArray(raw?.data) ? raw.data : Array.isArray(raw) ? raw : [];
        const emptyTotals = { revenueChf: 0, marginChf: 0, orderCount: 0, lineCount: 0, unitCount: 0 };
        const totals = raw?.totals ?? {};
        const period = raw?.period ?? {
          startDate: fromStr,
          endDate: new Date().toISOString().split("T")[0],
          days,
        };
        return {
          data,
          totals: {
            decathlon: totals.decathlon ?? emptyTotals,
            galaxus: totals.galaxus ?? emptyTotals,
            combined: totals.combined ?? emptyTotals,
          },
          period,
        };
      };
      const normalizedMarketplace = normMarketplace(marketplaceJson.data ?? marketplaceJson);
      setMarketplaceMetrics(normalizedMarketplace);
      const marketplaceMarginByDay = new Map<string, number>();
      normalizedMarketplace.data.forEach((row) => {
        marketplaceMarginByDay.set(row.date, toNumberSafe(row.totalMarginChf, 0));
      });
      const marketplaceMarginTotal = toNumberSafe(
        normalizedMarketplace.totals?.combined?.marginChf,
        0
      );

      // Daily chart: spread personal + recurring (posted & unposted) evenly; keep business one-off, COGS, ads on actual dates
      const toKeyStr = toDate.toISOString().split("T")[0];
      let smoothPosted = 0;
      const businessOneOffByDay = new Map<string, number>();
      expensesList.forEach((exp) => {
        const dateKey = new Date(exp.date).toISOString().split("T")[0];
        if (dateKey < fromStr || dateKey > toKeyStr) return;
        const amount = toNumberSafe(exp.amount, 0);
        const rid = extractRecurringIdFromNote(exp.note);
        if (!exp.isBusiness || rid) {
          smoothPosted += amount;
        } else {
          businessOneOffByDay.set(dateKey, (businessOneOffByDay.get(dateKey) || 0) + amount);
        }
      });
      const smoothTotal = smoothPosted + scheduledTotal;
      const dayKeys: string[] = [];
      for (
        let t = Date.UTC(fromDate.getUTCFullYear(), fromDate.getUTCMonth(), fromDate.getUTCDate());
        t <= Date.UTC(toDate.getUTCFullYear(), toDate.getUTCMonth(), toDate.getUTCDate());
        t += 86400000
      ) {
        dayKeys.push(new Date(t).toISOString().split("T")[0]);
      }
      const dayCount = Math.max(1, dayKeys.length);
      const dailySmooth = smoothTotal / dayCount;

      const dailyMap = new Map<string, any>();
      for (const date of dayKeys) {
        dailyMap.set(date, {
          date,
          sales: 0,
          costs: 0,
          smoothedExpenses: dailySmooth,
          businessOneOff: businessOneOffByDay.get(date) || 0,
          adsSpend: 0,
          vat: 0,
          marketplaceMargin: marketplaceMarginByDay.get(date) || 0,
          margin: 0,
        });
      }

      sales.forEach((day: any) => {
        const row = dailyMap.get(day.date);
        if (row) {
          row.sales = day.sales;
          row.costs = day.sales - day.marginChf;
          row.vat = day.sales * VAT_RATE;
        }
      });

      const dailyAds = new Map<string, number>();
      adsRecords.forEach((r: any) => {
        const date = String(r.date);
        dailyAds.set(date, (dailyAds.get(date) || 0) + toNumberSafe(r.amountChf, 0));
      });
      dailyAds.forEach((amount, date) => {
        const row = dailyMap.get(date);
        if (row) row.adsSpend = amount;
      });

      const dailyArray = dayKeys.map((date) => {
        const d = dailyMap.get(date)!;
        d.margin =
          d.sales -
          d.costs -
          d.smoothedExpenses -
          d.businessOneOff -
          d.adsSpend -
          d.vat +
          d.marketplaceMargin;
        return d;
      });

      setDailyFinancials(dailyArray);

      // Calculate overall final margin (includes ads + scheduled recurring)
      const finalMarg =
        totalRev -
        totalSupplierCost -
        totalExp -
        scheduledTotal -
        totalAds -
        vatAmount +
        marketplaceMarginTotal;
      setFinalMargin(finalMarg);

    } catch (error) {
      console.error('Error loading financial data:', error);
    } finally {
      setLoading(false);
    }
  }

  const handleExportCSV = async () => {
    try {
      const response = await fetch(`/api/metrics/monthly?year=${new Date().getFullYear()}&export=csv`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `monthly_financials_${new Date().getFullYear()}.csv`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    } catch (error) {
      console.error('Export failed:', error);
      alert('Failed to export CSV');
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 p-8 flex items-center justify-center">
        <div className="text-xl text-gray-600">Loading financial data...</div>
      </div>
    );
  }

  const personalExpensesBase = expensesData
    .filter((e: any) => !e.isBusiness)
    .reduce((sum: number, e: any) => sum + e.amount, 0);
  const businessExpensesBase = expensesData
    .filter((e: any) => e.isBusiness)
    .reduce((sum: number, e: any) => sum + e.amount, 0);
  const personalExpenses = personalExpensesBase + recurringTotals.scheduledPersonal;
  const businessExpenses = businessExpensesBase + recurringTotals.scheduledBusiness;
  const recurringTotal = recurringTotals.recorded + recurringTotals.scheduled;
  const allExpensesTotal = totalExpenses + recurringTotals.scheduled;
  const businessFinalMargin = finalMargin + personalExpenses;
  const marketplaceTotals = marketplaceMetrics?.totals;
  const marketplaceCombinedMargin = marketplaceTotals?.combined?.marginChf ?? 0;
  const marketplaceRevenueTotal = marketplaceTotals?.combined?.revenueChf ?? 0;
  const totalSalesWithMarketplace = totalSales + marketplaceRevenueTotal;
  const marketplaceDaily = marketplaceMetrics?.data ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📈 Financial Overview</h1>
          <p className="text-gray-600">Complete profit & loss analysis with expenses, ads spend & VAT</p>
          
          {/* Navigation */}
          <nav className="flex flex-wrap gap-3 mt-4">
            <a
              href="/"
              className="px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 transition-colors font-medium"
            >
              🏠 Orders
            </a>
            <a
              href="/dashboard"
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors font-medium"
            >
              📊 Dashboard
            </a>
            <a
              href="/expenses"
              className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors font-medium"
            >
              💰 Expenses
            </a>
            <span className="text-gray-900 font-bold py-2 px-3 bg-purple-100 rounded-md">
              📈 Financial (Current)
            </span>
          </nav>
        </div>

        {/* Tabs */}
        <div className="mb-6 border-b border-gray-200">
          <nav className="-mb-px flex space-x-8">
            <button
              onClick={() => setActiveTab("expenses")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "expenses"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              💸 Expenses Overview
            </button>
            <button
              onClick={() => setActiveTab("ads")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "ads"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              📢 Ads Spend
            </button>
            <button
              onClick={() => setActiveTab("variable")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "variable"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              📦 Variable Costs
            </button>
            <button
              onClick={() => setActiveTab("monthly")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "monthly"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              📅 Monthly View
            </button>
            <button
              onClick={() => setActiveTab("marketplace")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "marketplace"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              🛒 Marketplace Results
            </button>
            <button
              onClick={() => setActiveTab("recurring")}
              className={`py-4 px-1 border-b-2 font-medium text-sm ${
                activeTab === "recurring"
                  ? "border-purple-500 text-purple-600"
                  : "border-transparent text-gray-500 hover:text-gray-700"
              }`}
            >
              🔁 Recurring
            </button>
          </nav>
        </div>

        {/* Expenses Overview Tab */}
        {activeTab === "expenses" && (
          <>
        {/* Period Selector */}
        <div className="mb-6 flex gap-2">
          {[7, 30, 90, 365].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-4 py-2 rounded-md font-medium transition-colors ${
                days === d
                  ? "bg-purple-600 text-white"
                  : "bg-white text-gray-700 hover:bg-gray-100"
              }`}
            >
              Last {d} days
            </button>
          ))}
          <button
            onClick={loadData}
            className="ml-auto px-4 py-2 bg-gray-600 text-white rounded-md hover:bg-gray-700 font-medium"
          >
            🔄 Refresh
          </button>
        </div>

        {/* Summary Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-7 gap-6 mb-8">
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Total Sales</div>
            <div className="text-2xl font-bold text-blue-600">
              CHF {totalSalesWithMarketplace.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              Shopify: CHF {totalSales.toFixed(2)} • Marketplace: CHF {marketplaceRevenueTotal.toFixed(2)}
            </div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Supplier Costs</div>
            <div className="text-2xl font-bold text-orange-600">-CHF {totalCosts.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Supplier purchases</div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">All Expenses</div>
            <div className="text-2xl font-bold text-red-600">-CHF {allExpensesTotal.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">
              Recurring: CHF {recurringTotal.toFixed(2)} • One-off: CHF {(allExpensesTotal - recurringTotal).toFixed(2)}
            </div>
          </div>

          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">Ads Spend</div>
            <div className="text-2xl font-bold text-orange-600">-CHF {totalAdsSpend.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Marketing costs</div>
          </div>
          
          <div className="bg-white p-6 rounded-lg shadow">
            <div className="text-sm font-medium text-gray-500">VAT (2.3%)</div>
            <div className="text-2xl font-bold text-purple-600">-CHF {totalVAT.toFixed(2)}</div>
            <div className="text-xs text-gray-500 mt-1">Tax on sales</div>
          </div>
          
          <div className={`p-6 rounded-lg shadow ${businessFinalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="text-sm font-medium text-gray-500">Business Profit</div>
            <div className={`text-2xl font-bold ${businessFinalMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              CHF {businessFinalMargin.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">Excludes personal spend</div>
          </div>

          <div className={`p-6 rounded-lg shadow ${finalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'}`}>
            <div className="text-sm font-medium text-gray-500">All-in Profit</div>
            <div className={`text-2xl font-bold ${finalMargin >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              CHF {finalMargin.toFixed(2)}
            </div>
            <div className="text-xs text-gray-500 mt-1">
              {totalSalesWithMarketplace > 0
                ? `${((finalMargin / totalSalesWithMarketplace) * 100).toFixed(1)}%`
                : '0%'} vs total sales
            </div>
          </div>
        </div>

        {/* Daily P&L Chart */}
        <div className="bg-white p-6 rounded-lg shadow mb-8">
          <h2 className="text-xl font-bold text-gray-900 mb-2">📊 Daily Profit & Loss</h2>
          <p className="text-sm text-gray-600 mb-4">
            Personal spend and recurring subscriptions (posted + scheduled) are spread evenly across the selected
            period for this chart only. Supplier costs, manual ads, VAT, and one-off business expenses stay on their
            dates. Marketplace margin (Decathlon + Galaxus) appears as a dashed line when matched costs exist.
          </p>
          <ResponsiveContainer width="100%" height={400}>
            <ComposedChart data={dailyFinancials}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip 
                formatter={(value: any) => `CHF ${Number(value).toFixed(2)}`}
                contentStyle={{ backgroundColor: 'rgba(255, 255, 255, 0.95)' }}
              />
              <Legend />
              <Bar dataKey="sales" name="Sales" fill="#3b82f6" />
              <Bar dataKey="costs" name="Supplier costs" fill="#f97316" />
              <Bar
                dataKey="smoothedExpenses"
                name="Personal + recurring (smoothed / day)"
                fill="#fbbf24"
              />
              <Bar dataKey="businessOneOff" name="Business one-off (actual date)" fill="#ef4444" />
              <Bar dataKey="adsSpend" name="Ads spend" fill="#fb923c" />
              <Bar dataKey="vat" name="VAT" fill="#a855f7" />
              <Line
                type="monotone"
                dataKey="marketplaceMargin"
                name="Marketplace margin"
                stroke="#0ea5e9"
                strokeWidth={2}
                strokeDasharray="5 5"
              />
              <Line type="monotone" dataKey="margin" name="Final margin" stroke="#10b981" strokeWidth={3} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* Expenses by Category */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">💸 Expenses by Category</h2>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={expensesByCategory}
                  dataKey="total"
                  nameKey="categoryName"
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  label={({ name, value }: PieLabelRenderProps) =>
                    `${name}: CHF ${Number(value ?? 0).toFixed(0)}`
                  }
                >
                  {expensesByCategory.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value: any) => `CHF ${Number(value).toFixed(2)}`} />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Breakdown Table */}
          <div className="bg-white p-6 rounded-lg shadow">
            <h2 className="text-xl font-bold text-gray-900 mb-4">📋 Financial Breakdown</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center p-3 bg-blue-50 rounded">
                <span className="font-medium text-gray-700">💰 Total Sales (CA)</span>
                <span className="text-lg font-bold text-blue-600">
                  CHF {totalSalesWithMarketplace.toFixed(2)}
                </span>
              </div>

              <div className="flex justify-between items-center p-3 bg-blue-100 rounded text-sm ml-4">
                <span className="text-gray-600">├─ Shopify</span>
                <span className="font-medium text-gray-700">CHF {totalSales.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-blue-100 rounded text-sm ml-4">
                <span className="text-gray-600">└─ Marketplace payout</span>
                <span className="font-medium text-gray-700">CHF {marketplaceRevenueTotal.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">📦 Supplier Costs</span>
                <span className="text-lg font-bold text-orange-600">- CHF {totalCosts.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">💸 All Expenses (incl. recurring)</span>
                <span className="text-lg font-bold text-red-600">- CHF {allExpensesTotal.toFixed(2)}</span>
              </div>
                  
              <div className="flex justify-between items-center p-3 bg-gray-100 rounded text-sm ml-4">
                <span className="text-gray-600">├─ Recurring</span>
                <span className="font-medium text-gray-700">CHF {recurringTotal.toFixed(2)}</span>
              </div>
                  
              <div className="flex justify-between items-center p-3 bg-gray-100 rounded text-sm ml-4">
                <span className="text-gray-600">├─ Personal</span>
                <span className="font-medium text-gray-700">CHF {personalExpenses.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-100 rounded text-sm ml-4">
                <span className="text-gray-600">└─ Business</span>
                <span className="font-medium text-gray-700">CHF {businessExpenses.toFixed(2)}</span>
              </div>
              
              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                    <span className="font-medium text-gray-700">📢 Ads Spend</span>
                    <span className="text-lg font-bold text-orange-600">- CHF {totalAdsSpend.toFixed(2)}</span>
                  </div>

              <div className="flex justify-between items-center p-3 bg-gray-50 rounded">
                <span className="font-medium text-gray-700">🏛️ VAT (2.3%)</span>
                <span className="text-lg font-bold text-purple-600">- CHF {totalVAT.toFixed(2)}</span>
              </div>

              <div className="flex justify-between items-center p-3 bg-emerald-50 rounded">
                <span className="font-medium text-gray-700">🛒 Marketplace Margin</span>
                <span className="text-lg font-bold text-emerald-600">
                  CHF {marketplaceCombinedMargin.toFixed(2)}
                </span>
              </div>
              
              <div className="border-t-2 border-gray-300 pt-3 mt-3"></div>
              
              <div className={`flex justify-between items-center p-4 rounded ${
                businessFinalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'
              }`}>
                <span className="font-bold text-gray-900 text-lg">= Business Profit</span>
                <span className={`text-2xl font-bold ${
                  businessFinalMargin >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  CHF {businessFinalMargin.toFixed(2)}
                </span>
              </div>

              <div className={`flex justify-between items-center p-4 rounded ${
                finalMargin >= 0 ? 'bg-green-50' : 'bg-red-50'
              }`}>
                <span className="font-bold text-gray-900 text-lg">= All-in Profit</span>
                <span className={`text-2xl font-bold ${
                  finalMargin >= 0 ? 'text-green-600' : 'text-red-600'
                }`}>
                  CHF {finalMargin.toFixed(2)}
                </span>
              </div>
              
              <div className="text-center text-sm text-gray-600 mt-2">
                Margin vs total sales: {totalSalesWithMarketplace > 0
                  ? ((finalMargin / totalSalesWithMarketplace) * 100).toFixed(2)
                  : '0'}%
              </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* Ads Spend Tab */}
        {activeTab === "ads" && (
          <AdsSpendManager />
        )}

        {/* Variable Costs Tab */}
        {activeTab === "variable" && (
          <MonthlyVariableCostsManager />
        )}

        {/* Marketplace Results Tab */}
        {activeTab === "marketplace" && marketplaceTotals && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">Decathlon Margin</div>
                <div className="text-2xl font-bold text-blue-600">
                  CHF {marketplaceTotals.decathlon.marginChf.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Payout: CHF {marketplaceTotals.decathlon.revenueChf.toFixed(2)} • Orders: {marketplaceTotals.decathlon.orderCount} • Lines:{" "}
                  {marketplaceTotals.decathlon.lineCount} • Units: {marketplaceTotals.decathlon.unitCount}
                </div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">Galaxus Margin</div>
                <div className="text-2xl font-bold text-orange-600">
                  CHF {marketplaceTotals.galaxus.marginChf.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Revenue: CHF {marketplaceTotals.galaxus.revenueChf.toFixed(2)} • Orders: {marketplaceTotals.galaxus.orderCount} • Lines:{" "}
                  {marketplaceTotals.galaxus.lineCount} • Units: {marketplaceTotals.galaxus.unitCount}
                </div>
              </div>
              <div className="bg-white p-6 rounded-lg shadow">
                <div className="text-sm font-medium text-gray-500">Total Marketplace Margin</div>
                <div className="text-2xl font-bold text-emerald-600">
                  CHF {marketplaceTotals.combined.marginChf.toFixed(2)}
                </div>
                <div className="text-xs text-gray-500 mt-1">
                  Revenue: CHF {marketplaceTotals.combined.revenueChf.toFixed(2)} • Orders: {marketplaceTotals.combined.orderCount} • Lines:{" "}
                  {marketplaceTotals.combined.lineCount} • Units: {marketplaceTotals.combined.unitCount}
                </div>
              </div>
            </div>

            <div className="bg-white p-6 rounded-lg shadow">
              <h2 className="text-xl font-bold text-gray-900 mb-2">📦 Daily Marketplace Margin</h2>
              <p className="text-sm text-gray-600 mb-4">
                Margin uses matched lines with StockX cost for Decathlon & Galaxus orders.
              </p>
              {marketplaceDaily.length === 0 ? (
                <div className="text-sm text-gray-500">No marketplace margin data for this period.</div>
              ) : (
                <ResponsiveContainer width="100%" height={320}>
                  <ComposedChart data={marketplaceDaily}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip
                      formatter={(value: any) => `CHF ${Number(value).toFixed(2)}`}
                      contentStyle={{ backgroundColor: "rgba(255, 255, 255, 0.95)" }}
                    />
                    <Legend />
                    <Bar dataKey="decathlonMarginChf" name="Decathlon margin" fill="#3b82f6" />
                    <Bar dataKey="galaxusMarginChf" name="Galaxus margin" fill="#f97316" />
                    <Line type="monotone" dataKey="totalMarginChf" name="Total margin" stroke="#10b981" strokeWidth={3} />
                  </ComposedChart>
                </ResponsiveContainer>
              )}
            </div>
          </div>
        )}

        {/* Recurring Expenses Tab */}
        {activeTab === "recurring" && (
          <RecurringExpensesManager />
        )}

        {/* Monthly View Tab */}
        {activeTab === "monthly" && monthlyData && (
          <div className="space-y-6">
            <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-xl font-semibold text-gray-900">📅 Monthly Financial Summary ({monthlyData.year})</h2>
                  <p className="text-sm text-gray-500">Sales, Margin, Ads, Variable Costs & Net</p>
                </div>
                <button
                  onClick={handleExportCSV}
                  className="px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 font-medium"
                >
                  📥 Export CSV
                </button>
              </div>

              {/* Year Totals */}
              <div className="grid grid-cols-2 md:grid-cols-7 gap-4 mb-6">
                <div className="bg-blue-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Sales</div>
                  <div className="text-lg font-bold text-blue-600">
                    CHF {monthlyData.yearTotals.salesChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-green-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Gross Margin</div>
                  <div className="text-lg font-bold text-green-600">
                    CHF {monthlyData.yearTotals.grossMarginChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-orange-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Ads Spend</div>
                  <div className="text-lg font-bold text-orange-600">
                    CHF {monthlyData.yearTotals.adsSpendChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-purple-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Postage</div>
                  <div className="text-lg font-bold text-purple-600">
                    CHF {monthlyData.yearTotals.postageShippingCostChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-pink-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Fulfillment</div>
                  <div className="text-lg font-bold text-pink-600">
                    CHF {monthlyData.yearTotals.fulfillmentCostChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-teal-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Returned Stock</div>
                  <div className="text-lg font-bold text-teal-600">
                    CHF {monthlyData.yearTotals.returnedStockValueChf.toFixed(0)}
                  </div>
                </div>
                <div className="bg-emerald-50 p-4 rounded-lg">
                  <div className="text-xs text-gray-600">Net</div>
                  <div className="text-lg font-bold text-emerald-600">
                    CHF {monthlyData.yearTotals.netAfterVariableCostsChf.toFixed(0)}
            </div>
          </div>
        </div>

              {/* Monthly Table */}
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                      <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Month</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Sales</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Gross Margin</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Margin %</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Ads</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Postage</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Fulfillment</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Returned Stock</th>
                      <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">Net</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                    {monthlyData.months.map((month: any) => (
                      <tr key={month.month} className="hover:bg-gray-50">
                        <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                          {month.month}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-blue-600">
                          CHF {month.salesChf.toFixed(2)}
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-green-600 font-medium">
                          CHF {month.grossMarginChf.toFixed(2)}
                    </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-700">
                          {month.marginPct.toFixed(1)}%
                    </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-orange-600">
                          CHF {month.adsSpendChf.toFixed(2)}
                    </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-purple-600">
                          CHF {month.postageShippingCostChf.toFixed(2)}
                    </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-pink-600">
                          CHF {month.fulfillmentCostChf.toFixed(2)}
                    </td>
                        <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-teal-600">
                          CHF {(month.returnedStockValueChf || 0).toFixed(2)}
                    </td>
                        <td className={`px-4 py-3 whitespace-nowrap text-sm text-right font-bold ${
                          month.netAfterVariableCostsChf >= 0 ? 'text-emerald-600' : 'text-red-600'
                    }`}>
                          CHF {month.netAfterVariableCostsChf.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
          </div>
        )}
      </div>
    </div>
  );
}
