import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  fetchSwissPostMailpieceDetail,
  fetchSwissPostMailpieceEvents,
} from "@/lib/swissPost";
import {
  createFulfillmentEvent,
  findFulfillmentIdByTrackingNumber,
} from "@/lib/shopifyFulfillment";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_LANGS = new Set(["de", "fr", "it", "en"]);

type TrackingRequest = {
  awb?: string;
  shopifyOrderId?: string;
  mailpieceKey?: string;
  language?: string;
  updateShopify?: boolean;
};

type TrackingSummary = {
  status: string | null;
  title: string | null;
  subtitle: string | null;
  lastEvent: {
    code?: string | null;
    title?: string | null;
    subtitle?: string | null;
    timestamp?: string | null;
    location?: any;
  } | null;
  updatedAt: string;
  mailpieceKey: string;
  detail: any;
  events: any;
};

function normalizeString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeLanguage(value?: string | null) {
  const lang = (value || "").trim().toLowerCase();
  return VALID_LANGS.has(lang) ? lang : "fr";
}

function pickLatestEvent(events: any[] | null) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const withTimestamp = events
    .map((event) => {
      const timestamp = typeof event?.timestamp === "string" ? Date.parse(event.timestamp) : NaN;
      return { event, timestamp };
    })
    .filter((item) => Number.isFinite(item.timestamp))
    .sort((a, b) => b.timestamp - a.timestamp);
  return withTimestamp.length > 0 ? withTimestamp[0].event : events[0];
}

function mapSwissPostStatusToShopify(status: string | null) {
  if (!status) return null;
  switch (status) {
    case "NOT_YET_SENT":
      return "LABEL_PRINTED";
    case "ON_GOING_DELIVERY":
      return "IN_TRANSIT";
    case "WAITING_FOR_PICKUP":
      return "READY_FOR_PICKUP";
    case "DELIVERED":
      return "DELIVERED";
    case "RETURNED":
      return "FAILURE";
    case "CUSTOMS":
      return "DELAYED";
    default:
      return null;
  }
}

function mergeSwissPostResponse(previous: any, tracking: TrackingSummary) {
  if (previous && typeof previous === "object" && !Array.isArray(previous)) {
    return { ...previous, tracking };
  }
  if (previous != null) {
    return { label: previous, tracking };
  }
  return { tracking };
}

