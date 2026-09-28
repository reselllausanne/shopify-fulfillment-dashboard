import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Read-only evidence rows for dashboard proof view.
 * Columns: DB actuel | preuve live | proposée | delta | raison | URL
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

    const ids = rows.map((r: { supplierVariantId: string }) => r.supplierVariantId);
    const variants =
      ids.length > 0
        ? await p.supplierVariant.findMany({
            where: { supplierVariantId: { in: ids } },
            select: { supplierVariantId: true, stock: true },
          })
        : [];
    const dbStockById = new Map<string, number>(
      variants.map((v: { supplierVariantId: string; stock: number }) => [
        v.supplierVariantId,
        Number(v.stock) || 0,
      ])
    );

    const now = Date.now();
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
        const sourceQty =
          r.supplierStockQty ?? (typeof raw.sourceStockQty === "number" ? raw.sourceStockQty : null);
        const proposedQty = Number(r.publishedQty) || 0;
        const dbStock = dbStockById.get(r.supplierVariantId) ?? null;
        const delta = dbStock == null ? null : proposedQty - dbStock;
        const observedMs = r.lastObservedAt
          ? new Date(r.lastObservedAt).getTime()
          : r.lastProofAt
            ? new Date(r.lastProofAt).getTime()
            : null;
        const freshnessStatus =
          observedMs == null
            ? "stale_unknown"
            : now - observedMs <= 48 * 3600_000
              ? "fresh"
              : "stale";

        return {
          supplierKey: r.supplierKey,
          supplierVariantId: r.supplierVariantId,
          gtin: r.gtin,
          supplierSku: r.supplierSku ?? (typeof raw.sku === "string" ? raw.sku : null),
          productName: r.productName,
          productUrl: r.productUrl ?? r.variantUrl,
          variant: r.supplierSku ?? r.gtin,
          dbStock,
          sourceQty,
          proposedQty,
          delta,
          reason:
            r.zeroReason ??
            (typeof raw.qtyReason === "string" ? raw.qtyReason : null) ??
            r.availabilityStatus,
          freshnessStatus,
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
