import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession, isPartnerRoleAllowed, type PartnerSession } from "@/app/lib/partnerAuth";
import { isPartnerSelfFulfillEnabled } from "@/app/lib/partnerSelfFulfill";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

export type PartnerSelfFulfillAccess = {
  session: PartnerSession;
  providerKey: string;
};

export async function requirePartnerSelfFulfillAccess(
  req: NextRequest
): Promise<{ access: PartnerSelfFulfillAccess | null; response: NextResponse | null }> {
  const session = await getPartnerSession(req);
  if (!session) {
    return {
      access: null,
      response: NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (!isPartnerRoleAllowed(session.role)) {
    return {
      access: null,
      response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }),
    };
  }
  if (!isPartnerSelfFulfillEnabled(session.partnerKey)) {
    return {
      access: null,
      response: NextResponse.json({ ok: false, error: "Partner self-fulfill disabled" }, { status: 403 }),
    };
  }
  const providerKey = normalizeProviderKey(session.partnerKey);
  if (!providerKey) {
    return {
      access: null,
      response: NextResponse.json({ ok: false, error: "Invalid partner key" }, { status: 400 }),
    };
  }
  return { access: { session, providerKey }, response: null };
}
