import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import {
  runDecathlonAwbBackfill,
  selectDecathlonAwbCandidates,
} from "@/lib/decathlonAwbBackfill";
import {
  runGalaxusAwbBackfill,
  selectGalaxusAwbCandidates,
} from "@/lib/galaxusAwbBackfill";
import { runAwbBackfill, selectAwbCandidates } from "@/lib/stockxAwbBackfill";
import { readGalaxusStockxToken } from "@/lib/stockxGalaxusAuth";
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
    const includeGalaxus = body?.includeGalaxus !== false;
    const includeDecathlon = body?.includeDecathlon !== false;
    const pasted = String(body?.token ?? "").trim().replace(/^bearer\s+/i, "");
    const stored = pasted ? null : await readServerStockxToken();
    const galaxusStored = pasted ? null : await readGalaxusStockxToken();
    const token = pasted || stored?.token || galaxusStored || "";

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

    const sharedOpts = {
      token,
      days: Number(body?.days ?? 45),
      limit: Number(body?.limit ?? 40),
      dryRun: Boolean(body?.dryRun ?? false),
      includeFulfilled: Boolean(body?.includeFulfilled ?? false),
    };

    const shopifyResult = await runAwbBackfill(sharedOpts);

    const galaxusResult = includeGalaxus ? await runGalaxusAwbBackfill(sharedOpts) : null;
    const decathlonResult = includeDecathlon ? await runDecathlonAwbBackfill(sharedOpts) : null;

    const items = [
      ...shopifyResult.items.map((item) => ({ ...item, channel: "shopify" as const })),
      ...(galaxusResult?.items ?? []),
      ...(decathlonResult?.items ?? []),
    ];

    return NextResponse.json({
      ok: true,
      tokenSource: pasted ? "pasted" : stored?.token ? stored.source : galaxusStored ? "galaxus_file" : null,
      tokenExpiresAt: (pasted ? stockxTokenExpiresAt(pasted) : stored?.expiresAt) ?? null,
      shopify: shopifyResult,
      galaxus: galaxusResult,
      decathlon: decathlonResult,
      dryRun: shopifyResult.dryRun,
      scanned:
        shopifyResult.scanned + (galaxusResult?.scanned ?? 0) + (decathlonResult?.scanned ?? 0),
      candidates:
        shopifyResult.candidates +
        (galaxusResult?.candidates ?? 0) +
        (decathlonResult?.candidates ?? 0),
      updated:
        shopifyResult.updated + (galaxusResult?.updated ?? 0) + (decathlonResult?.updated ?? 0),
      emailsSent: shopifyResult.emailsSent,
      authFailures:
        shopifyResult.authFailures +
        (galaxusResult?.authFailures ?? 0) +
        (decathlonResult?.authFailures ?? 0),
      abortedReason:
        shopifyResult.abortedReason ||
        galaxusResult?.abortedReason ||
        decathlonResult?.abortedReason ||
        null,
      items,
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
  const prismaAny = prisma as any;
  const [
    inTransitPool,
    galaxusInTransitPool,
    decathlonInTransitPool,
    stored,
    galaxusToken,
    missing,
    total,
    galaxusMissing,
    galaxusTotal,
    decathlonMissing,
    decathlonTotal,
  ] = await Promise.all([
    selectAwbCandidates({ since, limit: 500, includeFulfilled: false }),
    selectGalaxusAwbCandidates({ since, limit: 500, includeFulfilled: false }),
    selectDecathlonAwbCandidates({ since, limit: 500, includeFulfilled: false }),
    readServerStockxToken(),
    readGalaxusStockxToken(),
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
    prismaAny.galaxusStockxMatch.count({
      where: {
        stockxAwb: null,
        galaxusOrderDate: { gte: since },
        order: { deliveryType: { in: ["direct_delivery", "warehouse_delivery"] } },
      },
    }),
    prismaAny.galaxusStockxMatch.count({
      where: {
        galaxusOrderDate: { gte: since },
        order: { deliveryType: { in: ["direct_delivery", "warehouse_delivery"] } },
      },
    }),
    prismaAny.decathlonStockxMatch.count({
      where: {
        stockxAwb: null,
        decathlonOrderDate: { gte: since },
      },
    }),
    prismaAny.decathlonStockxMatch.count({
      where: {
        decathlonOrderDate: { gte: since },
      },
    }),
  ]);

  return NextResponse.json({
    ok: true,
    days,
    missingAwb: missing,
    missingAwbInTransit: inTransitPool.filter((row) => !row.stockxAwb).length,
    stockxMatches: total,
    galaxus: {
      missingAwb: galaxusMissing,
      missingAwbInTransit: galaxusInTransitPool.filter((row: any) => !row.stockxAwb).length,
      stockxMatches: galaxusTotal,
    },
    decathlon: {
      missingAwb: decathlonMissing,
      missingAwbInTransit: decathlonInTransitPool.filter((row: any) => !row.stockxAwb).length,
      stockxMatches: decathlonTotal,
    },
    storedToken: stored
      ? { source: stored.source, expiresAt: stored.expiresAt }
      : galaxusToken
        ? { source: "galaxus_file", expiresAt: null }
        : null,
  });
}
