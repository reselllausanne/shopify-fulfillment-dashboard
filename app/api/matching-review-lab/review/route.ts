import { NextResponse } from "next/server";
import {
  getBatch,
  MATCHING_REVIEW_REASONS,
  saveReview,
  type LabMatchProposal,
  type LabStockxBuy,
  type MatchingReviewDecision,
  type MatchingReviewReasonCode,
} from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DECISIONS: MatchingReviewDecision[] = [
  "CORRECT",
  "WRONG_PICK_BUY",
  "NO_STOCKX_MATCH",
  "SPECIAL_EQUIVALENCE",
  "NEVER_AUTO_MATCH",
];

/** Persist a human review to local JSONL. Never writes live OrderMatch. */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const batchId = String(body?.batchId ?? "").trim();
    const unitKey = String(body?.unitKey ?? "").trim();
    const decision = body?.decision as MatchingReviewDecision;
    const reasonCodes = (body?.reasonCodes ?? []) as MatchingReviewReasonCode[];
    const reasonNote = body?.reasonNote ? String(body.reasonNote) : null;
    const chosenBuyOrderId = body?.chosenBuyOrderId
      ? String(body.chosenBuyOrderId)
      : null;

    if (!batchId || !unitKey) {
      return NextResponse.json(
        { ok: false, error: "batchId and unitKey required" },
        { status: 400 }
      );
    }
    if (!DECISIONS.includes(decision)) {
      return NextResponse.json({ ok: false, error: "invalid decision" }, { status: 400 });
    }
    for (const code of reasonCodes) {
      if (!MATCHING_REVIEW_REASONS.includes(code)) {
        return NextResponse.json(
          { ok: false, error: `invalid reasonCode: ${code}` },
          { status: 400 }
        );
      }
    }

    const batch = getBatch(batchId);
    if (!batch) {
      return NextResponse.json(
        { ok: false, error: "batch expired or unknown — reload lot" },
        { status: 404 }
      );
    }

    const proposals = batch.lastProposals ?? [];
    let proposal = proposals.find((p) => p.unit.unitKey === unitKey);
    if (!proposal) {
      // Fallback: rebuild empty proposal shell from unit if simulate not run / lost.
      const unit = batch.units.find((u) => u.unitKey === unitKey);
      if (!unit) {
        return NextResponse.json({ ok: false, error: "unit not in batch" }, { status: 404 });
      }
      proposal = {
        unit,
        proposed: null,
        topCandidates: [],
        matchMethod: "NONE",
        refusalReasons: ["NO_SIMULATION"],
        needsGenderOrSizeReview: false,
        stockxAccountKey: null,
      };
    }

    let chosenBuy: LabStockxBuy | null = null;
    if (chosenBuyOrderId) {
      const needle = chosenBuyOrderId.trim().replace(/^#\s*/, "").replace(/\s+/g, "");
      chosenBuy =
        batch.buys.find((b) => {
          const id = String(b.orderId ?? "").trim().replace(/^#\s*/, "").replace(/\s+/g, "");
          const num = String(b.supplierOrderNumber ?? "")
            .trim()
            .replace(/^#\s*/, "")
            .replace(/\s+/g, "");
          return id === needle || num === needle;
        }) ?? null;
      if (!chosenBuy) {
        return NextResponse.json(
          {
            ok: false,
            error: `chosen buy ${chosenBuyOrderId} not in batch snapshot — search again after reload`,
          },
          { status: 400 }
        );
      }
    }
    if (
      (decision === "WRONG_PICK_BUY" || decision === "SPECIAL_EQUIVALENCE") &&
      !chosenBuy
    ) {
      return NextResponse.json(
        { ok: false, error: "chosenBuyOrderId required for this decision" },
        { status: 400 }
      );
    }

    const record = saveReview({
      proposal,
      decision,
      reasonCodes,
      reasonNote,
      chosenBuy,
    });

    return NextResponse.json({
      ok: true,
      wroteLiveMatch: false,
      record,
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

export async function GET() {
  try {
    const { readReviews } = await import("@/matching-review-lab");
    const reviews = readReviews();
    return NextResponse.json({
      ok: true,
      count: reviews.length,
      reviews,
      path: "data/matching-review-lab/reviews.jsonl",
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
