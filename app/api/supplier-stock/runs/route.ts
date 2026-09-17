import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  buildRunContractReport,
  getSupplierStockEnforceMode,
  isObservationContractImplemented,
} from "@/inventory/supplierStock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierKey = (searchParams.get("supplier") || "").trim().toLowerCase();
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

    const p = prisma as any;
    const runs = await p.supplierScrapeQualityRun.findMany({
      where: supplierKey ? { supplierKey } : undefined,
      orderBy: { createdAt: "desc" },
      take: limit,
    });

    const enforce = getSupplierStockEnforceMode();
    const enriched = (runs ?? []).map((run: Record<string, unknown>) => {
      const summary = (run.summaryJson ?? {}) as Record<string, unknown>;
      const key = String(run.supplierKey ?? "");
      const received =
        Number(summary.observationsReceivedThisRun ?? run.variantsProcessed ?? 0) || 0;
      const report =
        summary.observationContractImplemented != null
          ? {
              observationContractImplemented: Boolean(summary.observationContractImplemented),
              observationsReceivedThisRun: received,
              sourceProofCoverage:
                summary.sourceProofCoverage == null ? null : Number(summary.sourceProofCoverage),
              eligibleForApproval: Boolean(summary.eligibleForApproval),
              eligibleForApprovalReason: (summary.eligibleForApprovalReason as string | null) ?? null,
            }
          : buildRunContractReport({
              supplierKey: key,
              observationsReceivedThisRun: received,
              variantsProcessed: Number(run.variantsProcessed) || received,
            });

      return {
        ...run,
        observationContractImplemented: report.observationContractImplemented,
        observationsReceivedThisRun: report.observationsReceivedThisRun,
        sourceProofCoverage: report.sourceProofCoverage,
        eligibleForApproval: report.eligibleForApproval,
        eligibleForApprovalReason: report.eligibleForApprovalReason,
        // Honesty: registry false until scraper wired — call sites ≠ page proof
        registryContractImplemented: isObservationContractImplemented(key),
      };
    });

    return NextResponse.json({
      ok: true,
      runs: enriched,
      count: enriched.length,
      enforce,
      banner: enforce.banner,
    });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
