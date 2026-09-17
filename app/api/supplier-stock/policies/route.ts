import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { ensureSupplierStockPolicies } from "@/inventory/supplierStock/applyRun";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await ensureSupplierStockPolicies();
    const p = prisma as any;
    const policies = await p.supplierStockPolicy.findMany({
      orderBy: { supplierKey: "asc" },
    });
    return NextResponse.json({ ok: true, policies });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const body = (await request.json()) as {
      supplierKey?: string;
      action?: "approve" | "pause" | "monitoring";
      approvedBy?: string;
      notes?: string;
    };

    const supplierKey = String(body.supplierKey ?? "").trim().toLowerCase();
    const action = body.action;
    if (!supplierKey || !action) {
      return NextResponse.json({ ok: false, error: "supplierKey and action required" }, { status: 400 });
    }

    const p = prisma as any;
    let data: Record<string, unknown> = {};

    if (action === "approve") {
      data = {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: body.approvedBy ?? null,
        pausedAt: null,
        pausedReason: null,
        consecutiveInvalidRuns: 0,
      };
    } else if (action === "pause") {
      data = {
        status: "manually_paused",
        pausedAt: new Date(),
        pausedReason: "manual_pause",
      };
    } else if (action === "monitoring") {
      data = {
        status: "monitoring_only",
        pausedAt: null,
        pausedReason: null,
      };
    } else {
      return NextResponse.json({ ok: false, error: "unknown action" }, { status: 400 });
    }

    if (body.notes != null) data.notes = body.notes;

    const policy = await p.supplierStockPolicy.update({
      where: { supplierKey },
      data,
    });

    return NextResponse.json({ ok: true, policy });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
