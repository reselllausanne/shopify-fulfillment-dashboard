import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStorageAdapterForUrl } from "@/galaxus/storage/storage";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ documentId: string }> }
) {
  const staffRole = await getStaffRoleFromRequest(request);
  if (!staffRole) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const { documentId } = await params;
  const document = await prisma.document.findUnique({
    where: { id: documentId },
  });

  if (!document) {
    return NextResponse.json({ ok: false, error: "Document not found" }, { status: 404 });
  }

  const storage = getStorageAdapterForUrl(document.storageUrl);
  const file = await storage.getPdf(document.storageUrl);

  const filename = `${document.type.toLowerCase()}-v${document.version}.pdf`;
  return new Response(file.content as unknown as BodyInit, {
    headers: {
      "content-type": "application/pdf",
      "content-disposition": `inline; filename="${filename}"`,
      "content-length": String(file.content.length ?? 0),
    },
  });
}
