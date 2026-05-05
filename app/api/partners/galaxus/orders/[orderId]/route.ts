import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  collectGtinsFromLines,
  lineMatchesPartnerScope,
  resolvePartnerGtins,
} from "../partnerLineScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ orderId: string }> }
) {
  try {
    const session = await getPartnerSession(req);
    if (!session) return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    const pk = normalizeProviderKey(session.partnerKey);
    if (!pk) return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    const { orderId } = await params;

    const order =
      (await prisma.galaxusOrder.findFirst({
        where: {
          id: orderId,
        },
        include: { lines: true, shipments: true },
      })) ??
      (await prisma.galaxusOrder.findFirst({
        where: {
          galaxusOrderId: orderId,
        },
        include: { lines: true, shipments: true },
      }));

    if (!order) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    const gtins = collectGtinsFromLines(order.lines);
    const partnerGtins = await resolvePartnerGtins(gtins, pk);
    const partnerLines = order.lines.filter((line) => lineMatchesPartnerScope(line, pk, partnerGtins));
    if (partnerLines.length === 0) {
      return NextResponse.json({ ok: false, error: "Order not found" }, { status: 404 });
    }

    return NextResponse.json({
      ok: true,
      order: { ...order, lines: partnerLines },
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to load Galaxus order" },
      { status: 500 }
    );
  }
}
