import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [
      operatingTotal,
      expectedTotal,
      salesByChannel,
      cogsByChannel,
      refundLowConfidence,
      shopifyCashInRules,
      lastMaterialized,
      lastExpectedUpdated,
    ] = await Promise.all([
      prisma.operatingEvent.count({
        where: { status: { notIn: ["VOID", "SUPERSEDED"] } },
      }),
      prisma.expectedCashEvent.count({
        where: { status: { notIn: ["VOID", "SUPERSEDED"] } },
      }),
      prisma.operatingEvent.groupBy({
        by: ["channel"],
        where: {
          eventType: "SALE",
          status: { notIn: ["VOID", "SUPERSEDED"] },
        },
        _count: { _all: true },
      }),
      prisma.operatingEvent.groupBy({
        by: ["channel"],
        where: {
          eventType: "COGS",
          status: { notIn: ["VOID", "SUPERSEDED"] },
        },
        _count: { _all: true },
      }),
      prisma.operatingEvent.count({
        where: {
          eventType: "REFUND",
          confidence: "LOW",
          status: { notIn: ["VOID", "SUPERSEDED"] },
        },
      }),
      prisma.cashInRule.count({ where: { active: true } }),
      prisma.operatingEvent.aggregate({ _max: { materializedAt: true } }),
      prisma.expectedCashEvent.aggregate({ _max: { updatedAt: true } }),
    ]);

    const saleMap = new Map<string, number>();
    for (const row of salesByChannel) {
      const key = row.channel ?? "UNSPECIFIED";
      saleMap.set(key, row._count._all);
    }
    const cogsMap = new Map<string, number>();
    for (const row of cogsByChannel) {
      const key = row.channel ?? "UNSPECIFIED";
      cogsMap.set(key, row._count._all);
    }

    const channels = new Set([...saleMap.keys(), ...cogsMap.keys()]);
    const cogsCoverage: Record<string, { sales: number; cogs: number; ratio: number | null }> = {};
    for (const ch of channels) {
      const sales = saleMap.get(ch) ?? 0;
      const cogs = cogsMap.get(ch) ?? 0;
      cogsCoverage[ch] = {
        sales,
        cogs,
        ratio: sales > 0 ? Number((cogs / sales).toFixed(3)) : null,
      };
    }

    const warnings: string[] = [];
    if (operatingTotal === 0) {
      warnings.push("No operating events yet. Run materialize from Finance Admin.");
    }
    if (expectedTotal === 0) {
      warnings.push("No expected cash events yet. Run generate from Finance Admin.");
    }
    if (shopifyCashInRules === 0) {
      warnings.push("No active CashInRule rows in DB; payout timing uses code defaults until you add rules.");
    }
    if (refundLowConfidence > 0) {
      warnings.push(
        `Shopify refund dates are approximated for ${refundLowConfidence} refund event(s) (no true refund timestamp in source).`
      );
    }
    for (const [ch, v] of Object.entries(cogsCoverage)) {
      if (ch === "UNSPECIFIED") continue;
      if (v.sales > 0 && v.cogs === 0) {
        warnings.push(`Channel ${ch}: sales events exist but no COGS operating events — coverage gap.`);
      }
    }

    return NextResponse.json({
      success: true,
      operatingEventCount: operatingTotal,
      expectedCashEventCount: expectedTotal,
      salesEventCountByChannel: Object.fromEntries(saleMap),
      cogsEventCountByChannel: Object.fromEntries(cogsMap),
      cogsCoverage,
      refundApproximatedCount: refundLowConfidence,
      activeCashInRuleCount: shopifyCashInRules,
      lastMaterializedAt: lastMaterialized._max.materializedAt,
      lastExpectedCashUpdatedAt: lastExpectedUpdated._max.updatedAt,
      warnings,
    });
  } catch (error: any) {
    console.error("[FINANCE][DIAGNOSTICS] GET:", error);
    return NextResponse.json(
      { error: "Failed to load diagnostics", details: error.message },
      { status: 500 }
    );
  }
}
