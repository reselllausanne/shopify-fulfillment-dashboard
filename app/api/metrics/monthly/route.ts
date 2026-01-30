import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { toNumberSafe } from "@/app/utils/numbers";
import type { Prisma } from "@prisma/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface MonthlyMetricsRow {
  month: string;
  monthNum: number;
  salesChf: number;
  grossMarginChf: number;
  adsSpendChf: number;
  postageShippingCostChf: number;
  fulfillmentCostChf: number;
  netAfterVariableCostsChf: number;
  marginPct: number;
  notes: string;
  returnedStockValueChf: number;
}

const SAFE_YEAR_MIN = 2020;
const SAFE_YEAR_MAX = 2100;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const yearParam = searchParams.get("year");
    const exportFormat = searchParams.get("export"); // "csv" or null

    const currentYear = new Date().getFullYear();
    const year = yearParam ? parseInt(yearParam) : currentYear;

    if (isNaN(year) || year < SAFE_YEAR_MIN || year > SAFE_YEAR_MAX) {
      return NextResponse.json(
        { error: "Invalid year parameter" },
        { status: 400 }
      );
    }

    const yearStart = new Date(Date.UTC(year, 0, 1, 0, 0, 0, 0));
    const yearEnd = new Date(Date.UTC(year, 11, 31, 23, 59, 59, 999));

    const matches = await prisma.orderMatch.findMany({
      where: {
        createdAt: {
          gte: yearStart,
          lte: yearEnd,
        },
      },
      select: {
        createdAt: true,
        shopifyTotalPrice: true,
        supplierCost: true,
        marginAmount: true,
        manualRevenueAdjustment: true,
        returnReason: true,
        returnFeePercent: true,
        returnFeeAmountChf: true,
        returnedStockValueChf: true,
      },
    });

    const adsSpendRecords = await prisma.dailyAdSpend.findMany({
      where: {
        date: {
          gte: yearStart,
          lte: yearEnd,
        },
      },
    });

    const variableCosts = await prisma.monthlyVariableCosts.findMany({
      where: {
        year,
      },
    });

    const adsByMonth = new Map<string, number>();
    for (const record of adsSpendRecords) {
      const monthKey = record.date.toISOString().slice(0, 7);
      const existing = adsByMonth.get(monthKey) || 0;
      adsByMonth.set(monthKey, existing + toNumberSafe(record.amountChf, 0));
    }

    const variableCostMap = new Map<
      string,
      { postageShippingCostChf: number; fulfillmentCostChf: number; notes: string }
    >(
      variableCosts.map((item: any) => [
        item.monthKey,
        {
          postageShippingCostChf: toNumberSafe(item.postageShippingCostChf, 0),
          fulfillmentCostChf: toNumberSafe(item.fulfillmentCostChf, 0),
          notes: item.notes || "",
        },
      ])
    );

    const monthlyMap = new Map<string, MonthlyMetricsRow>();
    for (let month = 1; month <= 12; month++) {
      const monthKey = `${year}-${month.toString().padStart(2, "0")}`;
      monthlyMap.set(monthKey, {
        month: monthKey,
        monthNum: month,
        salesChf: 0,
        grossMarginChf: 0,
        adsSpendChf: adsByMonth.get(monthKey) || 0,
        postageShippingCostChf: variableCostMap.get(monthKey)?.postageShippingCostChf || 0,
        fulfillmentCostChf: variableCostMap.get(monthKey)?.fulfillmentCostChf || 0,
        netAfterVariableCostsChf: 0,
        marginPct: 0,
        notes: variableCostMap.get(monthKey)?.notes || "",
        returnedStockValueChf: 0,
      });
    }

    for (const match of matches) {
      const monthKey = match.createdAt.toISOString().slice(0, 7);
      const row = monthlyMap.get(monthKey);
      if (!row) continue;

      const revenue = toNumberSafe(match.shopifyTotalPrice, 0);
      const adjustment = toNumberSafe(match.manualRevenueAdjustment, 0);
      const cost = toNumberSafe(match.supplierCost, 0);
      const returnFeePercent = toNumberSafe(match.returnFeePercent, 0);
      const returnFeeAmount =
        match.returnReason
          ? toNumberSafe(
              match.returnFeeAmountChf,
              returnFeePercent > 0 ? (revenue * returnFeePercent) / 100 : 0
            )
          : 0;
      const effectiveRevenue = match.returnReason ? returnFeeAmount : revenue + adjustment;
      const returnedStockValue = toNumberSafe(match.returnedStockValueChf, 0);
      if (!match.returnReason && effectiveRevenue <= 0) continue;

      row.salesChf += effectiveRevenue;
      row.grossMarginChf += effectiveRevenue - cost;
      row.returnedStockValueChf += returnedStockValue;
    }

    const rows = Array.from(monthlyMap.values()).map((row) => {
      const netAfterVariableCostsChf =
        row.grossMarginChf - row.adsSpendChf - row.postageShippingCostChf - row.fulfillmentCostChf;

      return {
        ...row,
        netAfterVariableCostsChf: Number(netAfterVariableCostsChf.toFixed(2)),
        marginPct: row.salesChf > 0 ? Number(((row.grossMarginChf / row.salesChf) * 100).toFixed(2)) : 0,
        salesChf: Number(row.salesChf.toFixed(2)),
        grossMarginChf: Number(row.grossMarginChf.toFixed(2)),
        adsSpendChf: Number(row.adsSpendChf.toFixed(2)),
        postageShippingCostChf: Number(row.postageShippingCostChf.toFixed(2)),
        fulfillmentCostChf: Number(row.fulfillmentCostChf.toFixed(2)),
        returnedStockValueChf: Number(row.returnedStockValueChf.toFixed(2)),
      };
    });

    const filteredRows = rows.filter(
      (row) =>
        row.salesChf > 0 ||
        row.adsSpendChf > 0 ||
        row.postageShippingCostChf > 0 ||
        row.fulfillmentCostChf > 0 ||
        row.returnedStockValueChf > 0
    );

    if (exportFormat === "csv") {
      const csv = generateCSV(filteredRows);
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv",
          "Content-Disposition": `attachment; filename="monthly_financials_${year}.csv"`,
        },
      });
    }

    const yearTotals = filteredRows.reduce(
      (totals, row) => {
        totals.salesChf += row.salesChf;
        totals.grossMarginChf += row.grossMarginChf;
        totals.adsSpendChf += row.adsSpendChf;
        totals.postageShippingCostChf += row.postageShippingCostChf;
        totals.fulfillmentCostChf += row.fulfillmentCostChf;
        totals.netAfterVariableCostsChf += row.netAfterVariableCostsChf;
        totals.returnedStockValueChf += row.returnedStockValueChf;
        return totals;
      },
      {
        salesChf: 0,
        grossMarginChf: 0,
        adsSpendChf: 0,
        postageShippingCostChf: 0,
        fulfillmentCostChf: 0,
        netAfterVariableCostsChf: 0,
        returnedStockValueChf: 0,
      }
    );

    return NextResponse.json(
      {
        success: true,
        year,
        months: filteredRows,
        yearTotals: {
          ...yearTotals,
          marginPct:
            yearTotals.salesChf > 0
              ? Number(((yearTotals.grossMarginChf / yearTotals.salesChf) * 100).toFixed(2))
              : 0,
        },
      },
      { status: 200 }
    );
  } catch (error: any) {
    console.error("[METRICS/MONTHLY] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch monthly metrics", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

interface MonthlyCsvRow {
  month: string;
  salesChf: number;
  grossMarginChf: number;
  marginPct: number;
  adsSpendChf: number;
  postageShippingCostChf: number;
  fulfillmentCostChf: number;
  netAfterVariableCostsChf: number;
  returnedStockValueChf: number;
  notes: string;
}

function generateCSV(data: MonthlyMetricsRow[]): string {
  const headers = [
    "month",
    "sales_chf",
    "gross_margin_chf",
    "margin_pct",
    "ads_spend_chf",
    "postage_shipping_cost_chf",
    "fulfillment_cost_chf",
    "net_after_variable_costs_chf",
    "returned_stock_value_chf",
    "notes",
  ];

  const rows = data.map<MonthlyCsvRow>((row) => ({
    month: row.month,
    salesChf: row.salesChf,
    grossMarginChf: row.grossMarginChf,
    marginPct: row.marginPct,
    adsSpendChf: row.adsSpendChf,
    postageShippingCostChf: row.postageShippingCostChf,
    fulfillmentCostChf: row.fulfillmentCostChf,
    netAfterVariableCostsChf: row.netAfterVariableCostsChf,
    returnedStockValueChf: row.returnedStockValueChf,
    notes: row.notes,
  }));

  const csvLines = [
    headers.join(","),
    ...rows.map((row) =>
      [
        row.month,
        row.salesChf,
        row.grossMarginChf,
        row.marginPct,
        row.adsSpendChf,
        row.postageShippingCostChf,
        row.fulfillmentCostChf,
        row.netAfterVariableCostsChf,
        `"${(row.notes || "").replace(/"/g, '""')}"`,
      ].join(",")
    ),
  ];

  return csvLines.join("\n");
}

