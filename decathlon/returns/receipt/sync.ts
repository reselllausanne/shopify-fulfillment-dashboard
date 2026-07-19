import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import {
  CONNECT_V2_ACTIVE_RETURN_STATUSES,
  MARKETPLACE_RETURN_PLATFORM_DECATHLON,
  RETURN_SYNC_OVERLAP_MS,
  RT11_ACTIVE_RETURN_STATES,
} from "./config";
import {
  extractReturnLines,
  extractReturnsList,
  findOrderLineInOrder,
  mapConnectStatusToLocalPending,
  normalizeMiraklReturnStatus,
  pickReturnLabelNumber,
  pickReturnLabelUrl,
  pickReturnReason,
  pickString,
  resolveReturnAmountFromOrderLine,
  toFiniteNumber,
  appendAuditLog,
} from "./mapReturn";
import {
  isMiraklTerminalReturnStatus,
  mapTerminalMiraklStatusToProcessStep,
  resolveRemoteReturnStatus,
} from "./remoteStatus";
import {
  extractReturnLabelNumberFromPdf,
  pickReturnLabelDocumentId,
} from "./extractLabelFromPdf";

type OrdersClient = ReturnType<typeof buildDecathlonOrdersClient>;

async function listAllReturns(
  listFn: (params?: Record<string, string | number | boolean>) => Promise<any>,
  baseParams: Record<string, string | number | boolean>,
  maxPages = 50
): Promise<any[]> {
  const collected: any[] = [];
  let pageToken: string | undefined;
  for (let page = 0; page < maxPages; page += 1) {
    const params: Record<string, string | number | boolean> = {
      ...baseParams,
      limit: Number(baseParams.limit ?? 100),
    };
    if (pageToken) params.page_token = pageToken;
    const payload = await listFn(params);
    const batch = extractReturnsList(payload);
    collected.push(...batch);
    const next = pickString(payload?.next_page_token, payload?.nextPageToken);
    if (!next || batch.length === 0) break;
    pageToken = next;
  }
  return collected;
}

async function resolveAmountAndMeta(options: {
  client: OrdersClient;
  ret: any;
  orderId: string;
  orderLineId: string | null;
  quantity: number;
  orderCache: Map<string, any>;
}): Promise<{
  amount: number | null;
  currency: string;
  productId: string | null;
  productTitle: string | null;
  sku: string | null;
}> {
  const { client, ret, orderId, orderLineId, quantity, orderCache } = options;
  let orderPayload = orderCache.get(orderId);
  if (!orderPayload) {
    try {
      orderPayload = await client.getOrder(orderId);
      // OR11 wraps as { orders: [...] } sometimes
      const orders = Array.isArray(orderPayload?.orders) ? orderPayload.orders : null;
      if (orders?.length) orderPayload = orders[0];
      orderCache.set(orderId, orderPayload);
    } catch (error: any) {
      console.warn("[RETURNS][SYNC] getOrder failed", { orderId, error: error?.message ?? error });
      orderPayload = null;
      orderCache.set(orderId, null);
    }
  }

  const miraklLine = findOrderLineInOrder(orderPayload, orderLineId);
  let amount = resolveReturnAmountFromOrderLine({ orderLine: miraklLine, returnedQuantity: quantity });
  let productTitle = pickString(miraklLine?.product_title, miraklLine?.productTitle, miraklLine?.description);
  let sku = pickString(
    miraklLine?.offer_sku,
    miraklLine?.offerSku,
    miraklLine?.product_sku,
    miraklLine?.productSku
  );
  let productId = pickString(
    extractReturnLines(ret)[0]?.product_id,
    extractReturnLines(ret)[0]?.productId,
    sku
  );
  let currency =
    pickString(
      orderPayload?.currency_iso_code,
      orderPayload?.currency_code,
      orderPayload?.currency,
      ret?.currency_code,
      ret?.currency,
      "CHF"
    ) ?? "CHF";

  if (amount == null && orderLineId) {
    const dbLine = await prisma.decathlonOrderLine.findUnique({ where: { orderLineId } });
    if (dbLine) {
      const dbAmount = resolveReturnAmountFromOrderLine({
        orderLine: {
          total_price: dbLine.lineTotal,
          unit_price: dbLine.unitPrice,
          quantity: dbLine.quantity,
        },
        returnedQuantity: quantity,
      });
      amount = dbAmount;
      productTitle = productTitle ?? dbLine.productTitle ?? dbLine.description ?? null;
      sku = sku ?? dbLine.offerSku ?? dbLine.productSku ?? null;
      productId = productId ?? sku;
      currency = dbLine.currencyCode ?? currency;
    }
  }

  return { amount, currency, productId, productTitle, sku };
}

