import { NextResponse } from "next/server";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { prisma } from "@/app/lib/prisma";
import {
  expandGtinsForDbLookup,
  getStxLinkStatusForOrder,
  linkOldestPendingStxUnit,
  reserveStxPurchaseUnitsForOrder,
  resolveGalaxusOrderByIdOrRef,
} from "@/galaxus/stx/purchaseUnits";
import { resolveStockxBuyByOrderNumberWithToken } from "@/decathlon/stx/manualStockxEnrich";
import { leanBuyOrder } from "@/galaxus/stx/leanBuyOrder";
import {
  extractStockxVariantId,
  fetchRecentStockxBuyingOrders,
  fetchStockxBuyOrderDetailsFull,
  type StockxBuyingNode,
} from "@/galaxus/stx/stockxClient";
import {
  GALAXUS_STOCKX_SESSION_FILE,
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import { extractAwbFromTrackingUrl } from "@/app/lib/stockxTracking";
import {
  galaxusLineWarehouseStockHint,
  isGalaxusStxSupplierLine,
} from "@/galaxus/warehouse/lineInventorySource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isUnknownCancelledAtArg(error: any): boolean {
  return String(error?.message ?? "").includes("Unknown argument `cancelledAt`");
}

function resolveAwbFromDetails(details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>> | null) {
  const direct = String(details?.awb ?? "").trim();
  if (direct) return direct;
  const trackingUrl = details?.order?.shipping?.shipment?.trackingUrl ?? null;
  return extractAwbFromTrackingUrl(trackingUrl);
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const { searchParams } = new URL(_request.url);
    const mode = String(searchParams.get("mode") ?? "").trim().toLowerCase();
    const { orderId } = await params;
    const reservation = await reserveStxPurchaseUnitsForOrder(orderId);
    if (mode === "reserve") {
      return NextResponse.json({
        ok: true,
        galaxusOrderId: reservation.galaxusOrderId,
        reserve: reservation,
        status: reservation.status,
      });
    }
    const initialStatus = reservation.status;
    console.info("[GALAXUS][STX][SYNC] Start", {
      galaxusOrderId: reservation.galaxusOrderId,
      buckets: initialStatus.buckets?.map((bucket) => ({
        gtin: bucket.gtin,
        supplierVariantId: bucket.supplierVariantId,
        needed: bucket.needed,
        reserved: bucket.reserved,
        linked: bucket.linked,
        linkedWithEta: bucket.linkedWithEta,
      })),
    });
    const pendingSupplierVariantIds = new Set(
      initialStatus.buckets
        .filter((bucket) => bucket.linked < bucket.needed)
        .map((bucket) => bucket.supplierVariantId)
    );
    const etaBackfillSupplierVariantIds = new Set(
      initialStatus.buckets
        .filter((bucket) => bucket.linkedWithEta < bucket.needed)
        .map((bucket) => bucket.supplierVariantId)
    );
    const awbBackfillSupplierVariantIds = new Set(
      initialStatus.buckets
        .filter((bucket) => bucket.linkedWithAwb < bucket.needed)
        .map((bucket) => bucket.supplierVariantId)
    );

    const prismaAny = prisma as any;
    const unitsNeedingSettled: Array<{ supplierVariantId: string; stockxOrderId: string }> =
      await prismaAny.stxPurchaseUnit
        .findMany({
          where: {
            galaxusOrderId: reservation.galaxusOrderId,
            supplierVariantId: { startsWith: "stx_" },
            stockxOrderId: { not: null },
            stockxSettledAmount: null,
            cancelledAt: null,
          },
          select: { supplierVariantId: true, stockxOrderId: true },
        })
        .catch(() => []);
    const settledBackfillKeys = new Set(
      (unitsNeedingSettled ?? []).map(
        (u: { supplierVariantId: string; stockxOrderId: string }) =>
          `${String(u.stockxOrderId).trim()}::${String(u.supplierVariantId).trim()}`
      )
    );

    const unlinkedPurchaseUnits = await prismaAny.stxPurchaseUnit.count({
      where: {
        galaxusOrderId: reservation.galaxusOrderId,
        supplierVariantId: { startsWith: "stx_" },
        stockxOrderId: null,
        cancelledAt: null,
      },
    });

    const needsAnySyncWork =
      pendingSupplierVariantIds.size > 0 ||
      etaBackfillSupplierVariantIds.size > 0 ||
      awbBackfillSupplierVariantIds.size > 0 ||
      settledBackfillKeys.size > 0 ||
      unlinkedPurchaseUnits > 0;

    if (!needsAnySyncWork) {
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
          settledBackfilled: 0,
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

    // Same as Decathlon sync: only the Pro "pending" buying list (state=PENDING). Shipped buys won't appear.
    let orders: StockxBuyingNode[] = [];
    let stockxListFetchError: string | null = null;
    try {
      orders = await fetchRecentStockxBuyingOrders(token, { first: 50, maxPages: 8, state: "PENDING" });
    } catch (err: any) {
      stockxListFetchError = err?.message ?? String(err);
      console.error("[GALAXUS][STX][SYNC] fetchRecentStockxBuyingOrders failed:", err);
    }
    if (stockxListFetchError) {
      const st = await getStxLinkStatusForOrder(reservation.galaxusOrderId).catch(() => null);
      return NextResponse.json(
        {
          ok: false,
          error: `StockX buying list request failed: ${stockxListFetchError}`,
          galaxusOrderId: reservation.galaxusOrderId,
          reserve: reservation,
          status: st,
        },
        { status: 502 }
      );
    }

    const stockxListWarning =
      orders.length === 0 && needsAnySyncWork
        ? "StockX returned 0 rows for state=PENDING (same as Decathlon). Buys that already shipped are not in this feed — use Manual supplier: enter the StockX order # and save to load AWB, cost, and ETAs from the API."
        : null;

    console.info("[GALAXUS][STX][SYNC] StockX buying orders fetched", {
      count: orders.length,
      sample: orders.slice(0, 3).map((node: any) => ({
        chainId: node?.chainId ?? null,
        orderId: node?.orderId ?? null,
        orderNumber: node?.orderNumber ?? null,
        purchaseDate: node?.purchaseDate ?? null,
        statusKey: node?.state?.statusKey ?? null,
        size: node?.localizedSizeTitle ?? node?.productVariant?.traits?.size ?? null,
        productTitle: node?.productVariant?.product?.title ?? node?.productVariant?.product?.name ?? null,
        styleId: node?.productVariant?.product?.styleId ?? null,
        variantId: node?.productVariant?.id ?? null,
      })),
    });
    for (const node of orders as any[]) {
      console.info("[GALAXUS][STX][SYNC][STOCKX_ORDER]", {
        chainId: node?.chainId ?? null,
        orderId: node?.orderId ?? null,
        orderNumber: node?.orderNumber ?? null,
        purchaseDate: node?.purchaseDate ?? null,
        statusKey: node?.state?.statusKey ?? null,
        statusTitle: node?.state?.statusTitle ?? null,
        amount: node?.amount ?? null,
        currencyCode: node?.currencyCode ?? null,
        estimatedDeliveryDate: node?.estimatedDeliveryDateRange?.estimatedDeliveryDate ?? null,
        latestEstimatedDeliveryDate: node?.estimatedDeliveryDateRange?.latestEstimatedDeliveryDate ?? null,
        localizedSizeTitle: node?.localizedSizeTitle ?? null,
        localizedSizeType: node?.localizedSizeType ?? null,
        baseSize: node?.productVariant?.sizeChart?.baseSize ?? null,
        baseType: node?.productVariant?.sizeChart?.baseType ?? null,
        traitSize: node?.productVariant?.traits?.size ?? null,
        product: {
          title: node?.productVariant?.product?.title ?? null,
          name: node?.productVariant?.product?.name ?? null,
          model: node?.productVariant?.product?.model ?? null,
          styleId: node?.productVariant?.product?.styleId ?? null,
          category: node?.productVariant?.product?.productCategory ?? null,
          primaryCategory: node?.productVariant?.product?.primaryCategory ?? null,
        },
        productVariantId: node?.productVariant?.id ?? null,
      });
    }

    let inspectedOrders = 0;
    let linked = 0;
    let alreadyLinked = 0;
    let noPendingUnit = 0;
    let missingEta = 0;
    let etaBackfilled = 0;
    let awbBackfilled = 0;
    let settledBackfilled = 0;
    let skippedNoVariant = 0;
    let skippedNotPendingVariant = 0;
    let errors = 0;
    let linkedFromSavedMatches = 0;
    let savedMatchAttempts = 0;
    let savedMatchSkipped = 0;

    /** Link `StxPurchaseUnit` rows using chain/order (or order # lookup) already stored on `GalaxusStockxMatch` from manual save — the PENDING feed alone never sees shipped buys. */
    const galaxusOrderRow = await resolveGalaxusOrderByIdOrRef(orderId);
    if (galaxusOrderRow) {
      const savedMatches = await prismaAny.galaxusStockxMatch.findMany({
        where: { galaxusOrderId: galaxusOrderRow.id },
      });
      const detailsCache = new Map<string, Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>>();

      for (const match of savedMatches) {
        savedMatchAttempts += 1;
        let chainId = String(match.stockxChainId ?? "").trim();
        let buyOrderId = String(match.stockxOrderId ?? "").trim();
        const orderNumRaw = String(match.stockxOrderNumber ?? "").trim();

        if ((!chainId || !buyOrderId) && orderNumRaw && !/^MANUAL-/i.test(orderNumRaw)) {
          const resolved = await resolveStockxBuyByOrderNumberWithToken(token, orderNumRaw);
          if (resolved.ok) {
            chainId = String(resolved.listNode.chainId ?? "").trim();
            buyOrderId = String(resolved.listNode.orderId ?? "").trim();
          }
        }
        if (!chainId || !buyOrderId) {
          savedMatchSkipped += 1;
          continue;
        }

        const line = (galaxusOrderRow.lines ?? []).find((l: any) => l.id === match.galaxusOrderLineId);
        if (!line) {
          savedMatchSkipped += 1;
          continue;
        }
        const whSkip = galaxusLineWarehouseStockHint(line);
        if (whSkip && isGalaxusStxSupplierLine(line)) {
          savedMatchSkipped += 1;
          continue;
        }

        const buyKey = `${chainId}::${buyOrderId}`;
        let details = detailsCache.get(buyKey);
        if (!details) {
          try {
            details = await fetchStockxBuyOrderDetailsFull(token, {
              chainId,
              orderId: buyOrderId,
            });
            detailsCache.set(buyKey, details);
          } catch (e: any) {
            errors += 1;
            console.error("[GALAXUS][STX][SYNC][SAVED_MATCH_FETCH]", buyKey, e?.message);
            savedMatchSkipped += 1;
            continue;
          }
        }

        const variantFromBuy = extractStockxVariantId(null, details.order);
        const resolvedAwb = resolveAwbFromDetails(details);
        const svFromMatch = String(match.stockxVariantId ?? "").trim();
        let supplierVariantId = svFromMatch.startsWith("stx_")
          ? svFromMatch
          : svFromMatch
            ? `stx_${svFromMatch}`
            : variantFromBuy
              ? `stx_${variantFromBuy}`
              : null;
        if (!supplierVariantId) {
          savedMatchSkipped += 1;
          continue;
        }
        if (variantFromBuy && `stx_${variantFromBuy}` !== supplierVariantId) {
          console.info("[GALAXUS][STX][SYNC][SAVED_MATCH_VARIANT_MISMATCH]", {
            buyOrderId,
            fromMatch: supplierVariantId,
            fromBuy: `stx_${variantFromBuy}`,
          });
          savedMatchSkipped += 1;
          continue;
        }

        const gtinKeys = expandGtinsForDbLookup([String(line.gtin ?? "")]);
        let hasPending = gtinKeys.length
          ? await prismaAny.stxPurchaseUnit.findFirst({
              where: {
                galaxusOrderId: reservation.galaxusOrderId,
                supplierVariantId,
                stockxOrderId: null,
                cancelledAt: null,
                gtin: { in: gtinKeys },
              },
              select: { id: true },
            })
          : null;
        if (!hasPending) {
          hasPending = await prismaAny.stxPurchaseUnit.findFirst({
            where: {
              galaxusOrderId: reservation.galaxusOrderId,
              supplierVariantId,
              stockxOrderId: null,
              cancelledAt: null,
            },
            select: { id: true },
          });
        }
        if (!hasPending) {
          savedMatchSkipped += 1;
          continue;
        }

        const normalizedEtaMin = details.etaMin ?? details.etaMax ?? null;
        const normalizedEtaMax = details.etaMax ?? details.etaMin ?? null;
        const settledRaw = details?.order?.payment?.settledAmount;
        const stockxSettledAmount =
          settledRaw?.value != null && Number.isFinite(Number(settledRaw.value))
            ? Number(settledRaw.value)
            : null;
        const stockxSettledCurrency =
          typeof settledRaw?.currency === "string" ? String(settledRaw.currency).trim() : null;
        const stockxOrderNumberResolved =
          orderNumRaw || String(details.order?.orderNumber ?? "").trim() || null;

        let awbUpdateCount = 0;
        if (resolvedAwb) {
          try {
            const updated = await prismaAny.stxPurchaseUnit.updateMany({
              where: {
                galaxusOrderId: reservation.galaxusOrderId,
                supplierVariantId,
                stockxOrderId: buyOrderId,
                awb: null,
                cancelledAt: null,
              },
              data: { awb: resolvedAwb },
            });
            awbUpdateCount = updated?.count ?? 0;
          } catch (error: any) {
            if (!isUnknownCancelledAtArg(error)) throw error;
            const updated = await prismaAny.stxPurchaseUnit.updateMany({
              where: {
                galaxusOrderId: reservation.galaxusOrderId,
                supplierVariantId,
                stockxOrderId: buyOrderId,
                awb: null,
              },
              data: { awb: resolvedAwb },
            });
            awbUpdateCount = updated?.count ?? 0;
          }
          if (awbUpdateCount > 0) awbBackfilled += awbUpdateCount;
        }

        const linkResult = await linkOldestPendingStxUnit({
          galaxusOrderId: reservation.galaxusOrderId,
          supplierVariantId,
          stockxOrderId: buyOrderId,
          awb: resolvedAwb ?? null,
          etaMin: normalizedEtaMin,
          etaMax: normalizedEtaMax,
          checkoutType: typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null,
          stockxOrderNumber: stockxOrderNumberResolved,
          stockxSettledAmount,
          stockxSettledCurrency,
          allowMissingEta: true,
        });

        if (linkResult.status === "linked") linkedFromSavedMatches += 1;
        else if (linkResult.status === "already_linked") alreadyLinked += 1;
        else if (linkResult.status === "no_pending_unit") noPendingUnit += 1;
        else if (linkResult.status === "missing_eta") missingEta += 1;
        else savedMatchSkipped += 1;

        console.info("[GALAXUS][STX][SYNC][SAVED_MATCH]", {
          buyOrderId,
          supplierVariantId,
          result: linkResult.status,
          awb: resolvedAwb ?? null,
          awbBackfilled: awbUpdateCount,
        });
      }
    }

    // Enrich all fetched account orders (A+B) for UI log output.
    const enrichLimiter = createLimiter(4);
    const stockxBuyingOrdersEnriched = await Promise.all(
      (orders as any[]).map((listNode) =>
        enrichLimiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) {
            return {
              orderId: stockxOrderId || null,
              chainId: chainId || null,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: null,
              enrichmentError: "missing_order_id",
            };
          }
          try {
            const details = await fetchStockxBuyOrderDetailsFull(token, { chainId, orderId: stockxOrderId });
            const resolvedAwb = resolveAwbFromDetails(details);
            return {
              orderId: stockxOrderId,
              chainId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: {
                awb: resolvedAwb ?? null,
                etaMin: details.etaMin ? details.etaMin.toISOString() : null,
                etaMax: details.etaMax ? details.etaMax.toISOString() : null,
                order: leanBuyOrder(details.order),
              },
            };
          } catch (error: any) {
            return {
              orderId: stockxOrderId,
              chainId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
              purchaseDate: (listNode as any)?.purchaseDate ?? null,
              localizedSizeTitle: (listNode as any)?.localizedSizeTitle ?? null,
              details: null,
              enrichmentError: error?.message ?? "details_failed",
            };
          }
        })
      )
    );

    const limiter = createLimiter(4);

    await Promise.all(
      orders.map((listNode) =>
        limiter(async () => {
          const stockxOrderId = typeof listNode.orderId === "string" ? listNode.orderId.trim() : "";
          const chainId = typeof listNode.chainId === "string" ? listNode.chainId.trim() : "";
          if (!stockxOrderId || !chainId) return;

          // Buying list often omits productVariant.id; full variant id is on order details after GET_BUY_ORDER.
          const fastVariant = extractStockxVariantId(listNode, null);
          if (fastVariant) {
            const supplierVariantId = `stx_${fastVariant}`;
            const isPendingVariant = pendingSupplierVariantIds.has(supplierVariantId);
            const needsEtaBackfill = etaBackfillSupplierVariantIds.has(supplierVariantId);
            const needsAwbBackfill = awbBackfillSupplierVariantIds.has(supplierVariantId);
            const orderMayNeedSettledBackfill = [...settledBackfillKeys].some((k) =>
              k.startsWith(`${stockxOrderId}::`)
            );
            if (!isPendingVariant && !needsEtaBackfill && !needsAwbBackfill && !orderMayNeedSettledBackfill) {
              skippedNotPendingVariant += 1;
              console.info("[GALAXUS][STX][SYNC][SKIP] Not pending variant", {
                chainId,
                orderId: stockxOrderId,
                orderNumber: (listNode as any)?.orderNumber ?? null,
                supplierVariantId,
              });
              return;
            }
          }

          inspectedOrders += 1;
          let details: Awaited<ReturnType<typeof fetchStockxBuyOrderDetailsFull>>;
          try {
            details = await fetchStockxBuyOrderDetailsFull(token, {
              chainId,
              orderId: stockxOrderId,
            });
          } catch {
            errors += 1;
            console.error("[GALAXUS][STX][SYNC][ERROR] Failed to fetch order details", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
            });
            return;
          }

          const variantId = extractStockxVariantId(listNode, details.order);
          if (!variantId) {
            skippedNoVariant += 1;
            console.info("[GALAXUS][STX][SYNC][SKIP] No variant id after details", {
              chainId,
              orderId: stockxOrderId,
              orderNumber: (listNode as any)?.orderNumber ?? null,
            });
            return;
          }
          const resolvedSupplierVariantId = `stx_${variantId}`;
          const isPendingResolved = pendingSupplierVariantIds.has(resolvedSupplierVariantId);
          const needsEtaResolved = etaBackfillSupplierVariantIds.has(resolvedSupplierVariantId);
          const needsAwbResolved = awbBackfillSupplierVariantIds.has(resolvedSupplierVariantId);
          const normalizedEtaMin = details.etaMin ?? details.etaMax ?? null;
          const normalizedEtaMax = details.etaMax ?? details.etaMin ?? null;
          const resolvedAwb = resolveAwbFromDetails(details);
          const checkoutType =
            typeof details.order?.checkoutType === "string" ? details.order.checkoutType : null;
          const settledRaw = details?.order?.payment?.settledAmount;
          const stockxSettledAmount =
            settledRaw?.value != null && Number.isFinite(Number(settledRaw.value))
              ? Number(settledRaw.value)
              : null;
          const stockxSettledCurrency =
            typeof settledRaw?.currency === "string" ? String(settledRaw.currency).trim() : null;
          const stockxOrderNumberFromList =
            typeof (listNode as any)?.orderNumber === "string"
              ? String((listNode as any).orderNumber).trim()
              : null;
          const settledBackfillKey = `${stockxOrderId}::${resolvedSupplierVariantId}`;
          const needsSettledBackfill = settledBackfillKeys.has(settledBackfillKey);

          let linkResult:
            | Awaited<ReturnType<typeof linkOldestPendingStxUnit>>
            | { status: "eta_backfilled" | "eta_not_available" | "eta_no_matching_unit" }
            | { status: "awb_backfilled" | "awb_not_available" | "awb_no_matching_unit" }
            | { status: "settled_backfilled" | "settled_no_row" | "settled_no_amount" };

          if (isPendingResolved) {
            linkResult = await linkOldestPendingStxUnit({
              galaxusOrderId: reservation.galaxusOrderId,
              supplierVariantId: resolvedSupplierVariantId,
              stockxOrderId,
              awb: resolvedAwb ?? null,
              etaMin: normalizedEtaMin,
              etaMax: normalizedEtaMax,
              checkoutType,
              stockxOrderNumber: stockxOrderNumberFromList,
              stockxSettledAmount,
              stockxSettledCurrency,
            });
          } else if (needsEtaResolved) {
            if (!normalizedEtaMin && !normalizedEtaMax && !resolvedAwb && !checkoutType) {
              linkResult = { status: "eta_not_available" };
            } else {
              const updateData: any = {};
              if (normalizedEtaMin) updateData.etaMin = normalizedEtaMin;
              if (normalizedEtaMax) updateData.etaMax = normalizedEtaMax;
              if (resolvedAwb) updateData.awb = resolvedAwb;
              if (checkoutType) updateData.checkoutType = checkoutType;
              if (stockxOrderNumberFromList) updateData.stockxOrderNumber = stockxOrderNumberFromList;
              if (stockxSettledAmount != null && stockxSettledAmount > 0) {
                updateData.stockxSettledAmount = stockxSettledAmount;
                if (stockxSettledCurrency) updateData.stockxSettledCurrency = stockxSettledCurrency;
              }
              let updated: { count: number };
              try {
                updated = await (prisma as any).stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    cancelledAt: null,
                    OR: [{ etaMin: null }, { etaMax: null }],
                  },
                  data: updateData,
                });
              } catch (error: any) {
                if (!isUnknownCancelledAtArg(error)) throw error;
                updated = await (prisma as any).stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    OR: [{ etaMin: null }, { etaMax: null }],
                  },
                  data: updateData,
                });
              }
              if ((updated?.count ?? 0) > 0) {
                etaBackfilled += updated.count;
                linkResult = { status: "eta_backfilled" };
              } else {
                linkResult = { status: "eta_no_matching_unit" };
              }
            }
          } else if (needsAwbResolved) {
            if (!resolvedAwb) {
              linkResult = { status: "awb_not_available" };
            } else {
              const updateData: any = { awb: resolvedAwb };
              if (stockxOrderNumberFromList) updateData.stockxOrderNumber = stockxOrderNumberFromList;
              let updated: { count: number };
              try {
                updated = await (prisma as any).stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    awb: null,
                    cancelledAt: null,
                  },
                  data: updateData,
                });
              } catch (error: any) {
                if (!isUnknownCancelledAtArg(error)) throw error;
                updated = await (prisma as any).stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    awb: null,
                  },
                  data: updateData,
                });
              }
              if ((updated?.count ?? 0) > 0) {
                awbBackfilled += updated.count;
                linkResult = { status: "awb_backfilled" };
              } else {
                linkResult = { status: "awb_no_matching_unit" };
              }
            }
          } else if (needsSettledBackfill) {
            if (stockxSettledAmount == null || stockxSettledAmount <= 0) {
              linkResult = { status: "settled_no_amount" };
            } else {
              const updateData: Record<string, unknown> = {
                stockxSettledAmount,
                stockxSettledCurrency: stockxSettledCurrency ?? null,
              };
              if (stockxOrderNumberFromList) updateData.stockxOrderNumber = stockxOrderNumberFromList;
              let updated: { count: number };
              try {
                updated = await prismaAny.stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    stockxSettledAmount: null,
                    cancelledAt: null,
                  },
                  data: updateData,
                });
              } catch (error: any) {
                if (!isUnknownCancelledAtArg(error)) throw error;
                updated = await prismaAny.stxPurchaseUnit.updateMany({
                  where: {
                    galaxusOrderId: reservation.galaxusOrderId,
                    supplierVariantId: resolvedSupplierVariantId,
                    stockxOrderId,
                    stockxSettledAmount: null,
                  },
                  data: updateData,
                });
              }
              if ((updated?.count ?? 0) > 0) {
                settledBackfilled += updated.count;
                linkResult = { status: "settled_backfilled" };
              } else {
                linkResult = { status: "settled_no_row" };
              }
            }
          } else {
            skippedNotPendingVariant += 1;
            return;
          }

          console.info("[GALAXUS][STX][SYNC][LINK_ATTEMPT]", {
            galaxusOrderId: reservation.galaxusOrderId,
            chainId,
            orderId: stockxOrderId,
            orderNumber: (listNode as any)?.orderNumber ?? null,
            supplierVariantId: resolvedSupplierVariantId,
            awb: resolvedAwb ?? null,
            etaMin: normalizedEtaMin ? normalizedEtaMin.toISOString() : null,
            etaMax: normalizedEtaMax ? normalizedEtaMax.toISOString() : null,
            checkoutType,
            result: linkResult,
          });

          if (linkResult.status === "linked") linked += 1;
          else if (linkResult.status === "already_linked") alreadyLinked += 1;
          else if (linkResult.status === "no_pending_unit") noPendingUnit += 1;
          else if (linkResult.status === "missing_eta") missingEta += 1;
        })
      )
    );

    const status = await getStxLinkStatusForOrder(reservation.galaxusOrderId);
    return NextResponse.json({
      ok: true,
      galaxusOrderId: reservation.galaxusOrderId,
      stockxListWarning,
      // Return StockX account orders so the UI can show them in Ops Log.
      stockxBuyingOrders: orders,
      stockxBuyingOrdersEnriched,
      sync: {
        fetchedOrders: orders.length,
        inspectedOrders,
        linked,
        alreadyLinked,
        noPendingUnit,
        missingEta,
        etaBackfilled,
        skippedNoVariant,
        skippedNotPendingVariant,
        settledBackfilled,
        errors,
        listWarning: stockxListWarning,
        linkedFromSavedMatches,
        savedMatchAttempts,
        savedMatchSkipped,
        awbBackfilled,
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

