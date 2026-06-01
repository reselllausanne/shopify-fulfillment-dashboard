import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import {
  normalizeSize,
  normalizeSku,
  parsePriceSafe,
  validateGtin,
} from "@/app/lib/normalize";
import { buildSupplierVariantId } from "@/app/lib/partnerImport";
import {
  assertMappingIntegrity,
  buildProviderKey,
  normalizeProviderKey,
} from "@/galaxus/supplier/providerKey";
import { partnerOwnsSupplierVariant } from "@/app/lib/partnerCatalogScope";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type CreateBody = {
  mode?: "custom" | "from-db";
  sku?: string;
  size?: string;
  price?: number | string;
  stock?: number | string;
  gtin?: string | null;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  supplierGender?: string | null;
  supplierColorway?: string | null;
  weightGrams?: number | string | null;
  leadTimeDays?: number | string | null;
  hostedImageUrl?: string | null;
  sourceImageUrl?: string | null;
  images?: unknown;
  manualNote?: string | null;
  overwrite?: boolean;
};

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number.parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toDecimal(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "number" ? value : parsePriceSafe(String(value));
  if (parsed == null || !Number.isFinite(parsed) || parsed < 0) return null;
  return new Prisma.Decimal(parsed.toFixed(2));
}

function firstHttpsUrl(...candidates: Array<string | null | undefined>): string | null {
  for (const c of candidates) {
    const t = (c ?? "").toString().trim();
    if (/^https:\/\//i.test(t)) return t;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const partnerKey = normalizeProviderKey(session.partnerKey);
    if (!partnerKey) {
      return NextResponse.json(
        { ok: false, error: "Partner key invalid" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as CreateBody;
    const mode = body.mode === "from-db" ? "from-db" : "custom";

    const sku = normalizeSku(body.sku ?? "");
    const sizeNormalized = normalizeSize(body.size ?? "");
    const sizeRaw = (body.size ?? "").toString().trim();
    if (!sku) {
      return NextResponse.json({ ok: false, error: "SKU is required" }, { status: 400 });
    }
    if (!sizeNormalized) {
      return NextResponse.json({ ok: false, error: "Size is required" }, { status: 400 });
    }

    const priceDecimal = toDecimal(body.price);
    if (!priceDecimal) {
      return NextResponse.json({ ok: false, error: "Valid price required" }, { status: 400 });
    }
    const stock = toIntOrNull(body.stock);
    if (stock === null || stock < 0) {
      return NextResponse.json({ ok: false, error: "Valid stock required" }, { status: 400 });
    }

    const gtinRaw = (body.gtin ?? "").toString().trim();
    const gtin = gtinRaw ? (validateGtin(gtinRaw) ? gtinRaw : null) : null;
    if (gtinRaw && !gtin) {
      return NextResponse.json({ ok: false, error: "Invalid GTIN" }, { status: 400 });
    }

    let supplierVariantId: string;
    try {
      supplierVariantId = buildSupplierVariantId(partnerKey, sku, sizeNormalized);
    } catch {
      return NextResponse.json(
        { ok: false, error: "Invalid SKU / size for variant id" },
        { status: 400 }
      );
    }
    if (!partnerOwnsSupplierVariant(supplierVariantId, session.partnerKey)) {
      return NextResponse.json(
        { ok: false, error: "Variant id would not be owned by this partner" },
        { status: 403 }
      );
    }

    const providerKey = gtin ? buildProviderKey(gtin, supplierVariantId) : null;
    if (gtin && !providerKey) {
      return NextResponse.json({ ok: false, error: "Failed to build providerKey" }, { status: 400 });
    }

    const prismaAny = prisma as any;
    const existing = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId },
      select: { supplierVariantId: true },
    });
    if (existing && !body.overwrite) {
      return NextResponse.json(
        {
          ok: false,
          conflict: true,
          error:
            "A variant already exists for this SKU + size. Re-submit with overwrite=true to replace its data.",
          supplierVariantId,
        },
        { status: 409 }
      );
    }

    // If GTIN provided, also check that no OTHER variant already occupies (providerKey, gtin)
    if (providerKey && gtin) {
      const conflict = await prismaAny.supplierVariant.findUnique({
        where: { providerKey_gtin: { providerKey, gtin } },
        select: { supplierVariantId: true },
      });
      if (conflict && conflict.supplierVariantId !== supplierVariantId) {
        return NextResponse.json(
          {
            ok: false,
            error: `Another variant already uses providerKey ${providerKey} for GTIN ${gtin} (id=${conflict.supplierVariantId}). Use a different GTIN or update that variant.`,
          },
          { status: 409 }
        );
      }
    }

    const supplierBrand = (body.supplierBrand ?? "").toString().trim() || null;
    const supplierProductName = (body.supplierProductName ?? "").toString().trim() || null;
    const supplierGender = (body.supplierGender ?? "").toString().trim() || null;
    const supplierColorway = (body.supplierColorway ?? "").toString().trim() || null;
    const weightGrams = toIntOrNull(body.weightGrams);
    const leadTimeDaysRaw = toIntOrNull(body.leadTimeDays);
    const leadTimeDays =
      leadTimeDaysRaw == null
        ? null
        : Math.min(365, Math.max(0, leadTimeDaysRaw));

    const hostedExplicit = (body.hostedImageUrl ?? "").toString().trim() || null;
    const sourceExplicit = (body.sourceImageUrl ?? "").toString().trim() || null;
    const hostedImageUrl =
      firstHttpsUrl(hostedExplicit) ??
      firstHttpsUrl(sourceExplicit) ??
      null;
    const sourceImageUrl = sourceExplicit || null;
    let imagesJson: unknown = body.images ?? null;
    if (typeof imagesJson === "string") {
      try {
        imagesJson = JSON.parse(imagesJson);
      } catch {
        return NextResponse.json(
          { ok: false, error: "images must be valid JSON" },
          { status: 400 }
        );
      }
    }
    if (
      imagesJson != null &&
      !Array.isArray(imagesJson) &&
      typeof imagesJson !== "object"
    ) {
      return NextResponse.json(
        { ok: false, error: "images must be an array or object" },
        { status: 400 }
      );
    }

    const manualNote = (body.manualNote ?? "").toString().trim() || null;
    const now = new Date();

    if (gtin && providerKey) {
      assertMappingIntegrity({
        supplierVariantId,
        gtin,
        providerKey,
        status: "SUPPLIER_GTIN",
      });
    } else {
      assertMappingIntegrity({
        supplierVariantId,
        gtin: null,
        providerKey: null,
        status: "PENDING_GTIN",
      });
    }

    const result = await prisma.$transaction(async (tx) => {
      const txAny = tx as any;

      const baseData: Record<string, unknown> = {
        supplierSku: sku,
        providerKey: providerKey ?? null,
        gtin: gtin ?? null,
        price: priceDecimal,
        stock,
        sizeRaw,
        sizeNormalized,
        supplierBrand,
        supplierProductName,
        supplierGender,
        supplierColorway,
        weightGrams: weightGrams ?? null,
        leadTimeDays,
        hostedImageUrl,
        sourceImageUrl,
        manualNote,
        lastSyncAt: now,
      };
      if (imagesJson === null) {
        baseData.images = Prisma.DbNull;
      } else if (imagesJson !== undefined) {
        baseData.images = imagesJson as any;
      }

      const variant = await txAny.supplierVariant.upsert({
        where: { supplierVariantId },
        create: { supplierVariantId, ...baseData },
        update: baseData,
      });

      if (gtin && providerKey) {
        await txAny.variantMapping.upsert({
          where: { supplierVariantId },
          create: {
            supplierVariantId,
            gtin,
            providerKey,
            status: "SUPPLIER_GTIN",
            kickdbVariantId: null,
          },
          update: {
            gtin,
            providerKey,
            status: "SUPPLIER_GTIN",
            kickdbVariantId: null,
            updatedAt: now,
          },
        });
      } else {
        // No GTIN: clear/establish PENDING_GTIN mapping; never store providerKey here.
        await txAny.variantMapping.upsert({
          where: { supplierVariantId },
          create: {
            supplierVariantId,
            gtin: null,
            providerKey: null,
            status: "PENDING_GTIN",
            kickdbVariantId: null,
          },
          update: {
            gtin: null,
            providerKey: null,
            status: "PENDING_GTIN",
            kickdbVariantId: null,
            updatedAt: now,
          },
        });
      }

      return variant;
    });

    return NextResponse.json({
      ok: true,
      created: !existing,
      supplierVariantId: result.supplierVariantId,
      mappingStatus: gtin ? "SUPPLIER_GTIN" : "PENDING_GTIN",
      providerKey: providerKey ?? null,
      gtin: gtin ?? null,
      mode,
    });
  } catch (error: any) {
    console.error("[PARTNER][CATALOG][CREATE]", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Create failed" },
      { status: 500 }
    );
  }
}