async function resolveReturnLabelNumber(options: {
  client: OrdersClient;
  ret: any;
  existingLabel?: string | null;
}): Promise<string | null> {
  const fromPayload = pickReturnLabelNumber(options.ret);
  if (fromPayload) return fromPayload;
  if (options.existingLabel) return options.existingLabel;

  const docId = pickReturnLabelDocumentId(options.ret);
  if (docId == null) {
    // Connect v2 may expose label_url only — keep URL hostname out of scan field.
    void pickReturnLabelUrl(options.ret);
    return null;
  }

  try {
    const { buffer } = await options.client.downloadDocuments({ document_ids: docId });
    const extracted = await extractReturnLabelNumberFromPdf(buffer);
    if (extracted) return extracted;
    console.warn("[RETURNS][SYNC] label PDF downloaded but no barcode/text found", { docId });
  } catch (error: any) {
    console.warn("[RETURNS][SYNC] label document download failed", {
      docId,
      error: error?.message ?? error,
    });
  }
  return null;
}

function buildUpsertFields(options: {
  ret: any;
  apiSource: "v2" | "rt11";
  amount: number;
  currency: string;
  productId: string | null;
  productTitle: string | null;
  sku: string | null;
  returnLabelNumber: string | null;
  preserveLocalStatus: boolean;
  existingLocalStatus?: string | null;
}) {
  const { ret, apiSource, amount, currency, productId, productTitle, sku, returnLabelNumber } = options;
  const lines = extractReturnLines(ret);
  const firstLine = lines[0] ?? {};
  const orderId = pickString(ret?.order_id, ret?.orderId, ret?.order?.id, ret?.order?.order_id);
  const orderLineId = pickString(firstLine?.order_line_id, firstLine?.orderLineId);
  const quantityRaw = toFiniteNumber(firstLine?.quantity) ?? toFiniteNumber(firstLine?.qty) ?? 1;
  const quantity = Math.max(1, Math.floor(quantityRaw));
  const miraklStatus = normalizeMiraklReturnStatus(ret);
  const reason = pickReturnReason(ret, firstLine);
  const syncedAt = new Date();

  const base = {
    externalOrderId: orderId!,
    externalOrderLineId: orderLineId,
    productId,
    productTitle,
    sku,
    returnLabelNumber,
    returnAmount: amount,
    currency,
    returnReasonCode: reason.code,
    returnReasonLabel: reason.label,
    miraklStatus,
    syncedAt,
    quantity,
    apiSource,
    rawJson: ret ?? null,
  };

  if (options.preserveLocalStatus) {
    return base;
  }

  if (mapConnectStatusToLocalPending(miraklStatus)) {
    return { ...base, localStatus: "pending_receipt" as const };
  }
  return base;
}

async function reconcileClosedPendingReturns(options: {
  client: OrdersClient;
  platform: string;
}): Promise<number> {
  const pendingRows = await prisma.marketplaceReturn.findMany({
    where: {
      platform: options.platform,
      localStatus: { in: ["pending_receipt", "failed", "processing"] },
    },
    orderBy: { updatedAt: "desc" },
    take: 200,
  });

  let reconciled = 0;
  for (const row of pendingRows) {
    const remoteStatus = await resolveRemoteReturnStatus({
      client: options.client,
      externalReturnId: row.externalReturnId,
    });
    if (!remoteStatus || !isMiraklTerminalReturnStatus(remoteStatus)) continue;

    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: {
        miraklStatus: remoteStatus,
        localStatus: "completed",
        processStep: mapTerminalMiraklStatusToProcessStep(remoteStatus),
        completedAt: row.completedAt ?? new Date(),
        syncedAt: new Date(),
        failureMessage: null,
        auditLogJson: appendAuditLog(row.auditLogJson, {
          at: new Date().toISOString(),
          step: "sync_reconcile_terminal_remote",
          ok: true,
          response: { remoteStatus },
        }) as unknown as Prisma.InputJsonValue,
      },
    });
    reconciled += 1;
  }
  return reconciled;
}

