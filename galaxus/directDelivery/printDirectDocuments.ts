import "server-only";

import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import type { BrowserPrintConfig } from "@/galaxus/directDelivery/runDirectSwissPostLabel";
import type { LpJobResult } from "@/lib/cupsLpPrint";
import {
  printLabelLocally,
  printPackingDocumentLocally,
  shouldAutoPrintPackingDocument,
  shouldAutoPrintShippingLabel,
} from "@/lib/printEnv";

type LabelPayload = {
  base64: string;
  extension: string;
};

/**
 * Local packing-station print for Galaxus direct:
 * - Swiss Post label → Brother (62×100) when auto-print on
 * - Delivery note → HP A4 when document exists + packing auto-print on
 *
 * Fresh create always prints. Reprint only when `allowReprint` and status is REPRINT.
 */
export async function printDirectDeliveryDocumentsLocally(options: {
  orderRef: string;
  shipmentId?: string | null;
  status?: string | null;
  allowReprint?: boolean;
  labelData?: LabelPayload | null;
  browserPrintConfig?: BrowserPrintConfig;
}): Promise<{
  browserPrintConfig?: BrowserPrintConfig;
  printJobResult: LpJobResult | null;
  deliveryNotePrintResult: LpJobResult | null;
}> {
  const status = String(options.status ?? "").toUpperCase();
  const allowReprint = Boolean(options.allowReprint);
  const shouldPrintLabel =
    status === "CREATED" || (allowReprint && status === "REPRINT");

  let browserPrintConfig = options.browserPrintConfig
    ? { ...options.browserPrintConfig }
    : undefined;
  let printJobResult: LpJobResult | null = null;
  let deliveryNotePrintResult: LpJobResult | null = null;

  if (
    shouldPrintLabel &&
    shouldAutoPrintShippingLabel() &&
    options.labelData?.base64
  ) {
    printJobResult = await printLabelLocally({
      base64: options.labelData.base64,
      extension: options.labelData.extension || "pdf",
      jobName: `galaxus-direct-${options.orderRef}`,
      widthMm: browserPrintConfig?.widthMm,
      heightMm: browserPrintConfig?.heightMm,
    });
    // Suppress browser popup only when CUPS actually printed. Failed/skipped
    // jobs must keep enabled so the scan page can open the label popup.
    if (browserPrintConfig && printJobResult?.ok) {
      browserPrintConfig = { ...browserPrintConfig, enabled: false };
    }
  }

  const shipmentId = String(options.shipmentId ?? "").trim();
  if (shouldPrintLabel && shipmentId && shouldAutoPrintPackingDocument()) {
    const doc = await prisma.document.findFirst({
      where: { shipmentId, type: DocumentType.DELIVERY_NOTE },
      orderBy: { version: "desc" },
      select: { storageUrl: true },
    });
    if (doc?.storageUrl) {
      try {
        const storage = getStorageAdapterForUrl(doc.storageUrl);
        const file = await storage.getPdf(doc.storageUrl);
        deliveryNotePrintResult = await printPackingDocumentLocally({
          buffer: file.content as Buffer,
          jobName: `galaxus-direct-dn-${options.orderRef}`,
        });
      } catch (err: any) {
        deliveryNotePrintResult = {
          ok: false,
          error: err?.message ?? String(err),
        };
      }
    }
  }

  return { browserPrintConfig, printJobResult, deliveryNotePrintResult };
}