export async function POST(req: NextRequest) {
  try {
    const requiredKey = process.env.INTERNAL_API_KEY;
    if (requiredKey) {
      const provided = req.headers.get("x-internal-key");
      if (provided !== requiredKey) {
        return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
      }
    }

    const body = (await req.json().catch(() => ({}))) as TrackingRequest;
    const awb = normalizeString(body?.awb);
    let shopifyOrderId = normalizeString(body?.shopifyOrderId);
    const mailpieceKeyInput = normalizeString(body?.mailpieceKey);
    const language = normalizeLanguage(body?.language);
    const updateShopify = body?.updateShopify !== false;

    let record = await prisma.shopifyFulfillmentRecord.findFirst({
      where: {
        ...(shopifyOrderId ? { shopifyOrderId } : {}),
        ...(awb ? { sourceAwb: awb } : {}),
        ...(mailpieceKeyInput
          ? {
              OR: [
                { swissPostLabelId: mailpieceKeyInput },
                { trackingNumber: mailpieceKeyInput },
                { swissPostBarcode: mailpieceKeyInput },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        shopifyOrderId: true,
        trackingNumber: true,
        swissPostLabelId: true,
        swissPostBarcode: true,
        swissPostStatus: true,
        swissPostResponse: true,
      },
    });

    if (!record && awb) {
      const match = await prisma.orderMatch.findFirst({
        where: { stockxAwb: awb },
        select: { shopifyOrderId: true },
      });
      if (match?.shopifyOrderId) {
        shopifyOrderId = match.shopifyOrderId;
        record = await prisma.shopifyFulfillmentRecord.findFirst({
          where: { shopifyOrderId },
          orderBy: { createdAt: "desc" },
          select: {
            id: true,
            shopifyOrderId: true,
            trackingNumber: true,
            swissPostLabelId: true,
            swissPostBarcode: true,
            swissPostStatus: true,
            swissPostResponse: true,
          },
        });
      }
    }

    if (!record) {
      return NextResponse.json({ ok: false, error: "Fulfillment record not found" }, { status: 404 });
    }

    if (!shopifyOrderId) {
      shopifyOrderId = record.shopifyOrderId || "";
    }

    const resolvedMailpieceKey =
      mailpieceKeyInput || record.swissPostLabelId || record.trackingNumber || record.swissPostBarcode || "";
    if (!resolvedMailpieceKey) {
      return NextResponse.json({ ok: false, error: "Missing swissPost mailpieceKey" }, { status: 400 });
    }

    const detailRes = await fetchSwissPostMailpieceDetail(resolvedMailpieceKey, language);
    const eventsRes = await fetchSwissPostMailpieceEvents(resolvedMailpieceKey, language);

    if (!detailRes.ok && !eventsRes.ok) {
      return NextResponse.json(
        {
          ok: false,
          error: "Swiss Post tracking failed",
          detailStatus: detailRes.status,
          eventsStatus: eventsRes.status,
          detail: detailRes.data,
          events: eventsRes.data,
        },
        { status: 502 }
      );
    }

    const detail = detailRes.data || {};
    const events = eventsRes.data || {};
    const eventsList = Array.isArray(events?.events) ? events.events : [];
    const latestEvent = pickLatestEvent(eventsList);
    const trackingStatus = detail?.status?.status || null;
    const trackingTitle = detail?.status?.title || null;
    const trackingSubtitle = detail?.status?.subtitle || null;

    const trackingSummary: TrackingSummary = {
      status: trackingStatus,
      title: trackingTitle,
      subtitle: trackingSubtitle,
      lastEvent: latestEvent
        ? {
            code: latestEvent?.code ?? null,
            title: latestEvent?.title ?? null,
            subtitle: latestEvent?.subtitle ?? null,
            timestamp: latestEvent?.timestamp ?? null,
            location: latestEvent?.location ?? null,
          }
        : null,
      updatedAt: new Date().toISOString(),
      mailpieceKey: resolvedMailpieceKey,
      detail,
      events,
    };

    const previousTracking =
      record?.swissPostResponse &&
      typeof record.swissPostResponse === "object" &&
      !Array.isArray(record.swissPostResponse)
        ? (record.swissPostResponse as any)?.tracking ?? null
        : null;
    const previousStatus = previousTracking?.status ?? null;
    const previousTimestamp = previousTracking?.lastEvent?.timestamp ?? null;

    await prisma.shopifyFulfillmentRecord.update({
      where: { id: record.id },
      data: {
        swissPostStatus: trackingStatus || record.swissPostStatus,
        swissPostResponse: mergeSwissPostResponse(record.swissPostResponse, trackingSummary),
      },
    });

    const shopifyStatus = mapSwissPostStatusToShopify(trackingStatus);
    const trackingNumber =
      record.trackingNumber || record.swissPostLabelId || record.swissPostBarcode || "";
    let fulfillmentId: string | null = null;
    let shopifyEvent: any = null;
    let shopifyErrors: any = null;
    const shouldCreateEvent =
      updateShopify &&
      Boolean(shopifyStatus) &&
      Boolean(shopifyOrderId) &&
      Boolean(trackingNumber) &&
      (previousStatus !== trackingStatus || previousTimestamp !== trackingSummary.lastEvent?.timestamp);

    if (shouldCreateEvent) {
      fulfillmentId = await findFulfillmentIdByTrackingNumber(shopifyOrderId, trackingNumber);
      if (fulfillmentId && shopifyStatus) {
        const message = trackingTitle || latestEvent?.title || null;
        const happenedAt = latestEvent?.timestamp || null;
        const result = await createFulfillmentEvent({
          fulfillmentId,
          status: shopifyStatus,
          message,
          happenedAt,
        });
        shopifyEvent = result.fulfillmentEvent;
        shopifyErrors = result.userErrors;
      }
    }

    return NextResponse.json({
      ok: true,
      mailpieceKey: resolvedMailpieceKey,
      shopifyOrderId,
      tracking: trackingSummary,
      shopify: {
        updateAttempted: updateShopify,
        fulfillmentId,
        status: shopifyStatus,
        event: shopifyEvent,
        userErrors: shopifyErrors,
      },
    });
  } catch (error: any) {
    console.error("[SWISS POST TRACKING] Error:", error?.message || error);
    if (error?.stack) {
      console.error("[SWISS POST TRACKING] Stack:", error.stack);
    }
    return NextResponse.json(
      { ok: false, error: error?.message || "Swiss Post tracking error" },
      { status: 500 }
    );
  }
}
