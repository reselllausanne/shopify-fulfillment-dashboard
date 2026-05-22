import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type LineRow = {
  id: string;
  orderId: string;
  lineNumber: number;
  buyerPid: string | null;
  supplierPid: string | null;
  gtin: string | null;
  quantity: number;
  warehouseMarkedShippedAt: Date | null;
};

function norm(value: unknown): string {
  return String(value ?? "").trim();
}

function toChunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const body = await request.json().catch(() => ({}));
    const apply =
      ["1", "true", "yes"].includes(String(searchParams.get("apply") ?? "").toLowerCase()) ||
      body?.apply === true;

    const shipments = await (prisma as any).shipment.findMany({
      where: {
        OR: [{ delrSentAt: { not: null } }, { delrStatus: { in: ["UPLOADED"] } }],
      },
      select: {
        id: true,
        orderId: true,
        delrSentAt: true,
        items: {
          select: {
            orderId: true,
            buyerPid: true,
            supplierPid: true,
            gtin14: true,
            quantity: true,
          },
        },
      },
      orderBy: [{ delrSentAt: "asc" }, { createdAt: "asc" }],
    });

    const orderIds: string[] = Array.from(
      new Set(
        shipments.flatMap((s: any) =>
          (s.items ?? [])
            .map((it: any) => norm(it?.orderId) || norm(s?.orderId))
            .filter(Boolean)
        )
      )
    );
    if (orderIds.length === 0) {
      return NextResponse.json({ ok: true, apply, shipments: 0, lines: 0, markedShouldBe: 0, updated: 0 });
    }

    const lines = (await prisma.galaxusOrderLine.findMany({
      where: { orderId: { in: orderIds } },
      select: {
        id: true,
        orderId: true,
        lineNumber: true,
        buyerPid: true,
        supplierPid: true,
        gtin: true,
        quantity: true,
        warehouseMarkedShippedAt: true,
      },
      orderBy: [{ orderId: "asc" }, { lineNumber: "asc" }],
    })) as LineRow[];

    const linesByOrder = new Map<string, LineRow[]>();
    for (const line of lines) {
      const arr = linesByOrder.get(line.orderId) ?? [];
      arr.push(line);
      linesByOrder.set(line.orderId, arr);
    }

    const shippedQtyByLine = new Map<string, number>();
    const unresolved: Array<{ shipmentId: string; orderId: string; buyerPid: string; supplierPid: string; quantity: number }> = [];

    for (const shipment of shipments as any[]) {
      for (const item of shipment.items ?? []) {
        const orderId = norm(item?.orderId) || norm(shipment?.orderId);
        const buyerPid = norm(item?.buyerPid);
        const supplierPid = norm(item?.supplierPid);
        let qty = Math.max(0, Number(item?.quantity ?? 0));
        if (!orderId || qty <= 0) continue;
        const orderLines = linesByOrder.get(orderId) ?? [];
        let candidates: LineRow[] = [];

        if (buyerPid) {
          candidates = orderLines.filter((line) => norm(line.buyerPid) === buyerPid);
        } else if (supplierPid) {
          candidates = orderLines.filter((line) => norm(line.supplierPid) === supplierPid);
        }

        for (const line of candidates) {
          const already = shippedQtyByLine.get(line.id) ?? 0;
          const need = Math.max(0, Number(line.quantity ?? 0) - already);
          if (need <= 0) continue;
          const use = Math.min(need, qty);
          if (use > 0) {
            shippedQtyByLine.set(line.id, already + use);
            qty -= use;
          }
          if (qty <= 0) break;
        }

        if (qty > 0) {
          unresolved.push({
            shipmentId: String(shipment.id),
            orderId,
            buyerPid,
            supplierPid,
            quantity: qty,
          });
        }
      }
    }

    const shouldBeMarked = new Set<string>();
    for (const line of lines) {
      const shipped = shippedQtyByLine.get(line.id) ?? 0;
      if (shipped >= Math.max(0, Number(line.quantity ?? 0))) shouldBeMarked.add(line.id);
    }

    const currentlyMarked = new Set(lines.filter((line) => line.warehouseMarkedShippedAt != null).map((line) => line.id));
    const toMark = [...shouldBeMarked].filter((id) => !currentlyMarked.has(id));
    const toUnmark = [...currentlyMarked].filter((id) => !shouldBeMarked.has(id));

    let markedCount = 0;
    let unmarkedCount = 0;
    if (apply) {
      for (const chunk of toChunks(toMark, 500)) {
        const res = await prisma.galaxusOrderLine.updateMany({
          where: { id: { in: chunk }, warehouseMarkedShippedAt: null },
          data: { warehouseMarkedShippedAt: new Date() },
        });
        markedCount += Number(res?.count ?? 0);
      }
      for (const chunk of toChunks(toUnmark, 500)) {
        const res = await prisma.galaxusOrderLine.updateMany({
          where: { id: { in: chunk }, warehouseMarkedShippedAt: { not: null } },
          data: { warehouseMarkedShippedAt: null },
        });
        unmarkedCount += Number(res?.count ?? 0);
      }
    }

    return NextResponse.json({
      ok: true,
      apply,
      shipments: shipments.length,
      lines: lines.length,
      markedShouldBe: shouldBeMarked.size,
      toMark: toMark.length,
      toUnmark: toUnmark.length,
      updated: apply ? { marked: markedCount, unmarked: unmarkedCount } : null,
      unresolvedCount: unresolved.length,
      unresolvedSample: unresolved.slice(0, 50),
    });
  } catch (error: any) {
    console.error("[GALAXUS][WAREHOUSE][RECONCILE_DELR] Failed:", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed" }, { status: 500 });
  }
}
