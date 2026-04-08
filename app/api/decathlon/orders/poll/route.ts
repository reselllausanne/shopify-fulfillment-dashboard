import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import { pickMiraklLineGtin, pickMiraklLineSkuCandidates } from "@/decathlon/mirakl/orderLineFields";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

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
  const name = pickString(
    source.name,
    source.name1,
    source.full_name,
    fullName,
    source.company,
    source.company_2
  );
  return {
    name,
    email: pickString(source.email),
    phone: pickString(source.phone, source.phone_number, source.mobile, source.mobile_phone),
    address1: pickString(
      source.address1,
      source.street1,
      source.street_1,
      source.address_1,
      source.street
    ),
    address2: pickString(source.address2, source.street2, source.street_2, source.address_2),
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

async function upsertDecathlonOrder(payload: {
  order: any;
  orderId: string;
  partnerKey: string | null;
  preserveCanceled?: boolean;
}) {
  const { order, orderId, partnerKey, preserveCanceled } = payload;
  const orderDate = order?.created_date ?? order?.date_created ?? order?.order_date ?? null;
  const parsedOrderDate = orderDate ? new Date(orderDate) : new Date();
  const incomingState = normalizeOrderState(order);
  const customer = normalizeAddress(resolveCustomerSource(order));
  const shipping = normalizeAddress(resolveShippingSource(order));
  const existing = await prisma.decathlonOrder.findUnique({
    where: { orderId },
    select: { id: true, orderState: true },
  });
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
  const orderRow = await prisma.decathlonOrder.upsert({
    where: { orderId },
    update: {
      orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
      orderDate: parsedOrderDate,
      orderState,
      partnerKey,
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
      recipientName: shipping?.name ?? null,
      recipientEmail: shipping?.email ?? null,
      recipientPhone: shipping?.phone ?? null,
      recipientAddress1: shipping?.address1 ?? null,
      recipientAddress2: shipping?.address2 ?? null,
      recipientPostalCode: shipping?.postalCode ?? null,
      recipientCity: shipping?.city ?? null,
      recipientCountry: shipping?.country ?? shipping?.countryCode ?? null,
      recipientCountryCode: shipping?.countryCode ?? shipping?.country ?? null,
      rawJson: order ?? null,
    },
    create: {
      orderId,
      orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
      orderDate: parsedOrderDate,
      orderState,
      partnerKey,
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
      recipientName: shipping?.name ?? null,
      recipientEmail: shipping?.email ?? null,
      recipientPhone: shipping?.phone ?? null,
      recipientAddress1: shipping?.address1 ?? null,
      recipientAddress2: shipping?.address2 ?? null,
      recipientPostalCode: shipping?.postalCode ?? null,
      recipientCity: shipping?.city ?? null,
      recipientCountry: shipping?.country ?? shipping?.countryCode ?? null,
      recipientCountryCode: shipping?.countryCode ?? shipping?.country ?? null,
      rawJson: order ?? null,
    },
  });
  return { orderRow, existingId: existing?.id ?? null };
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const state = String(searchParams.get("state") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const client = buildDecathlonOrdersClient();
    const params: Record<string, string | number> = { max: limit };
    if (state) params.order_state_codes = state;
    const [latestOrder] = await prisma.decathlonOrder.findMany({
      orderBy: { updatedAt: "desc" },
      take: 1,
      select: { updatedAt: true },
    });
    const lastSyncAt = latestOrder?.updatedAt ?? null;
    const payload: any = await client.listOrders(params);
    const orders: any[] = extractOrders(payload);
    let canceledOrders: any[] = [];
    if (!state || state.toUpperCase() !== "CANCELED") {
      const baseParams: Record<string, string | number> = { max: limit };
      if (lastSyncAt) baseParams.start_update_date = lastSyncAt.toISOString();
      const [refundedPayload, canceledPayload, closedPayload] = await Promise.all([
        listOrdersSafe(client, {
          ...baseParams,
          order_state_codes: "CANCELED",
          refund_state_codes: "REFUNDED",
        }),
        listOrdersSafe(client, { ...baseParams, order_state_codes: "CANCELED" }),
        listOrdersSafe(client, { ...baseParams, order_state_codes: "CLOSED" }),
      ]);
      const merged = [
        ...extractOrders(refundedPayload),
        ...extractOrders(canceledPayload),
        ...extractOrders(closedPayload),
      ];
      const unique = new Map<string, any>();
      for (const order of merged) {
        const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
        if (!orderId) continue;
        if (!unique.has(orderId)) unique.set(orderId, order);
      }
      canceledOrders = Array.from(unique.values());
    }
    const partnerRows = await prisma.partner.findMany({ select: { key: true } });
    const partnerKeys = new Set(
      partnerRows.map((row) => normalizeProviderKey(row.key)).filter((key): key is string => Boolean(key))
    );
    let upserted = 0;
    for (const order of orders) {
      const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
      if (!orderId) continue;
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
          await prisma.decathlonOrderLine.upsert({
            where: { orderLineId: lineId },
            update: {
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
            },
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
              quantity: Number.isFinite(quantity) ? quantity : 1,
              unitPrice: pickLineAmount(line),
              lineTotal: line?.line_total ?? line?.lineTotal ?? null,
              currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
              rawJson: line ?? null,
            },
          });
        }
      }
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
    return NextResponse.json({ ok: true, fetched: orders.length, upserted });
  } catch (error: any) {
    console.error("[DECATHLON][ORDERS][POLL] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Poll failed" },
      { status: 500 }
    );
  }
}
