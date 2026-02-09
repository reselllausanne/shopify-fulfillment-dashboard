import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const latest = await (prisma as any).galaxusEdiFile.findFirst({
      where: { direction: "IN", docType: "ORDP" },
      orderBy: { processedAt: "desc" },
    });

    if (!latest) {
      return NextResponse.json({ ok: false, error: "No inbound ORDP files found." }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      file: {
        filename: latest.filename,
        status: latest.status,
        orderRef: latest.orderRef,
        processedAt: latest.processedAt,
      },
      payload: latest.payloadJson ?? null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][INBOUND][LATEST] Failed:", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to fetch inbound file." },
      { status: 500 }
    );
  }
}
