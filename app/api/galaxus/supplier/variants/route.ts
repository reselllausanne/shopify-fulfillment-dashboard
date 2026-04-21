import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { enrichSupplierVariantsForListing } from "@/galaxus/supplier/supplierVariantListExtras";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Number(searchParams.get("limit") ?? "50"), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const q = (searchParams.get("q") ?? "").trim();

  const where: Record<string, unknown> = {};
  if (q) {
    where.OR = [
      { supplierVariantId: { contains: q, mode: "insensitive" } },
      { providerKey: { contains: q, mode: "insensitive" } },
      { gtin: { contains: q, mode: "insensitive" } },
      { supplierSku: { contains: q, mode: "insensitive" } },
      { supplierProductName: { contains: q, mode: "insensitive" } },
    ];
  }

  const items = await prisma.supplierVariant.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const enriched = await enrichSupplierVariantsForListing(prisma, items);
  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items: enriched, nextOffset });
}

type UpdatePayload = {
  supplierVariantId: string;
  supplierSku?: string | null;
  gtin?: string | null;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  price?: number | null;
  stock?: number | null;
  deliveryType?: string | null;
  leadTimeDays?: number | null;
  weightGrams?: number | null;
  images?: unknown;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  imageSyncError?: string | null;
  imageVersion?: number | null;
  manualPrice?: number | null;
  manualStock?: number | null;
  manualLock?: boolean;
  manualNote?: string | null;
  supplierGender?: string | null;
  supplierColorway?: string | null;
};

function toDecimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseInt(String(value), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFloatOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const parsed = Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { updates?: UpdatePayload[] };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ ok: false, error: "No updates provided" }, { status: 400 });
    }

    const now = new Date();
    const results = await prisma.$transaction(
      async (tx) => {
        const output: Array<Record<string, unknown>> = [];
        for (const entry of updates) {
          const supplierVariantId = String(entry.supplierVariantId ?? "").trim();
          if (!supplierVariantId) {
            output.push({ ok: false, error: "Missing supplierVariantId" });
            continue;
          }
          const target = await tx.supplierVariant.findUnique({ where: { supplierVariantId } });
          if (!target) {
            output.push({ ok: false, error: "Variant not found", supplierVariantId });
            continue;
          }

          const data: Prisma.SupplierVariantUpdateInput = {};
          let touchManualMeta = false;

          if ("supplierSku" in entry) data.supplierSku = entry.supplierSku ?? "";
          if ("gtin" in entry) data.gtin = entry.gtin ?? null;
          if ("supplierBrand" in entry) data.supplierBrand = entry.supplierBrand ?? null;
          if ("supplierProductName" in entry) data.supplierProductName = entry.supplierProductName ?? null;
          if ("sizeRaw" in entry) data.sizeRaw = entry.sizeRaw ?? null;
          if ("sizeNormalized" in entry) data.sizeNormalized = entry.sizeNormalized ?? null;
          if ("price" in entry) {
            const value = toFloatOrNull(entry.price);
            if (value !== null) {
              const dec = toDecimalOrNull(value);
              if (dec !== null) data.price = dec;
            }
          }
          if ("stock" in entry) {
            const value = toIntOrNull(entry.stock);
            if (value !== null) data.stock = value;
          }
          if ("deliveryType" in entry) data.deliveryType = entry.deliveryType ?? null;
          if ("leadTimeDays" in entry) {
            const value = entry.leadTimeDays;
            data.leadTimeDays =
              value === null || value === undefined || !Number.isFinite(Number(value))
                ? null
                : Math.round(Number(value));
          }
          if ("weightGrams" in entry) {
            const value = entry.weightGrams;
            data.weightGrams =
              value === null || value === undefined || !Number.isFinite(Number(value))
                ? null
                : Math.round(Number(value));
          }
          if ("images" in entry) {
            if (entry.images === null) data.images = Prisma.DbNull;
            else if (entry.images !== undefined) data.images = entry.images as any;
          }
          if ("sourceImageUrl" in entry) data.sourceImageUrl = entry.sourceImageUrl ?? null;
          if ("hostedImageUrl" in entry) data.hostedImageUrl = entry.hostedImageUrl ?? null;
          if ("imageSyncStatus" in entry) data.imageSyncStatus = entry.imageSyncStatus ?? null;
          if ("imageSyncError" in entry) data.imageSyncError = entry.imageSyncError ?? null;
          if ("imageVersion" in entry) {
            const value = toIntOrNull(entry.imageVersion);
            if (value !== null) data.imageVersion = value;
          }
          if ("manualPrice" in entry) {
            data.manualPrice = toDecimalOrNull(entry.manualPrice ?? null);
            touchManualMeta = true;
          }
          if ("manualStock" in entry) {
            data.manualStock = entry.manualStock ?? null;
            touchManualMeta = true;
          }
          if ("manualLock" in entry) {
            data.manualLock = Boolean(entry.manualLock);
            touchManualMeta = true;
          }
          if ("manualNote" in entry) {
            data.manualNote = entry.manualNote ?? null;
            touchManualMeta = true;
          }
          if ("supplierGender" in entry) {
            data.supplierGender = entry.supplierGender ? String(entry.supplierGender).trim() : null;
          }
          if ("supplierColorway" in entry) {
            data.supplierColorway = entry.supplierColorway ? String(entry.supplierColorway).trim() : null;
          }
          if (touchManualMeta) {
            data.manualUpdatedAt = now;
          }

          const keysTouched = Object.keys(data).filter((k) => k !== "manualUpdatedAt");
          if (keysTouched.length === 0) {
            output.push({ ok: true, skipped: true, supplierVariantId });
            continue;
          }

          try {
            const updated = await tx.supplierVariant.update({
              where: { supplierVariantId },
              data,
            });
            output.push({ ok: true, item: updated });
          } catch (rowErr: any) {
            output.push({
              ok: false,
              error: rowErr?.message ?? "Update failed",
              code: rowErr?.code ?? null,
              supplierVariantId,
            });
          }
        }
        return output;
      },
      { maxWait: 15000, timeout: 60000 }
    );

    const failed = results.filter((r: any) => r && r.ok === false);
    return NextResponse.json({
      ok: failed.length === 0,
      results,
      ...(failed.length > 0
        ? { error: failed.map((f: any) => `${f.supplierVariantId ?? "?"}: ${f.error}`).join("; ") }
        : {}),
    });
  } catch (error: any) {
    console.error("[GALAXUS][SUPPLIER][VARIANTS] Update failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Update failed" },
      { status: 500 }
    );
  }
}
