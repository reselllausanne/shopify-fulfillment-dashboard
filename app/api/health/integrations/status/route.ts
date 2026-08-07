import { NextRequest, NextResponse } from "next/server";

import { requireHealthAdmin } from "@/app/lib/healthAdminAuth";
import { listProviders } from "@/healthdata/providers";
import { getDebugSnapshot, listIntegrationAccounts } from "@/healthdata/repository";

export async function GET(req: NextRequest) {
  const denied = await requireHealthAdmin(req);
  if (denied) return denied;

  const [accounts, debug, capabilities] = await Promise.all([
    listIntegrationAccounts(),
    getDebugSnapshot(),
    Promise.resolve(listProviders().map((p) => p.getCapabilities())),
  ]);

  return NextResponse.json({
    ok: true,
    accounts,
    debug,
    capabilities,
  });
}
