import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanStatus = "FOUND" | "NOT_FOUND" | "UNMATCHED" | "ERROR";

const normalizeCode = (code?: string | null) => {
  if (!code) return "";
  const trimmed = code.trim();
  // remove leading/trailing non-alphanumeric chars
  const cleaned = trimmed.replace(/^[^a-zA-Z0-9]+|[^a-zA-Z0-9]+$/g, "");
  if (/^\d{13,}$/.test(cleaned)) {
    return cleaned.slice(-12);
  }
  return cleaned;
};

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const list = searchParams.get("list");
    const limit = Math.min(Number(searchParams.get("limit") || 500), 2000);

    if (list !== "1") {
      return NextResponse.json(
        { error: "Missing list=1 parameter" },
        { status: 400 }
      );
    }

    const rows = await prisma.orderMatch.findMany({
      where: {
        stockxAwb: { not: null },
      },
      select: {
        stockxAwb: true,
        stockxTrackingUrl: true,
        shopifyOrderName: true,
        shopifyOrderId: true,
        shopifyCreatedAt: true,
      },
      orderBy: {
        
        shopifyCreatedAt: "desc",
      },
      take: limit,
    });

    type AwbRow = {
      stockxAwb: string | null;
      stockxTrackingUrl: string | null;
      shopifyOrderName: string;
      shopifyOrderId: string;
      shopifyCreatedAt: Date | null;
    };

    const items = (rows as AwbRow[])
      .filter((r: AwbRow) => r.stockxAwb)
      .map((r: AwbRow) => ({
        awb: r.stockxAwb as string,
        shopifyOrderName: r.shopifyOrderName,
        shopifyOrderId: r.shopifyOrderId,
        shopifyCreatedAt: r.shopifyCreatedAt,
        trackingUrl: r.stockxTrackingUrl || null,
      }));

    return NextResponse.json({ ok: true, count: items.length, items });
  } catch (error: any) {
    console.error("[SCAN-AWB] List error:", error);
    return NextResponse.json(
      { error: "Failed to fetch AWB list", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const rawCode = body?.code;
    const awb = normalizeCode(rawCode);

    if (!awb) {
      return NextResponse.json(
        { ok: false, status: "UNMATCHED", awb: "", match: null, error: { message: "Missing code" } },
        { status: 400 }
      );
    }

    // Look for a match by AWB; fallbacks could be trackingUrl but keep strict for V1
    const match = await prisma.orderMatch.findFirst({
      where: { stockxAwb: awb },
      select: {
        shopifyOrderId: true,
        shopifyOrderName: true,
        shopifyLineItemId: true,
        matchConfidence: true,
        matchScore: true,
        stockxAwb: true,
        stockxTrackingUrl: true,
        shopifyProductTitle: true,
        shopifySizeEU: true,
        shopifySku: true,
        shopifyTotalPrice: true,
        // No customer fields in current schema; returned as nulls
      },
    });

    const status: ScanStatus = match ? "FOUND" : "NOT_FOUND";

    const response = {
      ok: !!match,
      status,
      awb,
      match: match
        ? {
            shopifyOrderId: match.shopifyOrderId,
            shopifyOrderName: match.shopifyOrderName,
            shopifyLineItemId: match.shopifyLineItemId,
            matchConfidence: match.matchConfidence,
            matchScore: match.matchScore ? Number(match.matchScore) : null,
            customer: {
              name: null,
              email: null,
              phone: null,
              shippingAddress: {
                address1: null,
                address2: null,
                zip: null,
                city: null,
                province: null,
                country: null,
              },
            },
            lineItem: {
              title: match.shopifyProductTitle,
              variantTitle: match.shopifySizeEU,
              sku: match.shopifySku,
              quantity: 1,
            },
            trackingUrl: match.stockxTrackingUrl || null,
          }
        : null,
    };

    return NextResponse.json(response, { status: 200 });
  } catch (error: any) {
    console.error("[SCAN-AWB] Error:", error);
    return NextResponse.json(
      {
        ok: false,
        status: "ERROR",
        awb: "",
        match: null,
        error: { message: error.message || "Internal error" },
      },
      { status: 500 }
    );
  }
}

