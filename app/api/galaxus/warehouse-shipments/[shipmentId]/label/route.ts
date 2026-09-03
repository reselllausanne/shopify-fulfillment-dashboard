import { NextRequest, NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { resolveBrowserPrintConfig } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import { isLocalStation, maybePrintLabelLocally } from "@/lib/printEnv";
import type { LpJobResult } from "@/lib/cupsLpPrint";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extensionToMimeType(extension: string) {
  const ext = String(extension || "").trim().toLowerCase();
  if (ext === "pdf") return "application/pdf";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  return "application/octet-stream";
}

function extensionFromUrl(storageUrl: string): string {
  const m = storageUrl.match(/\.([a-z0-9]+)(?:\?|$)/i);
  return (m?.[1] || "pdf").toLowerCase();
}

/**
 * Auto-print helper for /scan warehouse-shipment fallback.
 *
 * Prefers most recent Swiss Post shipping-label Document; falls back to
 * Shipment.labelPdfUrl (SSCC content label) when no Swiss Post PDF is
 * attached. Returns base64 payload + browserPrintConfig so the scan page
 * can open the same print popup used by direct-delivery.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ shipmentId: string }> }
) {
  try {
    const staffRole = await getStaffRoleFromRequest(request);
    if (!staffRole) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    const { shipmentId } = await params;
    if (!shipmentId) {
      return NextResponse.json({ ok: false, error: "Missing shipmentId" }, { status: 400 });
    }

    const shipment = await prisma.shipment.findUnique({
      where: { id: shipmentId },
      select: {
        id: true,
        orderId: true,
        labelPdfUrl: true,
        trackingNumber: true,
      },
    });
    if (!shipment) {
      return NextResponse.json({ ok: false, error: "Shipment not found" }, { status: 404 });
    }

    const localStation = isLocalStation();
    const browserPrintBase = resolveBrowserPrintConfig();
    const browserPrintConfig = {
      ...browserPrintBase,
      // Local packing station prints server-side; suppress popup.
      enabled: !localStation && browserPrintBase.enabled,
    };

    const runLocalPrint = async (
      base64: string,
      extension: string,
      jobName: string
    ): Promise<LpJobResult | null> => {
      if (!localStation) return null;
      return maybePrintLabelLocally({
        base64,
        extension,
        jobName,
        widthMm: browserPrintBase.widthMm,
        heightMm: browserPrintBase.heightMm,
      });
    };

    const swissDoc = await prisma.document.findFirst({
      where: {
        shipmentId,
        type: DocumentType.LABEL,
        storageUrl: { contains: "shipping-labels" },
      },
      orderBy: { version: "desc" },
    });

    if (swissDoc?.storageUrl) {
      const storage = getStorageAdapterForUrl(swissDoc.storageUrl);
      const file = await storage.getPdf(swissDoc.storageUrl);
      const extension = extensionFromUrl(swissDoc.storageUrl);
      const base64 = file.content.toString("base64");
      const printJobResult = await runLocalPrint(
        base64,
        extension,
        `warehouse-${shipmentId}-v${swissDoc.version}`
      );
      return NextResponse.json({
        ok: true,
        source: "swiss_post_document",
        documentId: swissDoc.id,
        version: swissDoc.version,
        trackingNumber: shipment.trackingNumber ?? null,
        labelData: {
          base64,
          mimeType: extensionToMimeType(extension),
          extension,
        },
        browserPrintConfig,
        printJobResult,
      });
    }

    if (shipment.labelPdfUrl) {
      const storage = getStorageAdapterForUrl(shipment.labelPdfUrl);
      const file = await storage.getPdf(shipment.labelPdfUrl);
      const extension = extensionFromUrl(shipment.labelPdfUrl);
      const base64 = file.content.toString("base64");
      const printJobResult = await runLocalPrint(
        base64,
        extension,
        `warehouse-${shipmentId}-sscc`
      );
      return NextResponse.json({
        ok: true,
        source: "sscc_label",
        trackingNumber: shipment.trackingNumber ?? null,
        labelData: {
          base64,
          mimeType: extensionToMimeType(extension),
          extension,
        },
        browserPrintConfig,
        printJobResult,
      });
    }

    return NextResponse.json(
      { ok: false, error: "No label attached to this warehouse shipment" },
      { status: 404 }
    );
  } catch (error: any) {
    console.error("[GALAXUS][WAREHOUSE-SHIPMENT][LABEL] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load warehouse shipment label" },
      { status: 500 }
    );
  }
}
