import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { awbLookupCandidates } from "@/app/lib/stockxInboundHomeRoutes";
import {
  computeShipmentCoverageForOrders,
  loadDelrShipmentIdsForOrders,
  loadShipmentItemsForOrders,
  type WarehouseOrderForCoverage,
} from "@/galaxus/warehouse/shipmentLineCoverage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Max pairs per packing session (one warehouse box). */
export const PACKING_SESSION_CAP = 8;

type SessionEntry = {
  galaxusOrderId: string;
  galaxusOrderLineId: string;
  unitIndex: number;
  supplierPid: string;
  gtin?: string | null;
};

type RejectResponse = {
  ok: false;
  sessionCap: number;
  rejected: { reason: string; scanCode: string };
};

type MatchResponse = {
  ok: true;
  sessionCap: number;
  matched: {
    galaxusOrderId: string;
    galaxusOrderDbId: string;
    galaxusOrderNumber: string | null;
    orderDate: string;
    orderCreatedAt: string;
    lineId: string;
    lineNumber: number;
    unitIndex: number;
    supplierPid: string;
    gtin: string | null;
    productName: string | null;
    sizeEU: string | null;
    physicalDeliveryNoteRequired: boolean;
    remainingBefore: number;
    resolvedVia: "awb_stx_purchase_unit" | "gtin" | "supplier_pid" | "buyer_pid" | "supplier_sku";
    notes?: string[];
  };
};

type ResponseBody = MatchResponse | RejectResponse;

function normalizeGtinCandidates(candidates: string[]): string[] {
  const set = new Set<string>();
  for (const c of candidates) {
    const digits = c.replace(/\D/g, "");
    if (digits.length >= 8 && digits.length <= 14) {
      set.add(digits);
      // Also normalize leading zeros (some feeds store 13 without leading 0).
      set.add(digits.replace(/^0+/, ""));
    }
  }
  return Array.from(set).filter((v) => v.length >= 8);
}

function reject(reason: string, scanCode: string): NextResponse<RejectResponse> {
  return NextResponse.json(
    { ok: false, sessionCap: PACKING_SESSION_CAP, rejected: { reason, scanCode } },
    { status: 200 }
  );
}

