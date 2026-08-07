import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

/** Health data is admin-only (personal PHI on shared business DB). */
export async function requireHealthAdmin(req: NextRequest): Promise<NextResponse | null> {
  const role = await getStaffRoleFromRequest(req);
  if (role === "admin") return null;
  if (!role) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json(
    { ok: false, error: "Forbidden", details: "Health module is admin-only." },
    { status: 403 }
  );
}
