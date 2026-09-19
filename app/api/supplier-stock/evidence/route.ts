import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only evidence rows for dashboard proof view.
 * Shows raw parse, URL, source qty, proposed qty, reason — no marketplace writes.
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const supplierKey = (searchParams.get("supplier") || "").trim().toLowerCase();
    const limitRaw = Number(searchParams.get("limit") ?? "50");
    const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(Math.trunc(limitRaw), 1), 200) : 50;

    const p = prisma as any;
    const rows = await p.supplierVariantEvidence.findMany({
      where: supplierKey ? { supplierKey } : {},
      orderBy: { updatedAt: "desc" },
      take: limit,
    });

    const items = rows.map(
      (r: {
        supplierKey: string;
        supplierVariantId: string;
        gtin: string | null;
        supplierSku: string | null;
        productName: string | null;
        productUrl: string | null;
        variantUrl: string | null;
        supplierStockQty: number | null;
        publishedQty: number;
        zeroReason: string | null;
        availabilityStatus: string;
        availabilitySignal: string | null;
        quantitySource: string | null;
        rawParseJson: Record<string, unknown> | null;
        lastProofAt: Date | null;
        lastObservedAt: Date | null;
        sourceScrapeRunId: number | null;
        needsReview: boolean;
      }) => {
        const raw = (r.rawParseJson ?? {}) as Record<string, unknown>;
        return {
          supplierKey: r.supplierKey,
          supplierVariantId: r.supplierVariantId,
          gtin: r.gtin,
          supplierSku: r.supplierSku ?? (typeof raw.sku === "string" ? raw.sku : null),
          productName: r.productName,
          productUrl: r.productUrl ?? r.variantUrl,
          variant: r.supplierSku ?? r.gtin,
          sourceQty: r.supplierStockQty ?? (typeof raw.sourceStockQty === "number" ? raw.sourceStockQty : null),
          proposedQty: r.publishedQty,
          reason:
            r.zeroReason ??
            (typeof raw.qtyReason === "string" ? raw.qtyReason : null) ??
            r.availabilityStatus,
          availabilityStatus: r.availabilityStatus,
          availabilitySignal: r.availabilitySignal,
          quantitySource: r.quantitySource,
          rawProof: raw,
          lastProofAt: r.lastProofAt,
          lastObservedAt: r.lastObservedAt,
          sourceScrapeRunId: r.sourceScrapeRunId,
          needsReview: r.needsReview,
        };
      }
    );

    return NextResponse.json({ ok: true, items, count: items.length });
  } catch (error: unknown) {
    const message = String((error as Error)?.message ?? error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
