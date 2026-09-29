import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { orderByIds, searchCatalogVariantIds } from "@/app/lib/catalogSearch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SUGGEST_TIMEOUT_MS = 4000;

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "8"), 1), 20);
  if (q.length < 2) return NextResponse.json({ ok: true, items: [] });

  let ids: string[] = [];
  try {
    ids = await searchCatalogVariantIds(prisma, q, { limit, timeoutMs: SUGGEST_TIMEOUT_MS });
  } catch (error: any) {
    const message = String(error?.message ?? "");
    if (message.includes("statement timeout") || message.includes("canceling statement")) {
      return NextResponse.json({ ok: true, items: [], timedOut: true });
    }
    return NextResponse.json({ ok: false, error: message || "Suggest failed" }, { status: 500 });
  }

  const rows = ids.length
    ? await prisma.supplierVariant.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          supplierVariantId: true,
          providerKey: true,
          gtin: true,
          supplierSku: true,
          supplierProductName: true,
          supplierBrand: true,
          price: true,
          stock: true,
        },
      })
    : [];

  return NextResponse.json({ ok: true, items: orderByIds(rows, ids) });
}
