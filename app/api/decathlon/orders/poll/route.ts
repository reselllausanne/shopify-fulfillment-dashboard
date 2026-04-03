import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import { pickMiraklLineGtin } from "@/decathlon/mirakl/orderLineFields";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const state = String(searchParams.get("state") ?? "").trim();
    const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
    const client = buildDecathlonOrdersClient();
    const params: Record<string, string | number> = { max: limit };
    if (state) {
      params.order_state_codes = state;
    }
    const payload: any = await client.listOrders(params);
    const orders: any[] =
      payload?.orders ?? payload?.order_list ?? payload?.orderList ?? payload?.data ?? [];
    let upserted = 0;
    for (const order of orders) {
      const orderId = String(order?.id ?? order?.order_id ?? order?.orderId ?? "").trim();
      if (!orderId) continue;
      const orderDate = order?.created_date ?? order?.date_created ?? order?.order_date ?? null;
      const parsedOrderDate = orderDate ? new Date(orderDate) : new Date();
      const lines = Array.isArray(order?.order_lines) ? order.order_lines : order?.lines ?? [];
      const orderRow = await prisma.decathlonOrder.upsert({
        where: { orderId },
        update: {
          orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
          orderDate: parsedOrderDate,
          orderState: String(order?.order_state ?? order?.state ?? order?.status ?? ""),
          currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
          totalPrice: pickOrderAmount(order),
          shippingPrice: order?.shipping_price ?? order?.shippingPrice ?? null,
          customerName: order?.customer?.name ?? order?.customer?.name1 ?? null,
          customerEmail: order?.customer?.email ?? null,
          customerPhone: order?.customer?.phone ?? null,
          customerAddress1: order?.customer?.address1 ?? order?.customer?.street1 ?? null,
          customerAddress2: order?.customer?.address2 ?? order?.customer?.street2 ?? null,
          customerPostalCode: order?.customer?.zip_code ?? order?.customer?.zipCode ?? null,
          customerCity: order?.customer?.city ?? null,
          customerCountry: order?.customer?.country ?? null,
          customerCountryCode: order?.customer?.country_code ?? order?.customer?.countryCode ?? null,
          recipientName: order?.shipping?.name ?? order?.shipping?.name1 ?? null,
          recipientEmail: order?.shipping?.email ?? null,
          recipientPhone: order?.shipping?.phone ?? null,
          recipientAddress1: order?.shipping?.address1 ?? order?.shipping?.street1 ?? null,
          recipientAddress2: order?.shipping?.address2 ?? order?.shipping?.street2 ?? null,
          recipientPostalCode: order?.shipping?.zip_code ?? order?.shipping?.zipCode ?? null,
          recipientCity: order?.shipping?.city ?? null,
          recipientCountry: order?.shipping?.country ?? null,
          recipientCountryCode: order?.shipping?.country_code ?? order?.shipping?.countryCode ?? null,
          rawJson: order ?? null,
        },
        create: {
          orderId,
          orderNumber: String(order?.order_number ?? order?.orderNumber ?? orderId),
          orderDate: parsedOrderDate,
          orderState: String(order?.order_state ?? order?.state ?? order?.status ?? ""),
          currencyCode: String(order?.currency_code ?? order?.currency ?? "CHF"),
          totalPrice: pickOrderAmount(order),
          shippingPrice: order?.shipping_price ?? order?.shippingPrice ?? null,
          customerName: order?.customer?.name ?? order?.customer?.name1 ?? null,
          customerEmail: order?.customer?.email ?? null,
          customerPhone: order?.customer?.phone ?? null,
          customerAddress1: order?.customer?.address1 ?? order?.customer?.street1 ?? null,
          customerAddress2: order?.customer?.address2 ?? order?.customer?.street2 ?? null,
          customerPostalCode: order?.customer?.zip_code ?? order?.customer?.zipCode ?? null,
          customerCity: order?.customer?.city ?? null,
          customerCountry: order?.customer?.country ?? null,
          customerCountryCode: order?.customer?.country_code ?? order?.customer?.countryCode ?? null,
          recipientName: order?.shipping?.name ?? order?.shipping?.name1 ?? null,
          recipientEmail: order?.shipping?.email ?? null,
          recipientPhone: order?.shipping?.phone ?? null,
          recipientAddress1: order?.shipping?.address1 ?? order?.shipping?.street1 ?? null,
          recipientAddress2: order?.shipping?.address2 ?? order?.shipping?.street2 ?? null,
          recipientPostalCode: order?.shipping?.zip_code ?? order?.shipping?.zipCode ?? null,
          recipientCity: order?.shipping?.city ?? null,
          recipientCountry: order?.shipping?.country ?? null,
          recipientCountryCode: order?.shipping?.country_code ?? order?.shipping?.countryCode ?? null,
          rawJson: order ?? null,
        },
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
    return NextResponse.json({ ok: true, fetched: orders.length, upserted });
  } catch (error: any) {
    console.error("[DECATHLON][ORDERS][POLL] Failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Poll failed" },
      { status: 500 }
    );
  }
}
