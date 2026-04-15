import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createTrackingToken } from "@/app/lib/trackingToken";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderMatchId = String(body?.orderMatchId || "").trim();
    if (!orderMatchId) {
      return NextResponse.json({ ok: false, error: "Missing orderMatchId" }, { status: 400 });
    }

    const match = await prisma.orderMatch.findUnique({
      where: { id: orderMatchId },
      select: { id: true, shopifyOrderName: true },
    });
    if (!match) {
      return NextResponse.json({ ok: false, error: "Order match not found" }, { status: 404 });
    }

    const token = createTrackingToken(match.id);
    return NextResponse.json({
      ok: true,
      token,
      orderMatchId: match.id,
      orderName: match.shopifyOrderName,
      url: `/track/${token}`,
    });
  } catch (error: any) {
    console.error("[TRACKING_TOKEN] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create tracking token" },
      { status: 500 }
    );
  }
}
