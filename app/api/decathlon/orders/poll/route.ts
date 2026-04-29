import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";
import { repairDecathlonStockxMatchLineRefs } from "@/decathlon/orders/stockxMatchRepair";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { extractGtinFromOfferSku, roundToCents } from "@/decathlon/returns/theRestockFromReturnLine";
import { applyInventoryOrderLine } from "@/inventory/applyOrderLines";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const OPEN_STATES = new Set(["OPEN"]);
const CANCELLED_STATES = new Set(["CANCELED", "CANCELLED", "ORDER_CANCELLED", "CLOSED"]);

function normalizeOrderState(order: any): string {
  const raw = String(order?.order_state ?? order?.state ?? order?.status ?? "").trim();
  return raw.toUpperCase();
}

function extractOrders(payload: any): any[] {
  return payload?.orders ?? payload?.order_list ?? payload?.orderList ?? payload?.data ?? [];
}

function extractTotal(payload: any): number | null {
  const raw =
    payload?.total_count ??
    payload?.totalCount ??
    payload?.total ??
    payload?.order_count ??
    payload?.orderCount ??
    null;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function extractReturns(payload: any): any[] {
  return payload?.returns ?? payload?.return_list ?? payload?.returnList ?? payload?.data ?? [];
}

function extractReturnLines(ret: any): any[] {
  return ret?.return_lines ?? ret?.returnLines ?? ret?.lines ?? [];
}

function normalizeReturnStatus(ret: any): string {
  const raw = String(
    ret?.status ??
      ret?.return_status ??
      ret?.returnStatus ??
      ret?.state ??
      ret?.return_state ??
      ""
  ).trim();
  return raw.toUpperCase();
}

function resolveUpdatedFrom(latestReturnAt: Date | null, fallbackAt: Date | null): string {
  const now = Date.now();
  const fallbackWindow = new Date(now - 30 * 24 * 60 * 60 * 1000);
  const base = latestReturnAt ?? (fallbackAt && fallbackAt < fallbackWindow ? fallbackAt : fallbackWindow);
  const safe = new Date(base.getTime() - 5 * 60 * 1000);
  return safe.toISOString();
}

function pickString(...values: unknown[]): string | null {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return null;
}

function buildFullName(first: unknown, last: unknown): string | null {
  const parts = [first, last].map((value) => String(value ?? "").trim()).filter(Boolean);
  return parts.length ? parts.join(" ") : null;
}

function normalizeAddressLines(
  source: any,
  names?: { firstName?: string | null; lastName?: string | null; fullName?: string | null }
) {
  const ignore = new Set(
    [names?.firstName, names?.lastName, names?.fullName]
      .map((value) => String(value ?? "").trim().toLowerCase())
      .filter(Boolean)
  );
  const normalize = (value: unknown) => {
    const text = String(value ?? "").trim();
    if (!text) return null;
    if (ignore.has(text.toLowerCase())) return null;
    return text;
  };
  const pickFirst = (values: unknown[]) => {
    for (const value of values) {
      const candidate = normalize(value);
      if (candidate) return candidate;
    }
    return null;
  };
  const line1 = pickFirst([
    source?.street_1,
    source?.street1,
    source?.address1,
    source?.address_1,
    source?.street,
  ]);
  const line2 = pickFirst([source?.street_2, source?.street2, source?.address2, source?.address_2]);
  if (line1 && line2) {
    const lower1 = line1.toLowerCase();
    const lower2 = line2.toLowerCase();
    if (lower1.includes(lower2)) return { address1: line1, address2: null };
    if (lower2.includes(lower1)) return { address1: line2, address2: null };
    if (line1.length <= 4 && line2.length >= 6) {
      return { address1: `${line1} ${line2}`.trim(), address2: null };
    }
  }
  return { address1: line1 ?? null, address2: line2 ?? null };
}

function resolveCustomerSource(order: any): any | null {
  return (
    order?.customer ??
    order?.customer_address ??
    order?.customerAddress ??
    order?.billing_address ??
    order?.billingAddress ??
    order?.billing ??
    order?.customer?.billing_address ??
    order?.customer?.billingAddress ??
    null
  );
}

function resolveShippingSource(order: any): any | null {
  return (
    order?.shipping ??
    order?.shipping_address ??
    order?.shippingAddress ??
    order?.delivery_address ??
    order?.deliveryAddress ??
    order?.delivery ??
    order?.customer?.shipping_address ??
    order?.customer?.shippingAddress ??
    order?.customer?.delivery_address ??
    order?.customer?.deliveryAddress ??
    null
  );
}

function normalizeAddress(source: any): {
  name: string | null;
  email: string | null;
  phone: string | null;
  address1: string | null;
  address2: string | null;
  postalCode: string | null;
  city: string | null;
  country: string | null;
  countryCode: string | null;
} | null {
  if (!source || typeof source !== "object") return null;
  const firstName = pickString(source.firstname, source.first_name, source.firstName);
  const lastName = pickString(source.lastname, source.last_name, source.lastName);
  const fullName = buildFullName(firstName, lastName);
  const name = pickString(fullName, source.name, source.name1, source.full_name, source.company, source.company_2);
  const { address1, address2 } = normalizeAddressLines(source, { firstName, lastName, fullName });
  return {
    name,
    email: pickString(source.email),
    phone: pickString(source.phone, source.phone_number, source.mobile, source.mobile_phone),
    address1,
    address2,
    postalCode: pickString(source.zip_code, source.zipCode, source.zip, source.postal_code, source.postcode),
    city: pickString(source.city, source.town),
    country: pickString(source.country, source.country_code, source.countryCode, source.country_iso_code),
    countryCode: pickString(source.country_code, source.countryCode, source.country_iso_code, source.country),
  };
}

async function listOrdersSafe(
  client: ReturnType<typeof buildDecathlonOrdersClient>,
  params: Record<string, string | number>
) {
  try {
    return await client.listOrders(params);
  } catch (error) {
    console.error("[DECATHLON][ORDERS][POLL] listOrders failed", { params, error });
    return null;
  }
}

async function listOrdersPaged(
  client: ReturnType<typeof buildDecathlonOrdersClient>,
  params: Record<string, string | number>,
  options?: { maxPages?: number; maxTotal?: number; safe?: boolean }
) {
  const perPageRaw = Number(params.max ?? 50);
  const perPage = Number.isFinite(perPageRaw) ? Math.min(Math.max(perPageRaw, 1), 200) : 50;
  const maxPages = Math.min(Math.max(Number(options?.maxPages ?? 1000), 1), 2000);
  const maxTotal = Math.min(Math.max(Number(options?.maxTotal ?? 200000), 1), 200000);
  const useSafe = options?.safe ?? false;
  const orders: any[] = [];
  let offset = Number(params.offset ?? 0);
  for (let page = 0; page < maxPages; page += 1) {
    const pageParams = { ...params, max: perPage, offset };
    const payload = useSafe ? await listOrdersSafe(client, pageParams) : await client.listOrders(pageParams);
    const batch = extractOrders(payload);
    if (!Array.isArray(batch) || batch.length === 0) break;
    orders.push(...batch);
    const total = extractTotal(payload);
    if (total !== null && orders.length >= total) break;
    if (batch.length < perPage) break;
    if (orders.length >= maxTotal) break;
    offset += perPage;
  }
  return orders.slice(0, maxTotal);
}

async function listReturnsPaged(
  listFn: (params?: Record<string, string | number | boolean>) => Promise<any>,
  params: Record<string, string | number>,
  options?: { maxPages?: number; maxTotal?: number }
) {
  const perPageRaw = Number(params.limit ?? params.max ?? 50);
  const perPage = Number.isFinite(perPageRaw) ? Math.min(Math.max(perPageRaw, 1), 200) : 50;
  const maxPages = Math.min(Math.max(Number(options?.maxPages ?? 1000), 1), 2000);
  const maxTotal = Math.min(Math.max(Number(options?.maxTotal ?? 200000), 1), 200000);
  const returns: any[] = [];
  let pageToken = String(params.page_token ?? "");
  const seenTokens = new Set<string>();
  for (let page = 0; page < maxPages; page += 1) {
    const pageParams: Record<string, string | number> = {
      ...params,
      limit: perPage,
    };
    if (pageToken) pageParams.page_token = pageToken;
    const payload = await listFn(pageParams);
    const batch = extractReturns(payload);
    if (!Array.isArray(batch) || batch.length === 0) break;
    returns.push(...batch);
    const total = extractTotal(payload);
    if (total !== null && returns.length >= total) break;
    if (batch.length < perPage) break;
    if (returns.length >= maxTotal) break;
    const next =
      (payload as any)?.next_page_token ??
      (payload as any)?.nextPageToken ??
      (payload as any)?.next_page_token ??
      null;
    if (!next) break;
    const nextToken = String(next);
    if (!nextToken || seenTokens.has(nextToken) || nextToken === pageToken) break;
    seenTokens.add(nextToken);
    pageToken = nextToken;
  }
  return returns.slice(0, maxTotal);
}

function pickLineAmount(line: any): number | null {
  const raw =
    line?.line_price ??
    line?.linePrice ??
    line?.price ??
    line?.unit_price ??
    line?.unitPrice ??
    null;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function pickOrderAmount(order: any): number | null {
  const raw =
    order?.total_price ??
    order?.totalPrice ??
    order?.total ??
    order?.amount ??
    order?.price ??
    null;
  if (raw === null || raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolvePartnerKeyFromLine(line: any): string | null {
  const candidates = pickMiraklLineSkuCandidates(line);
  for (const candidate of candidates) {
    const key = normalizeProviderKey(candidate);
    if (key) return key;
    const raw = String(candidate ?? "").trim().toUpperCase();
    const prefix = raw.slice(0, 3);
    if (/^[A-Z]{3}$/.test(prefix)) return prefix;
  }
  return null;
}

function resolveOrderPartnerKey(lines: any[], knownPartnerKeys: Set<string>): string | null {
  const keys = new Set<string>();
  for (const line of lines) {
    const key = resolvePartnerKeyFromLine(line);
    if (key) keys.add(key);
  }
  if (keys.size !== 1) return null;
  const only = Array.from(keys)[0];
  return knownPartnerKeys.has(only) ? only : null;
}

function normalizeOfferSku(value: unknown): string | null {
  const text = pickString(value);
  if (!text) return null;
  return text.toUpperCase();
}

async function upsertDecathlonOrder(payload: {
  order: any;
  orderId: string;
  partnerKey: string | null;
  preserveCanceled?: boolean;
}) {
  const { order, orderId, partnerKey: resolvedPartnerKey, preserveCanceled } = payload;
  const orderDate = order?.created_date ?? order?.date_created ?? order?.order_date ?? null;
  const parsedOrderDate = orderDate ? new Date(orderDate) : new Date();
  const incomingState = normalizeOrderState(order);
  const customer = normalizeAddress(resolveCustomerSource(order));
  const shipping = normalizeAddress(resolveShippingSource(order));
  const existing = await prisma.decathlonOrder.findUnique({
    where: { orderId },
    select: {
      id: true,
      orderState: true,
      partnerKey: true,
      recipientAddressLocked: true,
      recipientName: true,
      recipientEmail: true,
      recipientPhone: true,
      recipientAddress1: true,
      recipientAddress2: true,
      recipientPostalCode: true,
      recipientCity: true,
      recipientCountry: true,
      recipientCountryCode: true,
    },
  });
  const resolvedPk =
    resolvedPartnerKey != null && String(resolvedPartnerKey).trim() !== ""
      ? String(resolvedPartnerKey).trim()
      : null;
  const existingPk =
    existing?.partnerKey != null && String(existing.partnerKey).trim() !== ""
      ? String(existing.partnerKey).trim()
      : null;
  /** Prefer Mirakl-derived partner when present; otherwise keep admin-assigned partnerKey. */
  const partnerKeyForUpsert = resolvedPk ?? existingPk ?? null;

  let orderState = incomingState || null;
  if (preserveCanceled && existing?.orderState) {
    const existingState = String(existing.orderState ?? "").trim().toUpperCase();
    if (
      existingState &&
      CANCELLED_STATES.has(existingState) &&
      (incomingState === "" || OPEN_STATES.has(incomingState))
    ) {
      orderState = existingState;
    }
  }
  const recipientLocked = Boolean(existing?.recipientAddressLocked);
  const recipientValues = recipientLocked
    ? {
        recipientName: existing?.recipientName ?? null,
        recipientEmail: existing?.recipientEmail ?? null,
        recipientPhone: existing?.recipientPhone ?? null,
        recipientAddress1: existing?.recipientAddress1 ?? null,
        recipientAddress2: existing?.recipientAddress2 ?? null,
        recipientPostalCode: existing?.recipientPostalCode ?? null,
        recipientCity: existing?.recipientCity ?? null,
        recipientCountry: existing?.recipientCountry ?? null,
        recipientCountryCode: existing?.recipientCountryCode ?? null,
      }
    : {
        recipientName: shipping?.name ?? null,
        recipientEmail: shipping?.email ?? null,
        recipientPhone: shipping?.phone ?? null,
        recipientAddress1: shipping?.address1 ?? null,
        recipientAddress2: shipping?.address2 ?? null,
        recipientPostalCode: shipping?.postalCode ?? null,
        recipientCity: shipping?.city ?? null,
        recipientCountry: shipping?.country ?? shipping?.countryCode ?? null,
        recipientCountryCode: shipping?.countryCode ?? shipping?.country ?? null,
      };

  const orderRow = await prisma.decathlonOrder.upsert({
    where: { orderId },
    update: {
      orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
      orderDate: parsedOrderDate,
      orderState,
      partnerKey: partnerKeyForUpsert,
      currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
      totalPrice: pickOrderAmount(order),
      shippingPrice: order?.shipping_price ?? order?.shippingPrice ?? null,
      customerName: customer?.name ?? null,
      customerEmail: customer?.email ?? null,
      customerPhone: customer?.phone ?? null,
      customerAddress1: customer?.address1 ?? null,
      customerAddress2: customer?.address2 ?? null,
      customerPostalCode: customer?.postalCode ?? null,
      customerCity: customer?.city ?? null,
      customerCountry: customer?.country ?? customer?.countryCode ?? null,
      customerCountryCode: customer?.countryCode ?? customer?.country ?? null,
      ...recipientValues,
      recipientAddressLocked: existing?.recipientAddressLocked ?? false,
      rawJson: order ?? null,
    },
    create: {
      orderId,
      orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
      orderDate: parsedOrderDate,
      orderState,
      partnerKey: partnerKeyForUpsert,
      currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
      totalPrice: pickOrderAmount(order),
      shippingPrice: order?.shipping_price ?? order?.shippingPrice ?? null,
      customerName: customer?.name ?? null,
      customerEmail: customer?.email ?? null,
      customerPhone: customer?.phone ?? null,
      customerAddress1: customer?.address1 ?? null,
      customerAddress2: customer?.address2 ?? null,
      customerPostalCode: customer?.postalCode ?? null,
      customerCity: customer?.city ?? null,
      customerCountry: customer?.country ?? customer?.countryCode ?? null,
      customerCountryCode: customer?.countryCode ?? customer?.country ?? null,
      ...recipientValues,
      recipientAddressLocked: existing?.recipientAddressLocked ?? false,
      rawJson: order ?? null,
    },
  });
  return { orderRow, existingId: existing?.id ?? null };
}

async function syncDecathlonReturns(options: {
  client: ReturnType<typeof buildDecathlonOrdersClient>;
  limit: number;
  maxPages: number;
  fallbackUpdatedFrom: Date | null;
}) {
  const prismaAny = prisma as any;
  try {
    const [latestReturn] = await prismaAny.decathlonReturn.findMany({
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { updatedAt: true },
    });
    const updatedFrom = resolveUpdatedFrom(latestReturn?.updatedAt ?? null, options.fallbackUpdatedFrom);
    const returnsById = new Map<string, any>();
    const listErrors: string[] = [];
    const addReturns = (items: any[]) => {
      for (const ret of items) {
        const rid = pickString(ret?.id, ret?.return_id, ret?.returnId);
        if (!rid || returnsById.has(rid)) continue;
        returnsById.set(rid, ret);
      }
    };
    const fetchReturns = async (
      source: string,
      listFn: (params?: Record<string, string | number | boolean>) => Promise<any>,
      params: Record<string, string | number>
    ) => {
      try {
        const list = await listReturnsPaged(listFn, params, { maxPages: Math.min(options.maxPages, 200) });
        addReturns(list);
      } catch (error: any) {
        listErrors.push(`${source}: ${error?.message ?? error}`);
      }
    };
    await fetchReturns(
      "v2",
      options.client.listReturns,
      {
        limit: options.limit,
        statuses: "RECEIVED,CLOSED",
        updated_from: updatedFrom,
      }
    );
    await fetchReturns(
      "rt11",
      options.client.listReturnsRt11,
      {
        limit: options.limit,
        return_state: "RECEIVED,CLOSED",
        return_last_updated_from: updatedFrom,
      }
    );
    if (listErrors.length) {
      console.warn("[DECATHLON][RETURNS][SYNC] list returns warnings:", listErrors);
    }
    const returns = Array.from(returnsById.values());
    let upserted = 0;
    let lineUpserted = 0;
    for (const ret of returns) {
      const returnId = pickString(ret?.id, ret?.return_id, ret?.returnId);
      if (!returnId) continue;
      const orderId = pickString(ret?.order_id, ret?.orderId, ret?.order?.id, ret?.order?.order_id);
      const status = normalizeReturnStatus(ret);
      const returnRow = await prismaAny.decathlonReturn.upsert({
        where: { returnId },
        update: {
          orderId,
          status,
          rawJson: ret ?? null,
        },
        create: {
          returnId,
          orderId,
          status,
          rawJson: ret ?? null,
        },
      });
      upserted += 1;

      const lines = extractReturnLines(ret);
      for (const line of lines) {
        const orderLineId = pickString(line?.order_line_id, line?.orderLineId, line?.order_line?.id);
        const productIdRaw = pickString(line?.product_id, line?.productId, line?.offer_sku, line?.offerSku);
        const offerSku =
          normalizeOfferSku(productIdRaw) ??
          normalizeOfferSku(line?.offer_sku) ??
          normalizeOfferSku(line?.offerSku) ??
          null;
        const productId = productIdRaw ?? offerSku ?? orderLineId ?? returnId;
        const quantityRaw = Number(line?.quantity ?? line?.qty ?? 0);
        const quantity = Number.isFinite(quantityRaw) ? Math.max(quantityRaw, 0) : 0;
        if (quantity <= 0) continue;

        const orderLine =
          orderLineId != null
            ? await prisma.decathlonOrderLine.findUnique({
                where: { orderLineId },
              })
            : null;
        const gtin =
          orderLine?.gtin ??
          extractGtinFromOfferSku(offerSku) ??
          extractGtinFromOfferSku(orderLine?.offerSku ?? null) ??
          null;
        const providerKey =
          offerSku ??
          normalizeOfferSku(orderLine?.offerSku) ??
          normalizeOfferSku(orderLine?.providerKey) ??
          null;

        let supplierVariant: any | null = null;
        if (providerKey && gtin) {
          supplierVariant = await prismaAny.supplierVariant.findFirst({
            where: { providerKey, gtin },
          });
        } else if (providerKey) {
          supplierVariant = await prismaAny.supplierVariant.findFirst({
            where: { providerKey },
          });
        }
        const basePriceRaw =
          supplierVariant?.price ??
          orderLine?.unitPrice ??
          line?.unit_price ??
          line?.unitPrice ??
          line?.price ??
          null;
        const basePriceParsed = basePriceRaw !== null ? Number(basePriceRaw) : NaN;
        const basePrice = Number.isFinite(basePriceParsed) && basePriceParsed > 0 ? basePriceParsed : null;
        const returnPrice = basePrice != null ? roundToCents(basePrice * 0.9) : null;
        const unitPrice = basePrice != null ? roundToCents(basePrice) : null;

        const lineRow = await prismaAny.decathlonReturnLine.upsert({
          where: {
            returnId_orderLineId_productId: {
              returnId,
              orderLineId: orderLineId ?? null,
              productId,
            },
          },
          update: {
            orderLineId: orderLineId ?? null,
            offerSku: offerSku ?? productIdRaw ?? null,
            productId,
            quantity,
            unitPrice,
            returnPrice,
            currencyCode: pickString(ret?.currency_code, ret?.currency, "CHF"),
          },
          create: {
            returnId: returnRow.returnId,
            orderLineId: orderLineId ?? null,
            offerSku: offerSku ?? productIdRaw ?? null,
            productId,
            quantity,
            unitPrice,
            returnPrice,
            currencyCode: pickString(ret?.currency_code, ret?.currency, "CHF"),
          },
        });
        lineUpserted += 1;
      }
    }

    return { fetched: returns.length, upserted, lines: lineUpserted, restocked: 0 };
  } catch (error: any) {
    console.error("[DECATHLON][RETURNS][SYNC] Failed:", error);
    return { fetched: 0, upserted: 0, lines: 0, restocked: 0, error: error?.message ?? "Return sync failed" };
  }
}

export async function POST(request: Request) {
  try {
    const prismaAny = prisma as any;
    const { searchParams } = new URL(request.url);
    const state = String(searchParams.get("state") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const pageParam = searchParams.get("pages") ?? searchParams.get("maxPages") ?? "1000";
    const maxPages = Math.min(Math.max(Number(pageParam), 1), 2000);
    const client = buildDecathlonOrdersClient();
    const params: Record<string, string | number> = { max: limit };
    if (state) params.order_state_codes = state;
    const [latestOrder] = await prisma.decathlonOrder.findMany({
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { updatedAt: true },
    });
    const lastSyncAt = latestOrder?.updatedAt ?? null;
    const orders: any[] = await listOrdersPaged(client, params, { maxPages });
    let canceledOrders: any[] = [];
    if (!state || state.toUpperCase() !== "CANCELED") {
      const baseParams: Record<string, string | number> = { max: limit };
      if (lastSyncAt) baseParams.start_update_date = lastSyncAt.toISOString();
      const [refundedOrders, canceledOnlyOrders, closedOrders] = await Promise.all([
        listOrdersPaged(
          client,
          {
            ...baseParams,
            order_state_codes: "CANCELED",
            refund_state_codes: "REFUNDED",
          },
          { maxPages, safe: true }
        ),
        listOrdersPaged(
          client,
          { ...baseParams, order_state_codes: "CANCELED" },
          { maxPages, safe: true }
        ),
        listOrdersPaged(
          client,
          { ...baseParams, order_state_codes: "CLOSED" },
          { maxPages, safe: true }
        ),
      ]);
      const merged = [...refundedOrders, ...canceledOnlyOrders, ...closedOrders];
      const unique = new Map<string, any>();
      for (const order of merged) {
        const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
        if (!orderId) continue;
        if (!unique.has(orderId)) unique.set(orderId, order);
      }
      canceledOrders = Array.from(unique.values());
    }
    const partnerRows = (await prismaAny.partner.findMany({
      select: { key: true },
    })) as Array<{ key: string | null }>;
    const partnerKeys = new Set(
      partnerRows
        .map((row) => normalizeProviderKey(row.key))
        .filter((key): key is string => Boolean(key))
    );
    let upserted = 0;
    const inventorySummary = {
      applied: 0,
      alreadyProcessed: 0,
      unresolved: 0,
      invalid: 0,
    };
    for (const order of orders) {
      const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
      if (!orderId) continue;
      const orderOccurredAt =
        order?.created_date || order?.date_created || order?.order_date
          ? new Date(order?.created_date ?? order?.date_created ?? order?.order_date)
          : undefined;
      const lines = Array.isArray(order?.order_lines) ? order.order_lines : order?.lines ?? [];
      const partnerKey = resolveOrderPartnerKey(lines, partnerKeys);
      const { orderRow } = await upsertDecathlonOrder({
        order,
        orderId,
        partnerKey,
        preserveCanceled: true,
      });
      if (Array.isArray(lines) && lines.length > 0) {
        for (const line of lines) {
          const lineId = String(line?.id ?? line?.order_line_id ?? line?.orderLineId ?? "").trim();
          if (!lineId) continue;
          const quantity = Number(line?.quantity ?? line?.qty ?? 1);
          const resolvedGtin = pickMiraklLineGtin(line) ?? line?.gtin ?? line?.ean ?? null;
          const resolvedLinePartnerKey = resolvePartnerKeyFromLine(line);
          const linePartnerKey =
            resolvedLinePartnerKey && partnerKeys.has(resolvedLinePartnerKey)
              ? resolvedLinePartnerKey
              : null;
          const updateData = {
            orderId: orderRow.id,
            lineNumber: line?.line_number ?? line?.lineNumber ?? null,
            offerSku: line?.offer_sku ?? line?.offerSku ?? null,
            productSku: line?.product_sku ?? line?.productSku ?? null,
            productTitle: line?.product_title ?? line?.productTitle ?? null,
            description: line?.description ?? null,
            size: line?.size ?? null,
            gtin: resolvedGtin,
            providerKey: line?.provider_key ?? line?.providerKey ?? null,
            supplierSku: line?.supplier_sku ?? line?.supplierSku ?? null,
            quantity: Number.isFinite(quantity) ? quantity : 1,
            unitPrice: pickLineAmount(line),
            lineTotal: line?.line_total ?? line?.lineTotal ?? null,
            currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
            rawJson: line ?? null,
            ...(linePartnerKey ? { partnerKey: linePartnerKey } : {}),
          } as any;
          await prismaAny.decathlonOrderLine.upsert({
            where: { orderLineId: lineId },
            update: updateData,
            create: {
              orderId: orderRow.id,
              orderLineId: lineId,
              lineNumber: line?.line_number ?? line?.lineNumber ?? null,
              offerSku: line?.offer_sku ?? line?.offerSku ?? null,
              productSku: line?.product_sku ?? line?.productSku ?? null,
              productTitle: line?.product_title ?? line?.productTitle ?? null,
              description: line?.description ?? null,
              size: line?.size ?? null,
              gtin: resolvedGtin,
              providerKey: line?.provider_key ?? line?.providerKey ?? null,
              supplierSku: line?.supplier_sku ?? line?.supplierSku ?? null,
              partnerKey: linePartnerKey,
              quantity: Number.isFinite(quantity) ? quantity : 1,
              unitPrice: pickLineAmount(line),
              lineTotal: line?.line_total ?? line?.lineTotal ?? null,
              currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
              rawJson: line ?? null,
            },
          });
          const inventoryResult = await applyInventoryOrderLine({
            channel: "DECATHLON",
            externalOrderId: orderId,
            externalLineId: lineId,
            quantity: Number(updateData.quantity ?? 1),
            providerKey:
              updateData.providerKey ??
              updateData.offerSku ??
              updateData.productSku ??
              updateData.supplierSku ??
              null,
            gtin: resolvedGtin,
            occurredAt:
              orderOccurredAt && !Number.isNaN(orderOccurredAt.getTime())
                ? orderOccurredAt
                : undefined,
            payloadJson: {
              source: "decathlon-orders-poll",
              orderState: normalizeOrderState(order),
            },
          });
          if (inventoryResult.applied) {
            inventorySummary.applied += 1;
          } else if (inventoryResult.reason === "already_processed") {
            inventorySummary.alreadyProcessed += 1;
          } else if (inventoryResult.reason === "unresolved_variant") {
            inventorySummary.unresolved += 1;
          } else {
            inventorySummary.invalid += 1;
          }
        }
      }
      await repairDecathlonStockxMatchLineRefs(orderRow.id);
      upserted += 1;
    }
    if (canceledOrders.length > 0) {
      for (const order of canceledOrders) {
        const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
        if (!orderId) continue;
        const lines = Array.isArray(order?.order_lines) ? order.order_lines : order?.lines ?? [];
        const partnerKey = resolveOrderPartnerKey(lines, partnerKeys);
        await upsertDecathlonOrder({
          order,
          orderId,
          partnerKey,
          preserveCanceled: false,
        });
      }
      upserted += canceledOrders.length;
    }
    const returnsSummary = await syncDecathlonReturns({
      client,
      limit,
      maxPages,
      fallbackUpdatedFrom: lastSyncAt,
    });
    return NextResponse.json({
      ok: true,
      fetched: orders.length,
      upserted,
      returns: returnsSummary,
      inventory: inventorySummary,
    });
  } catch (error: any) {
    console.error("[DECATHLON][ORDERS][POLL] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Poll failed" },
      { status: 500 }
    );
  }
}
