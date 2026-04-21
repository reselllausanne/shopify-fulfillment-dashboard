import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { resolveDecathlonReturnOfferSku } from "@/decathlon/returns/resolveReturnOfferSku";
import {
  applyReturnRestock,
  extractGtinFromOfferSku,
} from "@/decathlon/returns/theRestockFromReturnLine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeOfferSku(value: unknown): string | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  return text.toUpperCase();
}

export async function POST(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  try {
    const { lineId } = await params;
    if (!lineId?.trim()) {
      return NextResponse.json({ ok: false, error: "Missing line id" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const row = await prismaAny.decathlonReturnLine.findUnique({
      where: { id: lineId.trim() },
      include: {
        decathlonReturn: { select: { status: true } },
        orderLine: true,
      },
    });

    if (!row) {
      return NextResponse.json({ ok: false, error: "Return line not found" }, { status: 404 });
    }
    if (row.restockAppliedAt) {
      return NextResponse.json({ ok: false, error: "Already restocked" }, { status: 409 });
    }

    const status = String(row.decathlonReturn?.status ?? "").trim().toUpperCase();
    if (status !== "CLOSED" && status !== "RECEIVED") {
      return NextResponse.json(
        { ok: false, error: "Return must be CLOSED or RECEIVED" },
        { status: 400 }
      );
    }

    const offerSku = normalizeOfferSku(resolveDecathlonReturnOfferSku(row));

    const orderLine = row.orderLine ?? null;
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

    let supplierVariant: any = null;
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
      supplierVariant?.price ?? orderLine?.unitPrice ?? row.unitPrice ?? null;
    const basePriceParsed = basePriceRaw !== null ? Number(basePriceRaw) : NaN;
    const basePrice = Number.isFinite(basePriceParsed) && basePriceParsed > 0 ? basePriceParsed : null;

    const restockResult = await applyReturnRestock({
      returnLine: row,
      orderLine,
      offerSku: offerSku ?? normalizeOfferSku(row.productId),
      basePrice,
    });

    if (!restockResult.applied) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Could not restock: no STX SupplierVariant for this offer (to clone as THE_), and no THE row to add stock to",
        },
        { status: 400 }
      );
    }

    await prismaAny.decathlonReturnLine.update({
      where: { id: row.id },
      data: {
        restockAppliedAt: new Date(),
        restockSupplierVariantId: restockResult.supplierVariantId ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      restockSupplierVariantId: restockResult.supplierVariantId ?? null,
    });
  } catch (error: any) {
    console.error("[DECATHLON][RETURNS][RESTOCK]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Restock failed" },
      { status: 500 }
    );
  }
}

/** Clears restock flags so you can run POST restock again (does not change SupplierVariant stock). */
export async function DELETE(_request: Request, { params }: { params: Promise<{ lineId: string }> }) {
  try {
    const { lineId } = await params;
    if (!lineId?.trim()) {
      return NextResponse.json({ ok: false, error: "Missing line id" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const row = await prismaAny.decathlonReturnLine.findUnique({
      where: { id: lineId.trim() },
      select: { id: true, restockAppliedAt: true },
    });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Return line not found" }, { status: 404 });
    }
    if (!row.restockAppliedAt) {
      return NextResponse.json({ ok: true, cleared: false, message: "Was not marked restocked" });
    }

    await prismaAny.decathlonReturnLine.update({
      where: { id: row.id },
      data: {
        restockAppliedAt: null,
        restockSupplierVariantId: null,
      },
    });

    return NextResponse.json({ ok: true, cleared: true });
  } catch (error: any) {
    console.error("[DECATHLON][RETURNS][RESTOCK][DELETE]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Clear restock failed" },
      { status: 500 }
    );
  }
}
