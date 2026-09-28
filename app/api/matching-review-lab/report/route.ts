import { NextResponse } from "next/server";
import { buildRulesReport, readReviews } from "@/matching-review-lab";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Propose matching rules from stored reviews — never applies them. */
export async function GET() {
  try {
    const reviews = readReviews();
    const report = buildRulesReport(reviews);
    return NextResponse.json({
      ok: true,
      applied: false,
      report,
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

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const reviews = Array.isArray(body?.reviews) ? body.reviews : readReviews();
    const report = buildRulesReport(reviews);
    return NextResponse.json({
      ok: true,
      applied: false,
      report,
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
