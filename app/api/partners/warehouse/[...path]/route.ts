import type { NextRequest } from "next/server";
import { handlePartnerRequest } from "@/lib/warehouse/api/partner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/** Partner warehouse API. `/api/partners/**` is public at proxy level: the partner session is checked in the handler. */
async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handlePartnerRequest(req, path ?? []);
}

export const GET = handle;
export const POST = handle;