export type SyncMarketplaceReturnsResult = {
  ok: boolean;
  platform: string;
  dryRunCursorOnly?: boolean;
  updatedFrom: string;
  fetchedV2: number;
  fetchedRt11: number;
  upserted: number;
  skippedNoAmount: number;
  skippedNoOrder: number;
  reconciledClosed?: number;
  labelsResolved?: number;
  errors: string[];
  lastSuccessfulSyncAt: string | null;
};

export async function syncMarketplaceReturns(options?: {
  client?: OrdersClient;
  platform?: string;
  overlapMs?: number;
}): Promise<SyncMarketplaceReturnsResult> {
  const platform = options?.platform ?? MARKETPLACE_RETURN_PLATFORM_DECATHLON;
  const client = options?.client ?? buildDecathlonOrdersClient();
  const overlapMs = options?.overlapMs ?? RETURN_SYNC_OVERLAP_MS;
  const errors: string[] = [];

  const cursor = await prisma.marketplaceReturnSyncCursor.findUnique({ where: { platform } });
  const now = new Date();
  const fallback = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const base = cursor?.lastSuccessfulSyncAt ?? fallback;
  const updatedFrom = new Date(base.getTime() - overlapMs).toISOString();

  const returnsById = new Map<string, { ret: any; apiSource: "v2" | "rt11" }>();

  try {
    const v2List = await listAllReturns(client.listReturns, {
      updated_from: updatedFrom,
      statuses: CONNECT_V2_ACTIVE_RETURN_STATUSES,
      limit: 100,
    });
    for (const ret of v2List) {
      const id = pickString(ret?.id, ret?.return_id, ret?.returnId);
      if (!id) continue;
      returnsById.set(id, { ret, apiSource: "v2" });
    }
  } catch (error: any) {
    errors.push(`v2: ${error?.message ?? error}`);
  }

  try {
    const rt11List = await listAllReturns(client.listReturnsRt11, {
      return_last_updated_from: updatedFrom,
      return_state: RT11_ACTIVE_RETURN_STATES,
      limit: 100,
    });
    for (const ret of rt11List) {
      const id = pickString(ret?.id, ret?.return_id, ret?.returnId);
      if (!id) continue;
      if (!returnsById.has(id)) returnsById.set(id, { ret, apiSource: "rt11" });
    }
  } catch (error: any) {
    errors.push(`rt11: ${error?.message ?? error}`);
  }

  // Decathlon seller front has no Connect v2 returns (404). RT11 success alone is enough.
  const rt11Failed = errors.some((e) => e.startsWith("rt11:"));
  if (returnsById.size === 0 && rt11Failed) {
    return {
      ok: false,
      platform,
      updatedFrom,
      fetchedV2: 0,
      fetchedRt11: 0,
      upserted: 0,
      skippedNoAmount: 0,
      skippedNoOrder: 0,
      errors,
      lastSuccessfulSyncAt: cursor?.lastSuccessfulSyncAt?.toISOString() ?? null,
    };
  }

  let upserted = 0;
  let skippedNoAmount = 0;
  let skippedNoOrder = 0;
  let labelsResolved = 0;
  const orderCache = new Map<string, any>();

  for (const { ret, apiSource } of returnsById.values()) {
    const externalReturnId = pickString(ret?.id, ret?.return_id, ret?.returnId);
    if (!externalReturnId) continue;
    const orderId = pickString(ret?.order_id, ret?.orderId, ret?.order?.id, ret?.order?.order_id);
    if (!orderId) {
      skippedNoOrder += 1;
      continue;
    }
    const lines = extractReturnLines(ret);
    const firstLine = lines[0] ?? {};
    const orderLineId = pickString(firstLine?.order_line_id, firstLine?.orderLineId);
    const quantityRaw = toFiniteNumber(firstLine?.quantity) ?? 1;
    const quantity = Math.max(1, Math.floor(quantityRaw));

    const meta = await resolveAmountAndMeta({
      client,
      ret,
      orderId,
      orderLineId,
      quantity,
      orderCache,
    });

    if (meta.amount == null || meta.amount <= 0) {
      skippedNoAmount += 1;
      console.warn("[RETURNS][SYNC] skip return — no verified amount", {
        externalReturnId,
        orderId,
        orderLineId,
      });
      continue;
    }

    const existing = await prisma.marketplaceReturn.findUnique({
      where: { platform_externalReturnId: { platform, externalReturnId } },
      select: { localStatus: true, returnLabelNumber: true },
    });

    const terminalLocal = new Set(["completed", "rejected", "processing", "failed", "received"]);
    const preserveLocalStatus = Boolean(existing && terminalLocal.has(String(existing.localStatus)));

    const returnLabelNumber = await resolveReturnLabelNumber({
      client,
      ret,
      existingLabel: existing?.returnLabelNumber ?? null,
    });
    if (returnLabelNumber) labelsResolved += 1;

    const fields = buildUpsertFields({
      ret,
      apiSource,
      amount: meta.amount,
      currency: meta.currency,
      productId: meta.productId,
      productTitle: meta.productTitle,
      sku: meta.sku,
      returnLabelNumber,
      preserveLocalStatus,
      existingLocalStatus: existing?.localStatus,
    });

    await prisma.marketplaceReturn.upsert({
      where: { platform_externalReturnId: { platform, externalReturnId } },
      create: {
        platform,
        externalReturnId,
        localStatus: "pending_receipt",
        processStep: "pending",
        ...fields,
      },
      update: fields,
    });
    upserted += 1;
  }

  let reconciledClosed = 0;
  try {
    reconciledClosed = await reconcileClosedPendingReturns({ client, platform });
  } catch (error: any) {
    errors.push(`reconcile: ${error?.message ?? error}`);
  }

  // Backfill label numbers for pending rows still missing them (PDF extract added later).
  const missingLabelRows =
    (await prisma.marketplaceReturn.findMany({
    where: {
      platform,
      localStatus: { in: ["pending_receipt", "failed", "received"] },
      OR: [{ returnLabelNumber: null }, { returnLabelNumber: "" }],
    },
    take: 100,
    orderBy: { updatedAt: "desc" },
    })) ?? [];
  for (const row of missingLabelRows) {
    const raw = row.rawJson as any;
    if (!raw) continue;
    const label = await resolveReturnLabelNumber({
      client,
      ret: raw,
      existingLabel: null,
    });
    if (!label) continue;
    await prisma.marketplaceReturn.update({
      where: { id: row.id },
      data: { returnLabelNumber: label },
    });
    labelsResolved += 1;
  }

  const listOk = !rt11Failed;
  let lastSuccessfulSyncAt: string | null = cursor?.lastSuccessfulSyncAt?.toISOString() ?? null;
  if (listOk) {
    await prisma.marketplaceReturnSyncCursor.upsert({
      where: { platform },
      create: { platform, lastSuccessfulSyncAt: now },
      update: { lastSuccessfulSyncAt: now },
    });
    lastSuccessfulSyncAt = now.toISOString();
  }

  return {
    ok: listOk,
    platform,
    updatedFrom,
    fetchedV2: [...returnsById.values()].filter((r) => r.apiSource === "v2").length,
    fetchedRt11: [...returnsById.values()].filter((r) => r.apiSource === "rt11").length,
    upserted,
    skippedNoAmount,
    skippedNoOrder,
    reconciledClosed,
    labelsResolved,
    errors,
    lastSuccessfulSyncAt,
  };
}
