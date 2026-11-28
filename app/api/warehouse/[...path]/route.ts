import type { NextRequest } from "next/server";
import { handleStaffRequest } from "@/lib/warehouse/api/http";
import { staffRoutes } from "@/lib/warehouse/api/staff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ path: string[] }> };

/** Staff warehouse API. Route table: lib/warehouse/api/staff.ts. Staff cookie checked by proxy.ts and again here. */
async function handle(req: NextRequest, ctx: Ctx) {
  const { path } = await ctx.params;
  return handleStaffRequest(req, path ?? [], staffRoutes);
}

export const GET = handle;
export const POST = handle;
export const PATCH = handle;
