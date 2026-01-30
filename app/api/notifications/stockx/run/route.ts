import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";

export const runtime = "nodejs";

export async function POST(_req: NextRequest) {
  try {
    const matches = await prisma.orderMatch.findMany({
      where: {
        stockxStates: { not: null },
      },
      select: {
        id: true,
        shopifyOrderId: true,
        shopifyOrderName: true,
        stockxOrderNumber: true,
        stockxCheckoutType: true,
        stockxStates: true,
        stockxStatesHash: true,
        lastMilestoneKey: true,
      },
    });

    let processed = 0;
    for (const match of matches) {
      const states = (match.stockxStates as StockXState[]) || null;
      const milestone = detectMilestone(match.stockxCheckoutType || null, states);
      const milestoneKey = milestone?.key || null;
      if (!milestoneKey || milestoneKey === match.lastMilestoneKey) {
        continue;
      }

      try {
        await prisma.stockXStatusEvent.create({
          data: {
            orderMatchId: match.id,
            milestoneKey,
            milestoneTitle: milestone?.title || milestoneKey,
            statesHash: match.stockxStatesHash || "",
          },
        });
      } catch (error: any) {
        if (error?.code !== "P2002") {
          console.error("[NOTIFIER] Event insert failed:", error);
        }
      }

      await prisma.orderMatch.update({
        where: { id: match.id },
        data: {
          lastMilestoneKey: milestoneKey,
          lastMilestoneAt: new Date(),
        },
      });

      processed += 1;
    }

    return NextResponse.json({ success: true, processed });
  } catch (error: any) {
    console.error("[NOTIFIER] Failed:", error);
    return NextResponse.json({ error: error?.message || "Failed to run notifier" }, { status: 500 });
  }
}

