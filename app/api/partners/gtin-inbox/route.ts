import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { inboxRowSupplierVariantId } from "@/app/lib/partnerImport";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const prismaAny = prisma as any;
    const partner = await prismaAny.partner.findUnique({
      where: { id: session.partnerId },
    });
    const partnerKey = normalizeProviderKey(partner?.key ?? null);
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);
    const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
    const uploadId = searchParams.get("uploadId")?.trim() ?? "";
    const statusParam = searchParams.get("status")?.trim() ?? "";
    const statuses = statusParam
      ? statusParam.split(",").map((item) => item.trim()).filter(Boolean)
      : ["PENDING_GTIN", "AMBIGUOUS_GTIN"];

    const where: Record<string, unknown> = {
      providerKey: partnerKey,
      status: { in: statuses },
      ...(uploadId ? { uploadId } : {}),
    };

    const rows = await prismaAny.partnerUploadRow.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });

    const variantIds = Array.from(
      new Set(
        rows
          .map((r: any) => inboxRowSupplierVariantId(r))
          .filter((id: string | null): id is string => typeof id === "string" && id.length > 0)
      )
    ) as string[];
    const variants =
      variantIds.length > 0
        ? await prisma.supplierVariant.findMany({
            where: { supplierVariantId: { in: variantIds } },
            select: {
              supplierVariantId: true,
              supplierSku: true,
              sizeRaw: true,
              sizeNormalized: true,
              stock: true,
              price: true,
            },
          })
        : [];
    const variantById = new Map(variants.map((v) => [v.supplierVariantId, v]));

    const items = rows.map((r: any) => {
      const sid = inboxRowSupplierVariantId(r);
      const v = sid ? variantById.get(sid) : undefined;
      return {
        ...r,
        supplierVariantId: r.supplierVariantId ?? sid ?? null,
        sku: v?.supplierSku ?? r.sku,
        sizeRaw: v?.sizeRaw ?? r.sizeRaw,
        sizeNormalized: v?.sizeNormalized ?? r.sizeNormalized,
        rawStock: v?.stock ?? r.rawStock,
        price: v?.price != null ? String(v.price) : String(r.price ?? ""),
      };
    });

    const total = await prismaAny.partnerUploadRow.count({ where });
    const nextOffset = items.length === limit ? offset + limit : null;

    return NextResponse.json({ ok: true, items, total, nextOffset });
  } catch (error: any) {
    console.error("[PARTNER][GTIN-INBOX] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
