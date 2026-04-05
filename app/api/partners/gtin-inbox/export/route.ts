import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { inboxRowSupplierVariantId } from "@/app/lib/partnerImport";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { toCsv } from "@/galaxus/exports/csv";

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
    const statusParam = searchParams.get("status")?.trim() ?? "";
    const statuses = statusParam
      ? statusParam.split(",").map((item) => item.trim()).filter(Boolean)
      : ["PENDING_GTIN", "AMBIGUOUS_GTIN"];

    const rows = await prismaAny.partnerUploadRow.findMany({
      where: {
        providerKey: partnerKey,
        status: { in: statuses },
      },
      orderBy: { updatedAt: "desc" },
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

    const headers = ["providerKey", "sku", "size", "rawStock", "price", "gtin"];
    const csvRows = rows.map((row: any) => {
      const sid = inboxRowSupplierVariantId(row);
      const v = sid ? variantById.get(sid) : undefined;
      return {
        providerKey: row.providerKey,
        sku: v?.supplierSku ?? row.sku,
        size: v?.sizeRaw ?? row.sizeRaw,
        rawStock: (v?.stock ?? row.rawStock)?.toString() ?? "",
        price: (v?.price ?? row.price)?.toString() ?? "",
        gtin: "",
      };
    });

    const csv = toCsv(headers, csvRows);
    const filename = `pending-gtin-${partnerKey}-${Date.now()}.csv`;
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (error: any) {
    console.error("[PARTNER][GTIN-INBOX] Export failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
