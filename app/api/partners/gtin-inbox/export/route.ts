import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
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

    const headers = ["providerKey", "sku", "size", "rawStock", "price", "gtin"];
    const csvRows = rows.map((row: any) => ({
      providerKey: row.providerKey,
      sku: row.sku,
      size: row.sizeRaw,
      rawStock: row.rawStock?.toString() ?? "",
      price: row.price?.toString() ?? "",
      gtin: "",
    }));

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
