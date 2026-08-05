import { NextRequest, NextResponse } from "next/server";
import {
  buildScanFulfillmentDemoDocuments,
  isScanFulfillmentDemoEnabled,
  resolveScanDemoChannel,
} from "@/lib/scanFulfillmentDemo";
import { resolveBrowserPrintConfig } from "@/galaxus/directDelivery/runDirectSwissPostLabel";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    if (!isScanFulfillmentDemoEnabled()) {
      return NextResponse.json(
        { ok: false, error: "Scan fulfillment demo disabled (set SCAN_FULFILLMENT_DEMO=1)" },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const code = String(body?.code ?? body?.awb ?? "").trim();
    const channel = resolveScanDemoChannel(code);
    if (!channel) {
      return NextResponse.json(
        { ok: false, error: "Unknown demo code (use 1000 Decathlon or 1001 Galaxus)" },
        { status: 400 }
      );
    }

    const result = await buildScanFulfillmentDemoDocuments(code);
    return NextResponse.json({
      ...result,
      browserPrintConfig: resolveBrowserPrintConfig(),
    });
  } catch (error: any) {
    console.error("[SCAN-FULFILLMENT-DEMO]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Demo document generation failed" },
      { status: 500 }
    );
  }
}
