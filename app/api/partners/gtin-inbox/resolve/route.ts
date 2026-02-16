import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ResolveBody = {
  rowId?: string;
  gtin?: string;
};

function buildSupplierVariantId(providerKey: string, sku: string, sizeNormalized: string) {
  const cleanKey = providerKey.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanSku = sku.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  const cleanSize = sizeNormalized.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
  return `${cleanKey}:${cleanSku}-${cleanSize}`;
}

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

    const sku = normalizeSku(row.sku) ?? row.sku;
    const sizeNormalized = normalizeSize(row.sizeNormalized ?? row.sizeRaw) ?? row.sizeRaw;
    const supplierVariantId = buildSupplierVariantId(partnerKey, sku, sizeNormalized);
    const now = new Date();

    const offer = await prismaAny.supplierVariant.upsert({
      where: { providerKey_gtin: { providerKey: partnerKey, gtin } },
      create: {
        supplierVariantId,
        supplierSku: sku,
        providerKey: partnerKey,
        gtin,
        sizeRaw: row.sizeRaw,
        sizeNormalized,
        stock: row.rawStock,
        price: row.price,
        lastSyncAt: now,
      },
      update: {
        supplierSku: sku,
        providerKey: partnerKey,
        gtin,
        sizeRaw: row.sizeRaw,
        sizeNormalized,
        stock: row.rawStock,
        price: row.price,
        lastSyncAt: now,
      },
    });

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

    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: offer.supplierVariantId },
      create: {
        supplierVariantId: offer.supplierVariantId,
        gtin,
        providerKey: `${partnerKey}_${gtin}`,
        status: "PARTNER_GTIN",
      },
      update: {
        gtin,
        providerKey: `${partnerKey}_${gtin}`,
        status: "PARTNER_GTIN",
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

    return NextResponse.json({ ok: true, row: updated, supplierVariantId: offer.supplierVariantId });
  } catch (error: any) {
    console.error("[PARTNER][GTIN-INBOX] Resolve failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
