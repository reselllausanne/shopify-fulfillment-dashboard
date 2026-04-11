import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { isAlternativeProductsPartnerKey } from "@/app/lib/alternativeProducts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (!isAlternativeProductsPartnerKey(session.partnerKey)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 200);

  const prismaAny = prisma as any;
  const uploads = await prismaAny.alternativeProductUpload.findMany({
    where: { partnerId: session.partnerId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  const uploadHistory = uploads.map((u: any) => ({
    id: u.id,
    filename: u.filename ?? "",
    status: u.status ?? "",
    totalRows: u.totalRows ?? 0,
    importedRows: u.importedRows ?? 0,
    errorRows: u.errorRows ?? 0,
    errorsJson: u.errorsJson ?? null,
    createdAt: u.createdAt ?? null,
  }));

  const activeCount = await prismaAny.alternativeProduct.count({
    where: { partnerId: session.partnerId, archivedAt: null },
  });

  return NextResponse.json({
    ok: true,
    uploads: uploadHistory,
    activeCount,
  });
}
