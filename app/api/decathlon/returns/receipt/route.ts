import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  MARKETPLACE_RETURN_PLATFORM_DECATHLON,
  isReturnAutomationDryRun,
} from "@/decathlon/returns/receipt/config";
import {
  formatSwissPostLabel,
  normalizeReturnLabelDigits,
} from "@/decathlon/returns/receipt/mapReturn";
import { MIRAKL_TERMINAL_RETURN_STATUSES } from "@/decathlon/returns/receipt/remoteStatus";
import { syncMarketplaceReturns } from "@/decathlon/returns/receipt/sync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function serializeReturn(row: any) {
  const raw = row?.rawJson as any;
  const lineItems: Array<any> = Array.isArray(raw?.lineItems) ? raw.lineItems : [];
  let restockingFeeTotal = 0;
  for (const line of lineItems) {
    const lineFee = Number(line?.restockingFeeAmount);
    if (Number.isFinite(lineFee) && lineFee > 0) {
      restockingFeeTotal += lineFee * (Number(line?.quantity) || 1);
    } else if (Number(line?.restockingFeePercent) > 0) {
      const unit = Number(line?.unitAmount) || 0;
      const qty = Number(line?.quantity) || 1;
      restockingFeeTotal += (unit * qty * Number(line.restockingFeePercent)) / 100;
    }
  }
  restockingFeeTotal = Number(restockingFeeTotal.toFixed(2));
  const gross = row.returnAmount != null ? Number(row.returnAmount) : null;
  const netStoreCredit = gross != null ? Number(Math.max(0, gross - restockingFeeTotal).toFixed(2)) : null;
  return {
    id: row.id,
    platform: row.platform,
    externalReturnId: row.externalReturnId,
    returnName: raw?.return?.name ?? null,
    externalOrderId: row.externalOrderId,
    orderName: raw?.order?.name ?? row.externalOrderId ?? null,
    customerId: raw?.order?.customerId ?? null,
    externalOrderLineId: row.externalOrderLineId,
    productId: row.productId,
    productTitle: row.productTitle,
    sku: row.sku,
    returnLabelNumber: row.returnLabelNumber,
    labelKey: row.labelKey ?? null,
    returnAmount: gross,
    restockingFeeAmount: restockingFeeTotal || null,
    netStoreCreditAmount: netStoreCredit,
    currency: row.currency,
    returnReasonCode: row.returnReasonCode,
    returnReasonLabel: row.returnReasonLabel,
    returnLabelUrl: raw?.reverseDelivery?.labelPublicFileUrl ?? raw?.generatedLabel?.url ?? null,
    miraklStatus: row.miraklStatus,
    localStatus: row.localStatus,
    processStep: row.processStep,
    syncedAt: row.syncedAt,
    receivedAt: row.receivedAt,
    completedAt: row.completedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    failureMessage: row.failureMessage,
    staffNote: row.staffNote,
    quantity: row.quantity,
  };
}

async function findByScannedLabel(platform: string, rawLabel: string) {
  const trimmed = rawLabel.trim();
  const digits = normalizeReturnLabelDigits(trimmed);
  const dotted = digits ? formatSwissPostLabel(digits) : null;

  const exact = await prisma.marketplaceReturn.findFirst({
    where: {
      platform,
      OR: [
        { returnLabelNumber: trimmed },
        ...(dotted ? [{ returnLabelNumber: dotted }] : []),
        { externalOrderId: trimmed },
      ],
    },
    orderBy: { updatedAt: "desc" },
  });
  if (exact) return exact;

  if (!digits) return null;

  const candidates = await prisma.marketplaceReturn.findMany({
    where: {
      platform,
      returnLabelNumber: { not: null },
      localStatus: { in: ["pending_receipt", "failed", "processing", "received"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 300,
  });
  const matches = candidates.filter(
    (row) => normalizeReturnLabelDigits(row.returnLabelNumber) === digits
  );
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    return matches.find((m) => m.localStatus === "pending_receipt") ?? matches[0];
  }
  return null;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const label = String(searchParams.get("label") ?? "").trim();
    const status = String(searchParams.get("status") ?? "").trim();
    const platform = String(searchParams.get("platform") ?? MARKETPLACE_RETURN_PLATFORM_DECATHLON).trim();

    if (label) {
      const row = await findByScannedLabel(platform, label);
      if (!row) {
        return NextResponse.json({
          ok: false,
          found: false,
          error: "Return not found. Sync Decathlon returns first.",
          dryRun: isReturnAutomationDryRun(),
        });
      }
      return NextResponse.json({
        ok: true,
        found: true,
        return: serializeReturn(row),
        dryRun: isReturnAutomationDryRun(),
      });
    }

    const where: any = { platform };
    if (status) {
      where.localStatus = status;
    } else {
      where.localStatus = { in: ["pending_receipt", "failed", "processing"] };
      if (platform === MARKETPLACE_RETURN_PLATFORM_DECATHLON) {
        where.NOT = {
          miraklStatus: { in: [...MIRAKL_TERMINAL_RETURN_STATUSES] },
        };
      }
    }

    const rows = await prisma.marketplaceReturn.findMany({
      where,
      orderBy: [{ updatedAt: "desc" }],
      take: 100,
    });

    const cursor = await prisma.marketplaceReturnSyncCursor.findUnique({ where: { platform } });

    return NextResponse.json({
      ok: true,
      returns: rows.map(serializeReturn),
      lastSuccessfulSyncAt: cursor?.lastSuccessfulSyncAt?.toISOString() ?? null,
      dryRun: isReturnAutomationDryRun(),
    });
  } catch (error: any) {
    console.error("[RETURNS][LIST] Failed", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "List failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "sync").trim();
    if (action === "sync") {
      const result = await syncMarketplaceReturns();
      return NextResponse.json({ ok: result.ok, result, dryRun: isReturnAutomationDryRun() });
    }
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[RETURNS][SYNC] Failed", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Sync failed" }, { status: 500 });
  }
}
