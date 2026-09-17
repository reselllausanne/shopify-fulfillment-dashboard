import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierKey = (searchParams.get("supplier") || "").trim().toLowerCase();
    const status = (searchParams.get("status") || "open").trim();
    const limitRaw = Number(searchParams.get("limit") ?? "100");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 500) : 100;

    const p = prisma as any;
    const items = await p.supplierStockReviewItem.findMany({
      where: {
        ...(supplierKey ? { supplierKey } : {}),
        ...(status ? { status } : {}),
      },
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const grouped = items.reduce(
      (acc: Record<string, number>, row: { supplierKey: string }) => {
        acc[row.supplierKey] = (acc[row.supplierKey] ?? 0) + 1;
        return acc;
      },
      {}
    );

    return NextResponse.json({ ok: true, items, grouped, count: items.length });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      id?: string;
      ids?: string[];
      status?: string;
      resolvedBy?: string;
      resolutionNote?: string;
    };

    const ids = body.ids?.length ? body.ids : body.id ? [body.id] : [];
    if (ids.length === 0) {
      return NextResponse.json({ ok: false, error: "id or ids required" }, { status: 400 });
    }

    const status = String(body.status ?? "resolved").trim();
    const p = prisma as any;

    const result = await p.supplierStockReviewItem.updateMany({
      where: { id: { in: ids } },
      data: {
        status,
        resolvedAt: new Date(),
        resolvedBy: body.resolvedBy ?? null,
        resolutionNote: body.resolutionNote ?? null,
      },
    });

    return NextResponse.json({ ok: true, updated: result.count });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
