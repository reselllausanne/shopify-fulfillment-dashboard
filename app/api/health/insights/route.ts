import { NextRequest, NextResponse } from "next/server";

import { prisma } from "@/app/lib/prisma";
import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { generateInsights, setInsightFeedback } from "@/healthdata/analytics/insights";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const insights = await prisma.healthGeneratedInsight.findMany({
    orderBy: { generatedAt: "desc" },
    take: 50,
  });
  return NextResponse.json({
    ok: true,
    insights,
    disclaimer:
      "These observations are explainable heuristics, not medical diagnoses.",
  });
}

export async function POST(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const body = (await req.json().catch(() => ({}))) as {
    action?: string;
    id?: string;
    feedback?: "useful" | "false" | "irrelevant";
  };

  if (body.action === "generate") {
    const drafts = await generateInsights();
    return NextResponse.json({ ok: true, generated: drafts.length, drafts });
  }

  if (body.action === "feedback" && body.id && body.feedback) {
    const row = await setInsightFeedback(body.id, body.feedback);
    return NextResponse.json({ ok: true, insight: row });
  }

  return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
}
