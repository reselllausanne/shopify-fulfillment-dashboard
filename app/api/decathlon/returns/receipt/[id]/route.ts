import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import {
  MARKETPLACE_RETURN_PLATFORM_DECATHLON,
  isReturnAutomationDryRun,
} from "@/decathlon/returns/receipt/config";
import {
  confirmMarketplaceReturn,
  rejectMarketplaceReturn,
  retryFailedMarketplaceReturn,
} from "@/decathlon/returns/receipt/process";
import { confirmShopifyReturnReceipt } from "@/shopify/returns/receipt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const row = await prisma.marketplaceReturn.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({
      ok: true,
      dryRun: isReturnAutomationDryRun(),
      return: {
        ...row,
        returnAmount: row.returnAmount != null ? Number(row.returnAmount) : null,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Get failed" }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Params) {
  try {
    const { id } = await params;
    const body = await request.json().catch(() => ({}));
    const action = String(body?.action ?? "").trim();
    const row = await prisma.marketplaceReturn.findUnique({ where: { id } });
    if (!row) {
      return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
    }
    if (action === "confirm") {
      const checked = Boolean(body?.physicallyChecked);
      if (!checked) {
        return NextResponse.json(
          { ok: false, error: "Physical check confirmation required" },
          { status: 400 }
        );
      }
      if (row.platform !== MARKETPLACE_RETURN_PLATFORM_DECATHLON) {
        if (row.platform !== "shopify") {
          return NextResponse.json(
            { ok: false, error: "Action unsupported for this platform" },
            { status: 400 }
          );
        }
        const result = await confirmShopifyReturnReceipt({ id });
        return NextResponse.json(result, { status: result.ok ? 200 : 409 });
      }
      const result = await confirmMarketplaceReturn({ id });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    if (row.platform !== MARKETPLACE_RETURN_PLATFORM_DECATHLON) {
      return NextResponse.json(
        { ok: false, error: "Only confirm is enabled for Shopify returns" },
        { status: 400 }
      );
    }

    if (action === "reject") {
      const result = await rejectMarketplaceReturn({
        id,
        staffNote: body?.staffNote ?? body?.note ?? null,
      });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    if (action === "retry") {
      const result = await retryFailedMarketplaceReturn({ id });
      return NextResponse.json(result, { status: result.ok ? 200 : 409 });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[RETURNS][ACTION] Failed", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Action failed" }, { status: 500 });
  }
}
