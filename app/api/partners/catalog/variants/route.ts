import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type UpdatePayload = {
  supplierVariantId?: string;
  providerKey?: string | null;
  gtin?: string | null;
  supplierSku?: string;
  supplierBrand?: string | null;
  supplierProductName?: string | null;
  sizeRaw?: string | null;
  sizeNormalized?: string | null;
  price?: number | null;
  stock?: number | null;
  weightGrams?: number | null;
  images?: unknown | null;
  sourceImageUrl?: string | null;
  hostedImageUrl?: string | null;
  imageSyncStatus?: string | null;
  imageVersion?: number | null;
  imageLastSyncedAt?: string | null;
  imageSyncError?: string | null;
  deliveryType?: string | null;
  lastSyncAt?: string | null;
};

function ownsVariant(supplierVariantId: string, partnerKey: string) {
  return supplierVariantId.toLowerCase().startsWith(`${partnerKey.toLowerCase()}:`);
}

function parseDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
}

function toDecimalOrNull(value: unknown): Prisma.Decimal | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number.parseFloat(String(value));
  if (!Number.isFinite(parsed)) return null;
  return new Prisma.Decimal(parsed.toFixed(2));
}

export async function GET(req: NextRequest) {
  const session = await getPartnerSession(req);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const q = (searchParams.get("q") ?? "").trim();
  const mineOnly = ["1", "true", "yes"].includes((searchParams.get("mine") ?? "").toLowerCase());
  const prefix = `${session.partnerKey.toLowerCase()}:`;

  const where: Record<string, unknown> = {};
  if (mineOnly) {
    where.supplierVariantId = { startsWith: prefix };
  }
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

  const mapped = items.map((item) => {
    const owned = ownsVariant(item.supplierVariantId, session.partnerKey);
    if (!owned) {
      return {
        owned,
        supplierVariantId: item.supplierVariantId,
        providerKey: item.providerKey ?? null,
        gtin: item.gtin ?? null,
        supplierSku: item.supplierSku ?? null,
        supplierProductName: item.supplierProductName ?? null,
        sizeRaw: item.sizeRaw ?? null,
        price: item.price ?? null,
        updatedAt: item.updatedAt ?? null,
      };
    }
    return {
      owned,
      supplierVariantId: item.supplierVariantId,
      providerKey: item.providerKey ?? null,
      gtin: item.gtin ?? null,
      supplierSku: item.supplierSku ?? null,
      supplierBrand: item.supplierBrand ?? null,
      supplierProductName: item.supplierProductName ?? null,
      sizeRaw: item.sizeRaw ?? null,
      sizeNormalized: item.sizeNormalized ?? null,
      price: item.price ?? null,
      stock: item.stock ?? null,
      updatedAt: item.updatedAt ?? null,
      weightGrams: item.weightGrams ?? null,
      images: item.images ?? null,
      sourceImageUrl: item.sourceImageUrl ?? null,
      hostedImageUrl: item.hostedImageUrl ?? null,
      imageSyncStatus: item.imageSyncStatus ?? null,
      imageVersion: item.imageVersion ?? null,
      imageLastSyncedAt: item.imageLastSyncedAt ?? null,
      imageSyncError: item.imageSyncError ?? null,
      deliveryType: item.deliveryType ?? null,
      lastSyncAt: item.lastSyncAt ?? null,
    };
  });

  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items: mapped, nextOffset });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await req.json().catch(() => ({}))) as { updates?: UpdatePayload[] };
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
          if (!ownsVariant(supplierVariantId, session.partnerKey)) {
            output.push({ ok: false, error: "Forbidden", supplierVariantId });
            continue;
          }
          const target = await tx.supplierVariant.findUnique({ where: { supplierVariantId } });
          if (!target) {
            output.push({ ok: false, error: "Variant not found", supplierVariantId });
            continue;
          }

          const data: Prisma.SupplierVariantUpdateInput = {};
          if ("providerKey" in entry) data.providerKey = entry.providerKey ? String(entry.providerKey) : null;
          if ("gtin" in entry) data.gtin = entry.gtin ? String(entry.gtin) : null;
          if ("supplierSku" in entry && entry.supplierSku) data.supplierSku = String(entry.supplierSku);
          if ("supplierBrand" in entry) data.supplierBrand = entry.supplierBrand ? String(entry.supplierBrand) : null;
          if ("supplierProductName" in entry) {
            data.supplierProductName = entry.supplierProductName ? String(entry.supplierProductName) : null;
          }
          if ("sizeRaw" in entry) data.sizeRaw = entry.sizeRaw ? String(entry.sizeRaw) : null;
          if ("sizeNormalized" in entry) {
            data.sizeNormalized = entry.sizeNormalized ? String(entry.sizeNormalized) : null;
          }
          if ("price" in entry) data.price = toDecimalOrNull(entry.price ?? null) ?? data.price;
          if ("stock" in entry) {
            data.stock =
              entry.stock === null || entry.stock === undefined || !Number.isFinite(Number(entry.stock))
                ? data.stock
                : Math.round(Number(entry.stock));
          }
          if ("weightGrams" in entry) {
            data.weightGrams =
              entry.weightGrams === null || entry.weightGrams === undefined || !Number.isFinite(Number(entry.weightGrams))
                ? null
                : Math.round(Number(entry.weightGrams));
          }
          if ("images" in entry) {
            if (entry.images === null) data.images = Prisma.DbNull;
            else if (entry.images !== undefined) data.images = entry.images as any;
          }
          if ("sourceImageUrl" in entry) {
            data.sourceImageUrl = entry.sourceImageUrl ? String(entry.sourceImageUrl) : null;
          }
          if ("hostedImageUrl" in entry) {
            data.hostedImageUrl = entry.hostedImageUrl ? String(entry.hostedImageUrl) : null;
          }
          if ("imageSyncStatus" in entry) {
            data.imageSyncStatus = entry.imageSyncStatus ? String(entry.imageSyncStatus) : null;
          }
          if ("imageVersion" in entry) {
            data.imageVersion =
              entry.imageVersion === null || entry.imageVersion === undefined || !Number.isFinite(Number(entry.imageVersion))
                ? data.imageVersion
                : Math.max(1, Math.round(Number(entry.imageVersion)));
          }
          if ("imageLastSyncedAt" in entry) {
            data.imageLastSyncedAt = parseDateOrNull(entry.imageLastSyncedAt);
          }
          if ("imageSyncError" in entry) {
            data.imageSyncError = entry.imageSyncError ? String(entry.imageSyncError) : null;
          }
          if ("deliveryType" in entry) {
            data.deliveryType = entry.deliveryType ? String(entry.deliveryType) : null;
          }
          if ("lastSyncAt" in entry) {
            data.lastSyncAt = parseDateOrNull(entry.lastSyncAt);
          }

          const keysTouched = Object.keys(data);
          if (keysTouched.length === 0) {
            output.push({ ok: true, skipped: true, supplierVariantId: target.supplierVariantId });
            continue;
          }

          try {
            const updated = await tx.supplierVariant.update({
              where: { supplierVariantId: target.supplierVariantId },
              data,
            });
            output.push({ ok: true, item: updated });
          } catch (rowErr: any) {
            output.push({
              ok: false,
              error: rowErr?.message ?? "Update failed",
              code: rowErr?.code ?? null,
              supplierVariantId: target.supplierVariantId,
            });
          }
        }
        return output;
      },
      { maxWait: 15000, timeout: 60000 }
    );

    const failed = results.filter((r: any) => r && r.ok === false);
    const succeeded = results.filter((r: any) => r && r.ok === true && r.item);
    if (succeeded.length > 0) {
      const origin = new URL(req.url).origin;
      await requestFeedPush({ origin, scope: "full", triggerSource: "partner-catalog", runNow: true });
    }
    return NextResponse.json({
      ok: failed.length === 0,
      results,
      ...(failed.length > 0
        ? { error: failed.map((f: any) => `${f.supplierVariantId ?? "?"}: ${f.error}`).join("; ") }
        : {}),
    });
  } catch (error: any) {
    console.error("[PARTNER][CATALOG] Update failed", error);
    return NextResponse.json({ ok: false, error: error?.message ?? "Update failed" }, { status: 500 });
  }
}
