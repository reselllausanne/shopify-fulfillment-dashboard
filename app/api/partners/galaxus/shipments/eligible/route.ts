import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { requirePartnerSelfFulfillAccess } from "@/app/api/partners/galaxus/_auth";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "@/app/api/partners/galaxus/orders/partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalize(value: unknown): string {
  return String(value ?? "").trim();
}

export async function GET(request: NextRequest) {
  try {
    const auth = await requirePartnerSelfFulfillAccess(request);
    if (!auth.access) return auth.response!;
    const access = auth.access;

    const { searchParams } = new URL(request.url);
    const anchorRaw = normalize(searchParams.get("anchorOrderId"));
    if (!anchorRaw) {
      return NextResponse.json({ ok: false, error: "anchorOrderId is required" }, { status: 400 });
    }

    const anchor =
      (await prisma.galaxusOrder.findUnique({
        where: { id: anchorRaw },
        include: { lines: true },
      })) ??
      (await prisma.galaxusOrder.findUnique({
        where: { galaxusOrderId: anchorRaw },
        include: { lines: true },
      }));
    if (!anchor) {
      return NextResponse.json({ ok: false, error: "Anchor order not found" }, { status: 404 });
    }
    if (anchor.archivedAt || anchor.cancelledAt) {
      return NextResponse.json({ ok: false, error: "Anchor order is archived or cancelled" }, { status: 400 });
    }
    if (normalize(anchor.deliveryType).toLowerCase() === "direct_delivery") {
      return NextResponse.json({ ok: false, error: "Anchor order must be warehouse delivery" }, { status: 400 });
    }

    const partnerGtins = await resolvePartnerGtins(
      collectGtinsFromLines(anchor.lines),
      access.providerKey
    );
    const anchorPartnerLines = anchor.lines.filter((line) =>
      lineMatchesPartnerScope(line, access.providerKey, partnerGtins)
    );
    if (anchorPartnerLines.length === 0) {
      return NextResponse.json({ ok: false, error: "Anchor order not in partner scope" }, { status: 404 });
    }

    const recipientPostalCode = normalize(anchor.recipientPostalCode);
    const recipientAddress1 = normalize(anchor.recipientAddress1);
    const recipientCity = normalize(anchor.recipientCity);
    if (!recipientPostalCode || !recipientAddress1 || !recipientCity) {
      return NextResponse.json(
        { ok: false, error: "Anchor order has no delivery address to match" },
        { status: 400 }
      );
    }

    const orders = await prisma.galaxusOrder.findMany({
      where: {
        archivedAt: null,
        cancelledAt: null,
        deliveryType: { not: "direct_delivery" },
        recipientPostalCode,
        recipientAddress1,
        recipientCity,
      },
      include: { lines: true },
      orderBy: [{ orderDate: "desc" }, { createdAt: "desc" }],
      take: 100,
    });

    const payload = await Promise.all(
      orders.map(async (order) => {
        const gtins = collectGtinsFromLines(order.lines);
        const gtinSet = await resolvePartnerGtins(gtins, access.providerKey);
        const lines = order.lines
          .filter((line) => lineMatchesPartnerScope(line, access.providerKey, gtinSet))
          .map((line) => ({
            id: line.id,
            lineNumber: line.lineNumber ?? null,
            supplierPid: line.supplierPid ?? null,
            buyerPid: line.buyerPid ?? null,
            supplierSku: line.supplierSku ?? null,
            gtin: line.gtin ?? null,
            productName: line.productName ?? line.description ?? "Item",
            description: line.description ?? null,
            size: line.size ?? null,
            quantity: Number(line.quantity ?? 0),
            remaining: Number(line.quantity ?? 0),
          }))
          .filter((line) => line.quantity > 0);
        return {
          id: order.id,
          galaxusOrderId: order.galaxusOrderId,
          orderNumber: order.orderNumber ?? order.galaxusOrderId,
          orderDate: order.orderDate,
          recipientName: order.recipientName ?? null,
          recipientAddress1: order.recipientAddress1 ?? null,
          recipientPostalCode: order.recipientPostalCode ?? null,
          recipientCity: order.recipientCity ?? null,
          lines,
        };
      })
    );

    const scopedOrders = payload.filter((order) => order.lines.length > 0);
    return NextResponse.json({
      ok: true,
      anchorOrderId: anchor.id,
      orders: scopedOrders,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load eligible lines" },
      { status: 500 }
    );
  }
}
