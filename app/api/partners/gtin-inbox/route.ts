import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
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

    const items = await prismaAny.partnerUploadRow.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
    });

    const total = await prismaAny.partnerUploadRow.count({ where });
    const nextOffset = items.length === limit ? offset + limit : null;

    return NextResponse.json({ ok: true, items, total, nextOffset });
  } catch (error: any) {
    console.error("[PARTNER][GTIN-INBOX] List failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
