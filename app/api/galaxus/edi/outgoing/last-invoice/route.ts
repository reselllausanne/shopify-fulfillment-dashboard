import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const orderId = String(searchParams.get("orderId") ?? "").trim();
    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }
    const latest = await (prisma as any).galaxusEdiFile.findFirst({
      where: {
        direction: "OUT",
        docType: "INVO",
        OR: [
          { orderId },
          { orderRef: orderId },
          { filename: { contains: orderId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      select: {
        filename: true,
        createdAt: true,
        orderRef: true,
        payloadJson: true,
      },
    });
    if (!latest) {
      return NextResponse.json({ ok: false, error: "No INVO found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      file: {
        filename: latest.filename,
        createdAt: latest.createdAt,
        orderRef: latest.orderRef,
      },
      payload: latest.payloadJson ?? null,
    });
  } catch (error: any) {
    console.error("[GALAXUS][EDI][LAST-INVOICE] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
