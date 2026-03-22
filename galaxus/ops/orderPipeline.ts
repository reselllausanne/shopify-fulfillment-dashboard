import { prisma } from "@/app/lib/prisma";
import { pollIncomingEdi, sendOutgoingEdi } from "@/galaxus/edi/service";
import { refreshStxProductsByKickdbProductIds } from "@/galaxus/jobs/stxSync";

type OrderPipelineResult = {
  filesProcessed: number;
  ordersIngested: number;
  ordrSent: number;
  ordrFailed: number;
  stxProductsRefreshed: number;
  errors: string[];
};

async function sendOrdrForOrder(orderId: string) {
  const now = new Date();
  const order = await (prisma as any).galaxusOrder.findUnique({
    where: { id: orderId },
    select: { id: true, galaxusOrderId: true, ordrSentAt: true, ordrStatus: true },
  });
  if (!order) return { ok: false, skipped: "not_found" };
  if (order.ordrSentAt || order.ordrStatus === "SENT") {
    return { ok: true, skipped: "already_sent" };
  }
  await (prisma as any).galaxusOrder.update({
    where: { id: orderId },
    data: { ordrStatus: "PENDING", ordrLastAttemptAt: now },
  });
  try {
    await sendOutgoingEdi({ orderId, types: ["ORDR"] });
    await (prisma as any).galaxusOrder.update({
      where: { id: orderId },
      data: { ordrStatus: "SENT", ordrLastError: null, ordrLastAttemptAt: now },
    });
    return { ok: true };
  } catch (error: any) {
    await (prisma as any).galaxusOrder.update({
      where: { id: orderId },
      data: { ordrStatus: "FAILED", ordrLastError: error?.message ?? "ORDR failed", ordrLastAttemptAt: now },
    });
    return { ok: false, error: error?.message ?? "ORDR failed" };
  }
}

async function resolveStxKickdbProductIds(orderIds: string[]): Promise<string[]> {
  if (orderIds.length === 0) return [];
  const lines = await (prisma as any).galaxusOrderLine.findMany({
    where: { orderId: { in: orderIds } },
    select: { providerKey: true, supplierVariantId: true },
  });
  const stxLines = (lines ?? []).filter((line: any) => {
    const providerKey = String(line?.providerKey ?? "");
    const supplierVariantId = String(line?.supplierVariantId ?? "");
    return providerKey.startsWith("STX_") || supplierVariantId.startsWith("stx_");
  });
  if (stxLines.length === 0) return [];

  const providerKeys = Array.from(
    new Set(
      stxLines.map((line: any) => String(line?.providerKey ?? "").trim()).filter(Boolean)
    )
  );
  const supplierVariantIds = Array.from(
    new Set(
      stxLines.map((line: any) => String(line?.supplierVariantId ?? "").trim()).filter(Boolean)
    )
  );

  const mappings = await (prisma as any).variantMapping.findMany({
    where: {
      OR: [
        providerKeys.length > 0 ? { providerKey: { in: providerKeys } } : undefined,
        supplierVariantIds.length > 0 ? { supplierVariantId: { in: supplierVariantIds } } : undefined,
      ].filter(Boolean),
    },
    select: { kickdbVariantId: true },
  });
  const kickdbVariantIds = Array.from(
    new Set((mappings ?? []).map((m: any) => m.kickdbVariantId).filter(Boolean))
  );
  if (kickdbVariantIds.length === 0) return [];

  const kickdbVariants = await (prisma as any).kickDBVariant.findMany({
    where: { id: { in: kickdbVariantIds } },
    select: { productId: true },
  });
  const kickdbProductIds = Array.from(
    new Set((kickdbVariants ?? []).map((v: any) => v.productId).filter(Boolean))
  );
  if (kickdbProductIds.length === 0) return [];

  const products = await (prisma as any).kickDBProduct.findMany({
    where: { id: { in: kickdbProductIds } },
    select: { kickdbProductId: true },
  });
  const externalIds = (products ?? [])
    .map((p: any) => String(p.kickdbProductId ?? "").trim())
    .filter((id: string): id is string => id.length > 0);
  return Array.from(new Set(externalIds));
}

export async function runEdiInPipeline(): Promise<OrderPipelineResult> {
  const errors: string[] = [];
  const pollResults = await pollIncomingEdi();
  const orderIds = Array.from(
    new Set(
      pollResults
        .map((r: any) => String(r?.orderId ?? "").trim())
        .filter((value) => value.length > 0)
    )
  );
  let ordrSent = 0;
  let ordrFailed = 0;
  for (const orderId of orderIds) {
    const res = await sendOrdrForOrder(orderId);
    if (res?.ok && !res?.skipped) {
      ordrSent += 1;
    } else if (!res?.ok) {
      ordrFailed += 1;
      if (res?.error) errors.push(res.error);
    }
  }

  let stxProductsRefreshed = 0;
  try {
    const kickdbProductIds = await resolveStxKickdbProductIds(orderIds);
    if (kickdbProductIds.length > 0) {
      const refresh = await refreshStxProductsByKickdbProductIds(kickdbProductIds, { concurrency: 2 });
      stxProductsRefreshed = refresh.processedProducts ?? 0;
    }
  } catch (error: any) {
    errors.push(error?.message ?? "STX refresh failed");
  }

  return {
    filesProcessed: pollResults.length,
    ordersIngested: orderIds.length,
    ordrSent,
    ordrFailed,
    stxProductsRefreshed,
    errors,
  };
}
