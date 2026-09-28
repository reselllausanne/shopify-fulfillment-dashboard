import { NextResponse } from "next/server";
import {
  getBatch,
  simulateBatch,
  type LabMatchProposal,
} from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

function withMutedConsole<T>(fn: () => T): T {
  const original = console.log;
  console.log = () => {};
  try {
    return fn();
  } finally {
    console.log = original;
  }
}

function slimProposal(p: LabMatchProposal) {
  const buy = p.proposed?.supplierOrder;
  return {
    unitKey: p.unit.unitKey,
    channel: p.unit.channel,
    orderId: p.unit.orderId,
    orderNumber: p.unit.orderNumber,
    orderDate: p.unit.orderDate,
    lineId: p.unit.lineId,
    unitIndex: p.unit.unitIndex,
    productTitle: p.unit.productTitle,
    gtin: p.unit.gtin,
    sku: p.unit.sku,
    sizeRaw: p.unit.sizeRaw,
    matchMethod: p.matchMethod,
    needsGenderOrSizeReview: p.needsGenderOrSizeReview,
    stockxAccountKey: p.stockxAccountKey,
    refusalReasons: p.refusalReasons,
    proposed: buy
      ? {
          supplierOrderNumber: buy.supplierOrderNumber,
          orderId: buy.orderId,
          purchaseDate: buy.purchaseDate,
          offerAmount: buy.offerAmount,
          currencyCode: buy.currencyCode,
          productTitle: buy.productTitle,
          skuKey: buy.skuKey,
          sizeEU: buy.sizeEU,
          awb: buy.awb ?? null,
          confidence: p.proposed?.confidence ?? null,
          score: p.proposed?.score ?? null,
          reasons: p.proposed?.reasons ?? [],
        }
      : null,
    topCandidates: p.topCandidates.slice(0, 5).map((c) => ({
      supplierOrderNumber: c.supplierOrder.supplierOrderNumber,
      orderId: c.supplierOrder.orderId,
      purchaseDate: c.supplierOrder.purchaseDate,
      offerAmount: c.supplierOrder.offerAmount,
      productTitle: c.supplierOrder.productTitle,
      sizeEU: c.supplierOrder.sizeEU,
      awb: c.supplierOrder.awb ?? null,
      confidence: c.confidence,
      score: c.score,
      reasons: c.reasons.slice(0, 4),
    })),
    /** Full proposal kept server-side via batch; client sends unitKey on review. */
  };
}

/** Dry-run matcher simulation by batchId — never writes live matches. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const batchId = String(body?.batchId ?? "").trim();
    if (!batchId) {
      return NextResponse.json({ ok: false, error: "batchId required" }, { status: 400 });
    }

    const batch = getBatch(batchId);
    if (!batch) {
      return NextResponse.json(
        { ok: false, error: "batch expired or unknown — reload lot" },
        { status: 404 }
      );
    }

    const consumedBuyNumbers = new Set<string>(
      Array.isArray(body?.consumedBuyNumbers) ? body.consumedBuyNumbers : []
    );
    const consumedBuyOrderIds = new Set<string>(
      Array.isArray(body?.consumedBuyOrderIds) ? body.consumedBuyOrderIds : []
    );
    const enforceAccountSeparation = body?.enforceAccountSeparation !== false;

    const result = withMutedConsole(() =>
      simulateBatch(batch.units, batch.buys, {
        consumedBuyNumbers,
        consumedBuyOrderIds,
        enforceAccountSeparation,
        fetchedAt: batch.freshness.fetchedAt,
        fromCache: batch.freshness.fromCache,
      })
    );

    // Stash full proposals on the batch for review persistence.
    batch.lastProposals = result.proposals;

    return NextResponse.json({
      ok: true,
      wroteLiveMatch: false,
      batchId,
      simulatedAt: result.simulatedAt,
      stockxFreshness: result.stockxFreshness,
      stats: result.stats,
      proposals: result.proposals.map(slimProposal),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }
}
