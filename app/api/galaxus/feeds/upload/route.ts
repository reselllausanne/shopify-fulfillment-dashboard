import { NextResponse } from "next/server";
import { parseFeedUploadRequest, runFeedUpload } from "@/galaxus/ops/runFeedUpload";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 900;

export async function POST(request: Request) {
  const input = parseFeedUploadRequest(request);
  const result = await runFeedUpload(input);
  const { status, ...body } = result;
  return NextResponse.json(body, { status: status ?? (result.ok ? 200 : 500) });
}

export async function GET(request: Request) {
  return POST(request);
}
