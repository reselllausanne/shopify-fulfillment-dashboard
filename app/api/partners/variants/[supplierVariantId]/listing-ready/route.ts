import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import { validateGtin } from "@/app/lib/normalize";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { partnerOwnsSupplierVariant } from "@/app/lib/partnerCatalogScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function hasListingImage(v: {
  hostedImageUrl?: string | null;
  sourceImageUrl?: string | null;
  images?: unknown | null;
}): boolean {
  const h = String(v.hostedImageUrl ?? "").trim();
  const s = String(v.sourceImageUrl ?? "").trim();
  if (h.length > 0 || s.length > 0) return true;
  const imgs = v.images;
  if (Array.isArray(imgs) && imgs.length > 0) return true;
  if (imgs && typeof imgs === "object" && !Array.isArray(imgs) && Object.keys(imgs as object).length > 0) return true;
  return false;
}

/**
 * Mark variant ready for Galaxus ProductData / feeds without KickDB: SUPPLIER_GTIN mapping,
 * clears KickDB link, resolves partner upload inbox rows for this variant.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ supplierVariantId: string }> }
) {
  try {
    const session = await getPartnerSession(request);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isNer = session.partnerKey?.toLowerCase() === "ner";
    const { supplierVariantId } = await params;
    const decodedId = decodeURIComponent(supplierVariantId ?? "").trim();
    if (!decodedId || (!isNer && !partnerOwnsSupplierVariant(decodedId, session.partnerKey))) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const prismaAny = prisma as any;
    const variant = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId: decodedId },
    });
    if (!variant) {
      return NextResponse.json({ error: "Variant not found" }, { status: 404 });
    }

    const gtinRaw = String(variant.gtin ?? "").trim();
    if (!validateGtin(gtinRaw)) {
      return NextResponse.json(
        { ok: false, error: "Valid GTIN is required before listing (set it in Product data, then save)." },
        { status: 400 }
      );
    }

    const expectedPk = buildProviderKey(gtinRaw, decodedId);
    const pk = String(variant.providerKey ?? "").trim();
    if (!expectedPk || pk !== expectedPk) {
      return NextResponse.json(
        {
          ok: false,
          error: `providerKey must be ${expectedPk} for this GTIN and variant id (current: ${pk || "empty"}). Save after fixing in Product data.`,
        },
        { status: 400 }
      );
    }

    if (!hasListingImage(variant)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Add at least one image (hosted URL, source URL, or images JSON) before listing — Galaxus ProductData expects product imagery.",
        },
        { status: 400 }
      );
    }

    assertMappingIntegrity({
      supplierVariantId: decodedId,
      gtin: gtinRaw,
      providerKey: pk,
      status: "SUPPLIER_GTIN",
    });

    const now = new Date();
    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: decodedId },
      create: {
        supplierVariantId: decodedId,
        gtin: gtinRaw,
        providerKey: pk,
        status: "SUPPLIER_GTIN",
        kickdbVariantId: null,
      },
      update: {
        gtin: gtinRaw,
        providerKey: pk,
        status: "SUPPLIER_GTIN",
        kickdbVariantId: null,
        updatedAt: now,
      },
    });

    const partnerPk = normalizeProviderKey(session.partnerKey);
    await prismaAny.partnerUploadRow.updateMany({
      where: {
        supplierVariantId: decodedId,
        ...(partnerPk ? { providerKey: partnerPk } : {}),
        status: { in: ["PENDING_ENRICH", "PENDING_GTIN", "AMBIGUOUS_GTIN"] },
      },
      data: {
        status: "RESOLVED",
        gtinResolved: gtinRaw,
        errorsJson: null,
        updatedAt: now,
      },
    });

    const origin = resolveAppOriginForPartnerJobs(new URL(request.url).origin);
    if (origin) {
      await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
    }

    return NextResponse.json({
      ok: true,
      supplierVariantId: decodedId,
      mappingStatus: "SUPPLIER_GTIN",
      message:
        "Variant is marked supplier-GTIN (no KickDB). After the next feed push, Galaxus / export pipelines can pick it up like other supplier-GTIN offers.",
    });
  } catch (error: any) {
    console.error("[PARTNER][LISTING-READY]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "listing-ready failed" },
      { status: 500 }
    );
  }
}
