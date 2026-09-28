import { NextResponse } from "next/server";
import {
  labTokenStatus,
  saveGalaxusLabToken,
  saveShopifyLabToken,
} from "@/matching-review-lab/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Status of the two production token files the lab uses. */
export async function GET() {
  try {
    const status = await labTokenStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

/**
 * Save one account token into the same file production matching uses.
 * body: { account: "shopify" | "galaxus", token: string }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const account = String(body?.account ?? "").trim().toLowerCase();
    const token = String(body?.token ?? "").trim();
    if (!token) {
      return NextResponse.json({ ok: false, error: "token required" }, { status: 400 });
    }
    if (account === "shopify") {
      const slot = await saveShopifyLabToken(token);
      return NextResponse.json({
        ok: true,
        account: "shopify",
        source: slot.source,
        accountKey: slot.accountKey,
        expiresAt: slot.expiresAt,
      });
    }
    if (account === "galaxus") {
      const slot = await saveGalaxusLabToken(token);
      return NextResponse.json({
        ok: true,
        account: "galaxus",
        source: slot.source,
        accountKey: slot.accountKey,
        expiresAt: slot.expiresAt,
      });
    }
    return NextResponse.json(
      { ok: false, error: 'account must be "shopify" or "galaxus"' },
      { status: 400 }
    );
  } catch (err) {
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
