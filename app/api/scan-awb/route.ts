import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { fetchOrderShippingInfo } from "@/lib/shopifyFulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ScanStatus = "FOUND" | "NOT_FOUND" | "UNMATCHED" | "ERROR";

async function enrichOrderMatchFromShopify(match: {
  shopifyOrderId: string;
  shopifyLineItemId: string | null;
  shopifyProductTitle: string | null;
  shopifySizeEU: string | null;
  shopifySku: string | null;
}) {
  try {
    const orderInfo = await fetchOrderShippingInfo(match.shopifyOrderId);
    if (!orderInfo) return null;

    const addr = orderInfo.shippingAddress;
    const composedName =
      [addr?.firstName, addr?.lastName].filter(Boolean).join(" ").trim() ||
      (addr?.name || "").trim() ||
      null;

    const lineNodes = orderInfo.lineItems?.nodes ?? [];
    const targetId = match.shopifyLineItemId;
    const li =
      (targetId ? lineNodes.find((n) => n.id === targetId) : undefined) || lineNodes[0] || null;

    return {
      customer: {
        name: composedName,
        email: orderInfo.email ?? null,
        phone: orderInfo.phone || addr?.phone || null,
        shippingAddress: addr
          ? {
              address1: addr.address1 ?? null,
              address2: addr.address2 ?? null,
              zip: addr.zip ?? null,
              city: addr.city ?? null,
              province: addr.province ?? null,
              country: (addr.country || addr.countryCodeV2) ?? null,
              company: addr.company ?? null,
            }
          : null,
      },
      lineItem: li
        ? {
            title: li.title,
            variantTitle: li.variantTitle,
            sku: li.sku || li.variantSku || null,
            quantity: li.quantity,
          }
        : {
            title: match.shopifyProductTitle,
            variantTitle: match.shopifySizeEU,
            sku: match.shopifySku,
            quantity: 1,
          },
      shopifyOrder: {
        name: orderInfo.name,
        customerLocale: orderInfo.customerLocale ?? null,
        paymentGatewayNames: orderInfo.paymentGatewayNames ?? [],
        shippingLines: (orderInfo.shippingLines || [])
          .filter((s) => !s.isRemoved)
          .map((s) => `${s.title} (${s.amount} ${s.currencyCode})`),
        lineItems: lineNodes.map((n) => ({
          id: n.id,
          title: n.title,
          name: n.name ?? null,
          quantity: n.quantity,
          sku: n.sku || n.variantSku || null,
          variantTitle: n.variantTitle,
        })),
      },
    };
  } catch (err) {
    console.error("[SCAN-AWB] Shopify enrich failed:", err);
    return null;
  }
}

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
    const rawClean = String(rawCode ?? "").trim();
    const normalizedSearch = rawClean.replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
    const awbCandidates = Array.from(new Set([awb, normalizedSearch].filter(Boolean)));
    const trackingUrlFilters = awbCandidates
      .filter((candidate) => candidate.length >= 6)
      .map((candidate) => ({ stockxTrackingUrl: { contains: candidate } }));

    if (!awb) {
      return NextResponse.json(
        { ok: false, status: "UNMATCHED", awb: "", match: null, error: { message: "Missing code" } },
        { status: 400 }
      );
    }

    // Look for a match by AWB; fallbacks could be trackingUrl but keep strict for V1
    const [match, decathlonMatch, galaxusMatch] = await Promise.all([
      prisma.orderMatch.findFirst({
        where: {
          OR: [{ stockxAwb: { in: awbCandidates } }, ...trackingUrlFilters],
        },
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
      }),
      prisma.decathlonStockxMatch.findFirst({
        where: {
          OR: [{ stockxAwb: { in: awbCandidates } }, ...trackingUrlFilters],
        },
        select: {
          id: true,
          decathlonOrderId: true,
          decathlonOrderLineId: true,
          decathlonQuantity: true,
          line: {
            select: {
              id: true,
              orderLineId: true,
            },
          },
          order: {
            select: {
              id: true,
              orderId: true,
              orderNumber: true,
              orderState: true,
            },
          },
        },
      }),
      prisma.galaxusStockxMatch.findFirst({
        where: {
          OR: [{ stockxAwb: { in: awbCandidates } }, ...trackingUrlFilters],
        },
        select: {
          id: true,
          galaxusOrderId: true,
          order: {
            select: {
              id: true,
              galaxusOrderId: true,
              orderNumber: true,
            },
          },
        },
      }),
    ]);

    const hasAnyMatch = Boolean(match || decathlonMatch || galaxusMatch);
    const status: ScanStatus = hasAnyMatch ? "FOUND" : "NOT_FOUND";

    let shopifyMatchPayload: Record<string, unknown> | null = null;
    if (match) {
      const base = {
        shopifyOrderId: match.shopifyOrderId,
        shopifyOrderName: match.shopifyOrderName,
        shopifyLineItemId: match.shopifyLineItemId,
        matchConfidence: match.matchConfidence,
        matchScore: match.matchScore ? Number(match.matchScore) : null,
        customer: {
          name: null as string | null,
          email: null as string | null,
          phone: null as string | null,
          shippingAddress: {
            address1: null as string | null,
            address2: null as string | null,
            zip: null as string | null,
            city: null as string | null,
            province: null as string | null,
            country: null as string | null,
          },
        },
        lineItem: {
          title: match.shopifyProductTitle,
          variantTitle: match.shopifySizeEU,
          sku: match.shopifySku,
          quantity: 1,
        },
        trackingUrl: match.stockxTrackingUrl || null,
      };

      const enriched = await enrichOrderMatchFromShopify(match);
      if (enriched) {
        shopifyMatchPayload = {
          ...base,
          customer: enriched.customer,
          lineItem: enriched.lineItem,
          shopifyOrder: enriched.shopifyOrder,
        };
      } else {
        shopifyMatchPayload = base;
      }
    }

    const response = {
      ok: hasAnyMatch,
      status,
      awb,
      match: shopifyMatchPayload,
      decathlon: decathlonMatch
        ? {
            matchId: decathlonMatch.id,
            orderId: decathlonMatch.order?.orderId ?? null,
            orderDbId: decathlonMatch.order?.id ?? decathlonMatch.decathlonOrderId ?? null,
            orderNumber: decathlonMatch.order?.orderNumber ?? null,
            orderState: decathlonMatch.order?.orderState ?? null,
            lineId: decathlonMatch.line?.id ?? decathlonMatch.decathlonOrderLineId ?? null,
            miraklOrderLineId: decathlonMatch.line?.orderLineId ?? null,
            quantity: Number(decathlonMatch.decathlonQuantity ?? 0) || 0,
          }
        : null,
      galaxus: galaxusMatch
        ? {
            matchId: galaxusMatch.id,
            orderId: galaxusMatch.order?.galaxusOrderId ?? null,
            orderDbId: galaxusMatch.order?.id ?? galaxusMatch.galaxusOrderId ?? null,
            orderNumber: galaxusMatch.order?.orderNumber ?? null,
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

