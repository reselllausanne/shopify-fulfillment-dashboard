import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import {
  confirmStockxCheckout,
  getStockxCheckoutState,
  previewStockxCheckout,
} from "@/lib/stockxCheckout";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

async function requireAdmin(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  return role === "admin";
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const state = await getStockxCheckoutState();
  return NextResponse.json({ ok: true, ...state });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin(req))) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const action = String(body.action ?? "preview");

  try {
    if (action === "preview") {
      const orderName = String(body.orderName ?? "").trim();
      if (!orderName) {
        return NextResponse.json({ ok: false, error: "Missing orderName" }, { status: 400 });
      }
      const preview = await previewStockxCheckout({
        orderName,
        slug: body.slug ? String(body.slug) : null,
      });
      return NextResponse.json({ ok: true, preview });
    }

    if (action === "confirm") {
      const previewId = String(body.previewId ?? "").trim();
      const confirmTotalChf = Number(body.confirmTotalChf);
      if (!previewId || !Number.isFinite(confirmTotalChf)) {
        return NextResponse.json(
          { ok: false, error: "previewId + confirmTotalChf required" },
          { status: 400 }
        );
      }
      const result = await confirmStockxCheckout({ previewId, confirmTotalChf });
      return NextResponse.json({ ok: result.ok, ...result }, { status: result.ok ? 200 : 409 });
    }

    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 400 });
  } catch (error: any) {
    console.error("[STOCKX-CHECKOUT]", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Checkout failed" },
      { status: 500 }
    );
  }
}