export async function POST(req: NextRequest): Promise<NextResponse<ResponseBody>> {
  try {
    const body = await req.json().catch(() => ({}));
    const scanCodeRaw = String(body?.scanCode ?? "").trim();
    if (!scanCodeRaw) {
      return reject("Missing scan code", "");
    }

    const rawSession = Array.isArray(body?.session) ? body.session : [];
    const session: SessionEntry[] = rawSession
      .map((row: any) => ({
        galaxusOrderId: String(row?.galaxusOrderId ?? "").trim(),
        galaxusOrderLineId: String(row?.galaxusOrderLineId ?? "").trim(),
        unitIndex: Number(row?.unitIndex ?? 0) || 0,
        supplierPid: String(row?.supplierPid ?? "").trim(),
        gtin: row?.gtin ? String(row.gtin).trim() : null,
      }))
      .filter((row: SessionEntry) => row.galaxusOrderLineId);

    if (session.length >= PACKING_SESSION_CAP) {
      return reject(
        `Session already at cap ${PACKING_SESSION_CAP} pairs`,
        scanCodeRaw
      );
    }

    const notes: string[] = [];
    const awbCandidatesBase = awbLookupCandidates(scanCodeRaw);
    // Include raw scan and common StockX order-number shapes (e.g. "03-XXXXX") so
    // `contains` matches against StxPurchaseUnit.stockxOrderNumber work verbatim.
    const stockxOrderShape = scanCodeRaw
      .toUpperCase()
      .replace(/[^A-Z0-9-]/g, "");
    const awbCandidates = Array.from(
      new Set(
        [scanCodeRaw.toUpperCase(), stockxOrderShape, ...awbCandidatesBase].filter(
          (v) => v && v.length >= 4
        )
      )
    );
    const gtinCandidates = normalizeGtinCandidates([scanCodeRaw, ...awbCandidatesBase]);

    // -------- Path 1: AWB → StxPurchaseUnit --------
    let sourceGtins: string[] = [];
    let sourceSupplierPids: string[] = [];
    let resolvedVia: MatchResponse["matched"]["resolvedVia"] = "gtin";

    if (awbCandidates.length > 0) {
      const stxUnit = await prisma.stxPurchaseUnit.findFirst({
        where: {
          OR: [
            { awb: { in: awbCandidates } },
            ...awbCandidates.map((c) => ({
              manualTrackingRaw: { contains: c, mode: "insensitive" as const },
            })),
            ...awbCandidates.map((c) => ({
              stockxOrderNumber: { contains: c, mode: "insensitive" as const },
            })),
          ],
          cancelledAt: null,
        },
        select: {
          gtin: true,
          supplierVariantId: true,
          galaxusOrderId: true,
        },
      });
      if (stxUnit?.gtin) {
        sourceGtins.push(stxUnit.gtin);
        resolvedVia = "awb_stx_purchase_unit";
        notes.push(
          `AWB matched StxPurchaseUnit for gtin ${stxUnit.gtin} (order ref ${stxUnit.galaxusOrderId})`
        );
      }
    }

    // -------- Path 2: fallback — scan is a product barcode / SKU --------
    if (sourceGtins.length === 0 && sourceSupplierPids.length === 0) {
      const supplierPidCandidates = new Set<string>();
      supplierPidCandidates.add(scanCodeRaw);
      supplierPidCandidates.add(scanCodeRaw.toUpperCase());
      // Common `STX_<gtin>` and `NER_<gtin>` shapes may be scanned raw.
      for (const g of gtinCandidates) {
        supplierPidCandidates.add(`STX_${g}`);
        supplierPidCandidates.add(`NER_${g}`);
        supplierPidCandidates.add(`THE_${g}`);
        supplierPidCandidates.add(`GLD_${g}`);
      }
      sourceSupplierPids = Array.from(supplierPidCandidates).filter((v) => v.length > 0);
      sourceGtins = gtinCandidates;

      // Style / StockX SKU (e.g. DX0755-500) lives on SupplierVariant.supplierSku,
      // not on GalaxusOrderLine.supplierPid (which is STX_<gtin>). Resolve → GTINs.
      const skuNeedle = scanCodeRaw.trim();
      if (skuNeedle.length >= 4 && !/^\d{8,14}$/.test(skuNeedle.replace(/\D/g, "") || "")) {
        const variants = await prisma.supplierVariant.findMany({
          where: {
            supplierSku: { equals: skuNeedle, mode: "insensitive" },
            gtin: { not: null },
          },
          select: { gtin: true, providerKey: true, supplierSku: true },
          take: 250,
        });
        if (variants.length > 0) {
          const fromSkuGtins = normalizeGtinCandidates(
            variants.map((v) => String(v.gtin ?? "")).filter(Boolean)
          );
          const fromSkuPids = variants
            .map((v) => String(v.providerKey ?? "").trim())
            .filter(Boolean);
          sourceGtins = Array.from(new Set([...sourceGtins, ...fromSkuGtins]));
          sourceSupplierPids = Array.from(new Set([...sourceSupplierPids, ...fromSkuPids]));
          resolvedVia = "supplier_sku";
          notes.push(
            `SKU ${variants[0].supplierSku} → ${fromSkuGtins.length} GTIN(s) via SupplierVariant`
          );
        }
      }
    }

    if (sourceGtins.length === 0 && sourceSupplierPids.length === 0) {
      return reject("Scan is not a recognizable barcode / AWB", scanCodeRaw);
    }

    // -------- Find candidate pending warehouse lines --------
    const orFilter: any[] = [];
    if (sourceGtins.length > 0) orFilter.push({ gtin: { in: sourceGtins } });
    if (sourceSupplierPids.length > 0) {
      orFilter.push({ supplierPid: { in: sourceSupplierPids } });
      orFilter.push({ buyerPid: { in: sourceSupplierPids } });
      orFilter.push({ supplierSku: { in: sourceSupplierPids } });
    }

    const candidateLines = await prisma.galaxusOrderLine.findMany({
      where: {
        OR: orFilter,
        order: {
          cancelledAt: null,
          archivedAt: null,
          deliveryType: { not: "direct_delivery" },
        },
      },
      select: {
        id: true,
        lineNumber: true,
        quantity: true,
        buyerPid: true,
        supplierPid: true,
        gtin: true,
        productName: true,
        size: true,
        warehouseMarkedShippedAt: true,
        order: {
          select: {
            id: true,
            galaxusOrderId: true,
            orderNumber: true,
            orderDate: true,
            createdAt: true,
            deliveryType: true,
            physicalDeliveryNoteRequired: true,
          },
        },
      },
    });

    if (candidateLines.length === 0) {
      return reject(
        "No pending warehouse pair matches this scan",
        scanCodeRaw
      );
    }

    // Exclude any direct-delivery survivors (belt & suspenders — filter above already excludes).
    const filtered = candidateLines.filter(
      (l) => String(l.order.deliveryType ?? "").toLowerCase() !== "direct_delivery"
    );
    if (filtered.length === 0) {
      return reject("Only direct-delivery orders match — not a warehouse pair", scanCodeRaw);
    }

    // Build coverage per candidate line.
    const orderIds = Array.from(new Set(filtered.map((l) => l.order.id)));
    const orderRefs = Array.from(
      new Set(filtered.map((l) => l.order.galaxusOrderId).filter(Boolean))
    );
    const [delrShipmentIds, existingItems] = await Promise.all([
      loadDelrShipmentIdsForOrders(orderIds, orderRefs),
      loadShipmentItemsForOrders(orderIds),
    ]);

    // Group candidate lines by order for coverage computation.
    const linesByOrder = new Map<string, typeof filtered>();
    for (const l of filtered) {
      const arr = linesByOrder.get(l.order.id) ?? [];
      arr.push(l);
      linesByOrder.set(l.order.id, arr);
    }
    const coverageInput: WarehouseOrderForCoverage[] = Array.from(linesByOrder.entries()).map(
      ([orderId, lines]) => ({
        id: orderId,
        galaxusOrderId: lines[0].order.galaxusOrderId,
        lines: lines.map((l) => ({
          id: l.id,
          quantity: l.quantity ?? 0,
          buyerPid: l.buyerPid ?? null,
          supplierPid: l.supplierPid ?? null,
          gtin: l.gtin ?? null,
          warehouseMarkedShippedAt: l.warehouseMarkedShippedAt ?? null,
        })),
      })
    );
    const coverage = computeShipmentCoverageForOrders(
      coverageInput,
      existingItems,
      delrShipmentIds
    );

    // Count in-session assignments per line.
    const sessionCountByLine = new Map<string, number>();
    for (const s of session) {
      sessionCountByLine.set(
        s.galaxusOrderLineId,
        (sessionCountByLine.get(s.galaxusOrderLineId) ?? 0) + 1
      );
    }

    // Sort FIFO by orderDate asc, createdAt asc, lineNumber asc.
    const sorted = [...filtered].sort((a, b) => {
      const dateA = a.order.orderDate.getTime();
      const dateB = b.order.orderDate.getTime();
      if (dateA !== dateB) return dateA - dateB;
      const createdA = a.order.createdAt.getTime();
      const createdB = b.order.createdAt.getTime();
      if (createdA !== createdB) return createdA - createdB;
      return (a.lineNumber ?? 0) - (b.lineNumber ?? 0);
    });

    for (const line of sorted) {
      const cov = coverage[line.id];
      if (!cov) continue;
      const inSession = sessionCountByLine.get(line.id) ?? 0;
      const availableAfterSession = cov.remaining - inSession;
      if (availableAfterSession <= 0) continue;

      const unitIndex = cov.shipped + cov.reserved + inSession;
      const gtin = line.gtin ?? null;
      const supplierPid = line.supplierPid ?? line.buyerPid ?? "";

      if (resolvedVia === "gtin" && sourceGtins.length === 0) {
        // Scan was a supplier PID / buyer PID.
        if (
          sourceSupplierPids.some(
            (v) =>
              v === (line.supplierPid ?? "") ||
              v === (line.buyerPid ?? "") ||
              v.toUpperCase() === String(line.supplierPid ?? "").toUpperCase() ||
              v.toUpperCase() === String(line.buyerPid ?? "").toUpperCase()
          )
        ) {
          resolvedVia =
            line.supplierPid && sourceSupplierPids.includes(line.supplierPid)
              ? "supplier_pid"
              : "buyer_pid";
        }
      }
      // Keep resolvedVia === "supplier_sku" when catalog SKU expanded to GTINs.

      return NextResponse.json(
        {
          ok: true,
          sessionCap: PACKING_SESSION_CAP,
          matched: {
            galaxusOrderId: line.order.galaxusOrderId,
            galaxusOrderDbId: line.order.id,
            galaxusOrderNumber: line.order.orderNumber ?? null,
            orderDate: line.order.orderDate.toISOString(),
            orderCreatedAt: line.order.createdAt.toISOString(),
            lineId: line.id,
            lineNumber: line.lineNumber,
            unitIndex,
            supplierPid,
            gtin,
            productName: line.productName ?? null,
            sizeEU: line.size ?? null,
            physicalDeliveryNoteRequired: Boolean(line.order.physicalDeliveryNoteRequired),
            remainingBefore: cov.remaining,
            resolvedVia,
            ...(notes.length > 0 ? { notes } : {}),
          },
        },
        { status: 200 }
      );
    }

    return reject(
      "All matching warehouse pairs already packed / assigned in this session",
      scanCodeRaw
    );
  } catch (err: any) {
    console.error("[SCAN-AWB][packing-session] error:", err);
    return NextResponse.json(
      {
        ok: false,
        sessionCap: PACKING_SESSION_CAP,
        rejected: {
          reason: err?.message || "Internal error",
          scanCode: "",
        },
      },
      { status: 500 }
    );
  }
}
