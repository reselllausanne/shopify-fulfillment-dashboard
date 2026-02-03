import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";
import { sendMilestoneEmailForMatch } from "@/app/lib/notifications/stockxEmail";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const limit = Math.min(Math.max(Number(body?.limit) || 2, 1), 10);
    const force = Boolean(body?.force);
    const skipIfFulfilled = body?.skipIfFulfilled !== false;
    const skipIfEtaPassed = body?.skipIfEtaPassed !== false;
    const onlyToday = Boolean(body?.onlyToday);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const matches = await prisma.orderMatch.findMany({
      where: {
        stockxStates: { not: Prisma.DbNull },
        ...(onlyToday ? { stockxPurchaseDate: { gte: startOfToday } } : {}),
      },
      select: {
        id: true,
        stockxCheckoutType: true,
        stockxStates: true,
        lastMilestoneKey: true,
        stockxOrderNumber: true,
      },
      orderBy: { stockxPurchaseDate: "desc" },
      take: 200,
    });

    const candidates: string[] = [];
    for (const m of matches) {
      const states = (m.stockxStates as StockXState[]) || null;
      const milestone = detectMilestone(m.stockxCheckoutType || null, states, m.stockxOrderNumber || null);
      const milestoneKey = milestone?.key || null;
      if (!milestoneKey) continue;
      if (!force && milestoneKey === m.lastMilestoneKey) continue;
      candidates.push(m.id);
      if (candidates.length >= limit) break;
    }

    const results = [];
    for (const id of candidates) {
      const res = await sendMilestoneEmailForMatch({
        matchId: id,
        force,
        skipIfFulfilled,
        skipIfEtaPassed,
      });
      results.push(res);
    }

    return NextResponse.json({
      ok: true,
      limit,
      attempted: candidates.length,
      sent: results.filter((r: any) => r.sent).length,
      skipped: results.filter((r: any) => r.skipped).length,
      results,
    });
  } catch (error: any) {
    console.error("[SEND-LIMITED] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to send limited emails" },
      { status: 500 }
    );
  }
}
