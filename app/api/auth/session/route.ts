import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";

export async function GET(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  if (!role) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, role });
}
