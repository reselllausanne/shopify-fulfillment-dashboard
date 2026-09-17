import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { defaultPolicyStatusForSupplier, TEMPORARY_MONITORING_EXCEPTION } from "@/inventory/supplierStock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const p = prisma as any;
    const policies = await p.supplierStockPolicy.findMany({
      orderBy: { supplierKey: "asc" },
    });
    return NextResponse.json({
      ok: true,
      policies,
      note: "Policies are not auto-seeded. Staging seed: SUPPLIER_STOCK_ALLOW_SEED=1 npx tsx scripts/supplier-stock-dry-run.ts --seed-policies",
      temporaryMonitoringException: TEMPORARY_MONITORING_EXCEPTION,
    });
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
      /** Required to approve — confirms scraper emits SupplierVariantObservation. */
      observationContractValidated?: boolean;
    };

    const supplierKey = String(body.supplierKey ?? "").trim().toLowerCase();
    const action = body.action;
    if (!supplierKey || !action) {
      return NextResponse.json({ ok: false, error: "supplierKey and action required" }, { status: 400 });
    }

    const p = prisma as any;
    let data: Record<string, unknown> = {};

    if (action === "approve") {
      if (!body.observationContractValidated) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Cannot approve: set observationContractValidated=true only after scraper emits SupplierVariantObservation and you validated live page proof. Without the contract, supplier stays review_required.",
          },
          { status: 400 }
        );
      }
      // Require at least one quality run that recorded observationContractPresent.
      const quality = await p.supplierScrapeQualityRun.findFirst({
        where: { supplierKey, valid: true },
        orderBy: { createdAt: "desc" },
        select: { summaryJson: true },
      });
      const contractOk = Boolean((quality?.summaryJson as any)?.observationContractPresent);
      if (!contractOk) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "No successful quality run with observationContractPresent=true. Implement scraper observation payload first.",
          },
          { status: 400 }
        );
      }

      data = {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: body.approvedBy ?? null,
        pausedAt: null,
        pausedReason: null,
        consecutiveInvalidRuns: 0,
        notes: body.notes ?? `approved; default was ${defaultPolicyStatusForSupplier(supplierKey)}`,
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
        notes: TEMPORARY_MONITORING_EXCEPTION,
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
