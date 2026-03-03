import { NextResponse } from "next/server";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import {
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
} from "@/galaxus/stx/purchaseUnits";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetails,
} from "@/galaxus/stx/stockxClient";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { orderId } = await params;
    const reservation = await reserveStxPurchaseUnitsForOrder(orderId);
    const initialStatus = reservation.status;
    const pendingSupplierVariantIds = new Set(
      initialStatus.buckets
        .filter((bucket) => bucket.linked < bucket.needed)
        .map((bucket) => bucket.supplierVariantId)
    );

    if (pendingSupplierVariantIds.size === 0) {
      return NextResponse.json({
        ok: true,
        galaxusOrderId: reservation.galaxusOrderId,
        reserve: reservation,
        sync: {
          fetchedOrders: 0,
          inspectedOrders: 0,
          linked: 0,
          alreadyLinked: 0,
          noPendingUnit: 0,
          skippedNoVariant: 0,
          skippedNotPendingVariant: 0,
          errors: 0,
        },
        status: initialStatus,
      });
    }

    const token = await readGalaxusStockxToken();
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing Galaxus StockX token file",
          hint: {
            sessionFile: GALAXUS_STOCKX_SESSION_FILE,
            tokenFile: GALAXUS_STOCKX_TOKEN_FILE,
            setup:
              "Call /api/stockx/playwright with {\"sessionFile\":\".data/stockx-session-galaxus.json\",\"tokenFile\":\".data/stockx-token-galaxus.json\",\"forceLogin\":true}",
          },
          reserve: reservation,
          status: initialStatus,
        },
        { status: 409 }
      );
    }

    const orders = await fetchRecentStockxBuyingOrders(token, { first: 50, maxPages: 8 });
    const limiter = createLimiter(4);

    let inspectedOrders = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let noPendingUnit = 0;
    let skippedNoVariant = 0;
    let skippedNotPendingVariant = 0;
    let errors = 0;

    await Promise.all(
      orders.map((listNode) =>
        limiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) return;

          const fastVariant = extractStockxVariantId(listNode, null);
          if (!fastVariant) {
            skippedNoVariant += 1;
            return;
          }
          const supplierVariantId = `stx_${fastVariant}`;
          if (!pendingSupplierVariantIds.has(supplierVariantId)) {
            skippedNotPendingVariant += 1;
            return;
          }

          inspectedOrders += 1;
          let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetails>>;
          try {
            details = await fetchStockxBuyOrderDetails(token, {
              chainId,
              orderId: stockxOrderId,
            });
          } catch {
            errors += 1;
            return;
          }

          const variantId = extractStockxVariantId(listNode, details.order);
          if (!variantId) {
            skippedNoVariant += 1;
            return;
          }
          const linkResult = await linkOldestPendingStxUnit({
            galaxusOrderId: reservation.galaxusOrderId,
            supplierVariantId: `stx_${variantId}`,
            stockxOrderId,
            awb: details.awb ?? null,
            etaMin: details.etaMin ?? null,
            etaMax: details.etaMax ?? null,
            checkoutType:
              typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null,
          });

          if (linkResult.status === "linked") linked += 1;
          else if (linkResult.status === "already_linked") alreadyLinked += 1;
          else if (linkResult.status === "no_pending_unit") noPendingUnit += 1;
        })
      )
    );

    const status = await getStxLinkStatusForOrder(reservation.galaxusOrderId);
    return NextResponse.json({
      ok: true,
      galaxusOrderId: reservation.galaxusOrderId,
      reserve: reservation,
      sync: {
        fetchedOrders: orders.length,
        inspectedOrders,
        linked,
        alreadyLinked,
        noPendingUnit,
        skippedNoVariant,
        skippedNotPendingVariant,
        errors,
      },
      status,
    });
  } catch (error: any) {
    console.error("[GALAXUS][STX][SYNC] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Sync StockX orders failed" },
      { status: 500 }
    );
  }
}

