import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
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
      select: { id: true, shopifyOrderName: true, customerTrackingToken: true },
    });
    if (!match) {
      return NextResponse.json({ ok: false, error: "Order match not found" }, { status: 404 });
    }

    let publicToken = match.customerTrackingToken;
    if (!publicToken) {
      const updated = await prisma.orderMatch.update({
        where: { id: match.id },
        data: { customerTrackingToken: crypto.randomUUID() },
        select: { customerTrackingToken: true },
      });
      publicToken = updated.customerTrackingToken;
    }

    const legacyToken = createTrackingToken(match.id);
    return NextResponse.json({
      ok: true,
      token: publicToken,
      legacyToken,
      orderMatchId: match.id,
      orderName: match.shopifyOrderName,
      url: `/track/${publicToken}`,
      legacyUrl: `/track/${legacyToken}`,
    });
  } catch (error: any) {
    console.error("[TRACKING_TOKEN] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to create tracking token" },
      { status: 500 }
    );
  }
}
