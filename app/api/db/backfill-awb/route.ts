import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { runAwbBackfill, selectAwbCandidates } from "@/lib/stockxAwbBackfill";
import {
  readServerStockxToken,
  stockxTokenExpiresAt,
  writeServerStockxToken,
} from "@/lib/stockxServerToken";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 800;

export async function POST(req: NextRequest) {
  try {
    const role = await getStaffRoleFromRequest(req);
    if (role !== "admin") {
      return NextResponse.json(
        { ok: false, error: "Forbidden", details: "Admin role required." },
        { status: 403 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const pasted = String(body?.token ?? "").trim().replace(/^bearer\s+/i, "");
    const stored = pasted ? null : await readServerStockxToken();
    const token = pasted || stored?.token || "";

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing StockX bearer token",
          details: "No valid stored token; paste a fresh one.",
        },
        { status: 400 }
      );
    }

    // Keep the pasted bearer for the scheduled job, which has no browser to copy it from.
    if (pasted) {
      await writeServerStockxToken(pasted).catch((error) =>
        console.warn("[BACKFILL-AWB] Could not persist token:", error?.message || error)
      );
    }

    const result = await runAwbBackfill({
      token,
      days: Number(body?.days ?? 45),
      limit: Number(body?.limit ?? 40),
      dryRun: Boolean(body?.dryRun ?? false),
      includeFulfilled: Boolean(body?.includeFulfilled ?? false),
    });

    return NextResponse.json({
      ok: true,
      tokenSource: pasted ? "pasted" : (stored?.source ?? null),
      tokenExpiresAt: (pasted ? stockxTokenExpiresAt(pasted) : stored?.expiresAt) ?? null,
      ...result,
    });
  } catch (error: any) {
    console.error("[BACKFILL-AWB] Error:", error?.message || error);
    return NextResponse.json(
      { ok: false, error: error?.message || "Internal error" },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  const role = await getStaffRoleFromRequest(req);
  if (role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const days = Math.min(
    Math.max(Number(new URL(req.url).searchParams.get("days") ?? 45) || 45, 1),
    180
  );
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const [inTransitPool, stored, missing, total] = await Promise.all([
    selectAwbCandidates({ since, limit: 500, includeFulfilled: false }),
    readServerStockxToken(),
    prisma.orderMatch.count({
      where: {
        stockxAwb: null,
        stockxChainId: { not: null },
        stockxOrderId: { not: null },
        stockxOrderNumber: { startsWith: "0" },
        shopifyCreatedAt: { gte: since },
      },
    }),
    prisma.orderMatch.count({
      where: {
        stockxOrderNumber: { startsWith: "0" },
        shopifyCreatedAt: { gte: since },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    days,
    missingAwb: missing,
    missingAwbInTransit: inTransitPool.filter((row) => !row.stockxAwb).length,
    stockxMatches: total,
    storedToken: stored
      ? { source: stored.source, expiresAt: stored.expiresAt }
      : null,
  });
}
