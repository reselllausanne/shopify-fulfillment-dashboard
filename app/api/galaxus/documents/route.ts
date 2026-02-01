import { NextResponse } from "next/server";
import { DocumentType } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { DocumentService } from "@/galaxus/documents/DocumentService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("orderId");

  if (!orderId) {
    return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
  }

  const documents = await prisma.document.findMany({
    where: { orderId },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ ok: true, documents });
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const orderId = body?.orderId as string | undefined;
    const types = body?.types as DocumentType[] | undefined;

    if (!orderId) {
      return NextResponse.json({ ok: false, error: "orderId is required" }, { status: 400 });
    }

    const service = new DocumentService();
    const documents = await service.generateForOrder({ orderId, types });

    return NextResponse.json({ ok: true, documents });
  } catch (error: any) {
    console.error("[GALAXUS][DOCS] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
