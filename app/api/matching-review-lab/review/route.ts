import { NextResponse } from "next/server";
import {
  readReviews,
  saveReview,
  type LabMatchProposal,
  type LabStockxBuy,
  type MatchingReviewDecision,
  type MatchingReviewReasonCode,
  MATCHING_REVIEW_REASONS,
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
    const proposal = body?.proposal as LabMatchProposal | undefined;
    const decision = body?.decision as MatchingReviewDecision;
    const reasonCodes = (body?.reasonCodes ?? []) as MatchingReviewReasonCode[];
    const reasonNote = body?.reasonNote ? String(body.reasonNote) : null;
    const chosenBuy = (body?.chosenBuy ?? null) as LabStockxBuy | null;

    if (!proposal?.unit) {
      return NextResponse.json({ ok: false, error: "proposal.unit required" }, { status: 400 });
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
