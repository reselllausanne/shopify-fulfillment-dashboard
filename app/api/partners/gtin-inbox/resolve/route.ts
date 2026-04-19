import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { inboxRowSupplierVariantId } from "@/app/lib/partnerImport";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveBody = {
  rowId?: string;
  gtin?: string;
};

export async function POST(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as ResolveBody;
    const rowId = body.rowId?.trim() ?? "";
    const gtin = body.gtin?.trim() ?? "";
    if (!rowId) {
      return NextResponse.json({ ok: false, error: "rowId required" }, { status: 400 });
    }
    if (!validateGtin(gtin)) {
      return NextResponse.json({ ok: false, error: "Invalid GTIN" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const partner = await prismaAny.partner.findUnique({
      where: { id: session.partnerId },
    });
    const partnerKey = normalizeProviderKey(partner?.key ?? null);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    const row = await prismaAny.partnerUploadRow.findUnique({ where: { id: rowId } });
    if (!row || row.providerKey !== partnerKey) {
      return NextResponse.json({ ok: false, error: "Row not found" }, { status: 404 });
    }

    const supplierVariantId = inboxRowSupplierVariantId(row);
    if (!supplierVariantId) {
      return NextResponse.json({ ok: false, error: "Could not resolve variant id for row" }, { status: 400 });
    }
    const variantRow = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId },
      select: {
        supplierSku: true,
        sizeRaw: true,
        sizeNormalized: true,
        stock: true,
        price: true,
      },
    });
    const sku = normalizeSku(variantRow?.supplierSku ?? row.sku) ?? row.sku;
    const sizeNormalized =
      normalizeSize(variantRow?.sizeNormalized ?? variantRow?.sizeRaw ?? row.sizeNormalized ?? row.sizeRaw) ??
      row.sizeNormalized ??
      row.sizeRaw;
    const sizeRaw = variantRow?.sizeRaw ?? row.sizeRaw;
    const stockVal = variantRow?.stock ?? row.rawStock;
    const priceVal = variantRow?.price ?? row.price;
    const providerKey = buildProviderKey(gtin, supplierVariantId);
    if (!providerKey) {
      return NextResponse.json({ ok: false, error: "Invalid GTIN" }, { status: 400 });
    }
    const now = new Date();

    assertMappingIntegrity({
      supplierVariantId,
      gtin,
      providerKey,
      status: "MATCHED",
    });
    let offer = await prismaAny.supplierVariant.findUnique({
      where: { providerKey_gtin: { providerKey, gtin } },
    });
    if (offer) {
      offer = await prismaAny.supplierVariant.update({
        where: { supplierVariantId: offer.supplierVariantId },
        data: {
          supplierSku: sku,
          providerKey,
          gtin,
          sizeRaw,
          sizeNormalized,
          stock: stockVal,
          price: priceVal,
          lastSyncAt: now,
        },
      });
    } else {
      offer = await prismaAny.supplierVariant.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          supplierSku: sku,
          providerKey,
          gtin,
          sizeRaw,
          sizeNormalized,
          stock: stockVal,
          price: priceVal,
          lastSyncAt: now,
        },
        update: {
          supplierSku: sku,
          providerKey,
          gtin,
          sizeRaw,
          sizeNormalized,
          stock: stockVal,
          price: priceVal,
          lastSyncAt: now,
        },
      });
    }

    if (offer.supplierVariantId !== supplierVariantId) {
      const existingMapping = await prismaAny.variantMapping.findUnique({
        where: { supplierVariantId: offer.supplierVariantId },
        select: { supplierVariantId: true },
      });
      if (existingMapping) {
        await prismaAny.variantMapping.deleteMany({ where: { supplierVariantId } });
      } else {
        await prismaAny.variantMapping.updateMany({
          where: { supplierVariantId },
          data: { supplierVariantId: offer.supplierVariantId },
        });
      }
      await prismaAny.supplierVariant.deleteMany({ where: { supplierVariantId } });
    }

    assertMappingIntegrity({
      supplierVariantId: offer.supplierVariantId,
      gtin,
      providerKey,
      status: "MATCHED",
    });
    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: offer.supplierVariantId },
      create: {
        supplierVariantId: offer.supplierVariantId,
        gtin,
        providerKey,
        status: "MATCHED",
      },
      update: {
        gtin,
        providerKey,
        status: "MATCHED",
      },
    });

    const updated = await prismaAny.partnerUploadRow.update({
      where: { id: rowId },
      data: {
        status: "RESOLVED",
        gtinResolved: gtin,
        updatedAt: now,
      },
    });

    const origin = new URL(request.url).origin;
    await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
    return NextResponse.json({ ok: true, row: updated, supplierVariantId: offer.supplierVariantId });
  } catch (error: any) {
    console.error("[PARTNER][GTIN-INBOX] Resolve failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
