import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const partner = await (prisma as any).partner.findUnique({
    where: { id: session.partnerId },
    select: { id: true, key: true, name: true, active: true, defaultLeadTimeDays: true },
  });
  if (!partner) {
    return NextResponse.json({ error: "Partner not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true, partner });
}

export async function PATCH(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const body = (await req.json().catch(() => ({}))) as { defaultLeadTimeDays?: number | null };
  if (!("defaultLeadTimeDays" in body)) {
    return NextResponse.json({ ok: false, error: "defaultLeadTimeDays required" }, { status: 400 });
  }
  const raw = body.defaultLeadTimeDays;
  let value: number | null = null;
  if (raw !== null && raw !== undefined) {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0 || n > 365) {
      return NextResponse.json(
        { ok: false, error: "defaultLeadTimeDays must be between 0 and 365 or null" },
        { status: 400 }
      );
    }
    value = Math.round(n);
  }
  const partner = await (prisma as any).partner.update({
    where: { id: session.partnerId },
    data: { defaultLeadTimeDays: value },
    select: { id: true, key: true, name: true, active: true, defaultLeadTimeDays: true },
  });
  return NextResponse.json({ ok: true, partner });
}
