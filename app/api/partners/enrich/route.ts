import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    const prismaAny = prisma as any;
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const all = ["1", "true", "yes"].includes((searchParams.get("all") ?? "").toLowerCase());
    const debug = searchParams.get("debug") === "1";
    const forceMissing = searchParams.get("force") === "1";
    const raw = searchParams.get("raw") === "1";
    const supplierSku = searchParams.get("sku")?.trim() || null;

    const partner = await prismaAny.partner.findUnique({
      where: { id: session.partnerId },
    });
    const partnerKey = partner?.key ?? null;
    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "Partner key missing" }, { status: 400 });
    }

    type SupplierVariantRow = {
      supplierVariantId: string;
      supplierSku: string | null;
      sizeRaw: string | null;
    };

    const prefix = `${partnerKey.toLowerCase()}:`;
    const supplierVariants = (await prismaAny.supplierVariant.findMany({
      where: {
        supplierVariantId: { startsWith: prefix },
        ...(supplierSku ? { supplierSku } : {}),
      },
      select: { supplierVariantId: true, supplierSku: true, sizeRaw: true },
      orderBy: { updatedAt: "desc" },
    })) as SupplierVariantRow[];
    const skuSet = new Set(supplierVariants.map((item) => item.supplierSku));

    const collected: any[] = [];
    let processed = 0;
    for (const sku of skuSet) {
      const { results } = await runKickdbEnrich({
        debug,
        forceMissing,
        raw,
        supplierSku: sku,
      });
      processed += results.length;
      if (debug) collected.push(...results);
    }

    const skuByVariantId = new Map(
      supplierVariants.map((item) => [item.supplierVariantId, item])
    );
    const mappedResults = (debug ? collected : []).map((row: any) => {
      const match = row.supplierVariantId ? skuByVariantId.get(row.supplierVariantId) : null;
      return {
        providerKey: partnerKey,
        sku: match?.supplierSku ?? null,
        sizeRaw: match?.sizeRaw ?? null,
        status: row.status,
        gtin: row.gtin ?? null,
        debug: row.debug,
      };
    });

    return NextResponse.json({
      ok: true,
      mode: "all",
      processed,
      results: mappedResults,
    });
  } catch (error: any) {
    console.error("[PARTNER][KICKDB][ENRICH] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
