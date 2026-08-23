import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  isExternalBuyEligibleLine,
  normalizeExternalSupplierKey,
  resolveLineSupplierKey,
} from "@/galaxus/orders/externalBuy";
import { isGalaxusStxSupplierLine } from "@/galaxus/warehouse/lineInventorySource";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function parseMaybeNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(String(value).replace(",", "."));
  return Number.isFinite(num) ? num : null;
}

function parseMaybeDate(value: unknown): Date | null {
  if (!value) return null;
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function trimStr(v: unknown): string {
  return String(v ?? "").trim();
}

async function loadOrder(orderId: string) {
  return (
    (await prisma.galaxusOrder.findUnique({
      where: { id: orderId },
      include: { lines: true },
    })) ??
    (await prisma.galaxusOrder.findUnique({
      where: { galaxusOrderId: orderId },
      include: { lines: true },
    }))
  );
}

export async function GET(_request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const order = await loadOrder(orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const buys = await (prisma as any).galaxusExternalBuy.findMany({
      where: { galaxusOrderId: order.id, cancelledAt: null },
      orderBy: [{ galaxusOrderLineId: "asc" }, { unitIndex: "asc" }],
    });
    return NextResponse.json({ ok: true, buys });
  } catch (error: any) {
    console.error("[GALAXUS][EXTERNAL-BUY][GET] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const lineId = trimStr(body?.lineId);
    if (!lineId) {
      return NextResponse.json({ ok: false, error: "Missing lineId" }, { status: 400 });
    }

    const order = await loadOrder(orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const line = (order.lines || []).find((l: { id: string }) => l.id === lineId);
    if (!line) {
      return NextResponse.json({ ok: false, error: "Line not found" }, { status: 404 });
    }

    if (isGalaxusStxSupplierLine(line as any)) {
      return NextResponse.json(
        { ok: false, error: "STX lines use StockX link tools, not external buy." },
        { status: 400 }
      );
    }
    if (!isExternalBuyEligibleLine(line as any)) {
      return NextResponse.json(
        {
          ok: false,
          error: `Line supplier not eligible for external buy (got ${resolveLineSupplierKey(line as any) ?? "unknown"}).`,
        },
        { status: 400 }
      );
    }

    const lineKey = resolveLineSupplierKey(line as any);
    const bodyKey = normalizeExternalSupplierKey(body?.supplierKey) ?? lineKey;
    if (!bodyKey) {
      return NextResponse.json({ ok: false, error: "Missing supplierKey" }, { status: 400 });
    }
    if (lineKey && bodyKey !== lineKey) {
      return NextResponse.json(
        { ok: false, error: `supplierKey ${bodyKey} does not match line ${lineKey}` },
        { status: 400 }
      );
    }

    const supplierOrderNumber = trimStr(body?.supplierOrderNumber ?? body?.orderNumber);
    if (!supplierOrderNumber) {
      return NextResponse.json({ ok: false, error: "supplierOrderNumber required" }, { status: 400 });
    }

    const unitIndex = Math.max(0, Math.floor(Number(body?.unitIndex ?? 0) || 0));
    const costAmount = parseMaybeNumber(body?.costAmount ?? body?.cost);
    const trackingNumber = trimStr(body?.trackingNumber) || null;
    const trackingUrl = trimStr(body?.trackingUrl) || null;
    const note = trimStr(body?.note) || null;
    const status = trimStr(body?.status) || null;
    const etaMin = parseMaybeDate(body?.etaMin);
    const etaMax = parseMaybeDate(body?.etaMax);

    const prismaAny = prisma as any;
    const existing = await prismaAny.galaxusExternalBuy.findUnique({
      where: {
        galaxusOrderLineId_unitIndex: { galaxusOrderLineId: line.id, unitIndex },
      },
    });

    const data = {
      galaxusOrderId: order.id,
      galaxusOrderLineId: line.id,
      unitIndex,
      supplierKey: bodyKey,
      supplierOrderNumber,
      costAmount,
      currencyCode: trimStr(body?.currencyCode) || "CHF",
      trackingNumber,
      trackingUrl,
      etaMin,
      etaMax,
      status,
      note,
      cancelledAt: null,
      cancelledReason: null,
    };

    const buy = existing
      ? await prismaAny.galaxusExternalBuy.update({
          where: { id: existing.id },
          data,
        })
      : await prismaAny.galaxusExternalBuy.create({ data });

    return NextResponse.json({ ok: true, buy });
  } catch (error: any) {
    console.error("[GALAXUS][EXTERNAL-BUY][POST] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}

export async function DELETE(request: Request, { params }: { params: Promise<{ orderId: string }> }) {
  try {
    const { orderId } = await params;
    const body = await request.json().catch(() => ({}));
    const lineId = trimStr(body?.lineId);
    const buyId = trimStr(body?.buyId);
    const unitIndex = Math.max(0, Math.floor(Number(body?.unitIndex ?? 0) || 0));
    const reason = trimStr(body?.reason) || "manual_cancel";

    const order = await loadOrder(orderId);
    if (!order) return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });

    const prismaAny = prisma as any;
    let existing =
      buyId
        ? await prismaAny.galaxusExternalBuy.findFirst({
            where: { id: buyId, galaxusOrderId: order.id },
          })
        : null;
    if (!existing && lineId) {
      existing = await prismaAny.galaxusExternalBuy.findUnique({
        where: {
          galaxusOrderLineId_unitIndex: { galaxusOrderLineId: lineId, unitIndex },
        },
      });
    }
    if (!existing || existing.galaxusOrderId !== order.id) {
      return NextResponse.json({ ok: false, error: "External buy not found" }, { status: 404 });
    }

    const buy = await prismaAny.galaxusExternalBuy.update({
      where: { id: existing.id },
      data: {
        cancelledAt: new Date(),
        cancelledReason: reason,
      },
    });
    return NextResponse.json({ ok: true, buy });
  } catch (error: any) {
    console.error("[GALAXUS][EXTERNAL-BUY][DELETE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
