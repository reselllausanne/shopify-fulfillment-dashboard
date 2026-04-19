import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import { getDefaultPricing, resolveGalaxusSellExVatForChannel, resolvePricingOverrides } from "@/galaxus/exports/pricing";
import { PARTNER_KEY_SELECT, partnerKeysLowerSet } from "@/galaxus/exports/partnerPricing";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeKeys(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(/[\n,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parseNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === "object") {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function extractSupplierKey(supplierVariantId?: string | null): string | null {
  if (!supplierVariantId) return null;
  const raw = String(supplierVariantId).trim();
  const rawKey = raw.includes(":")
    ? raw.split(":")[0]
    : raw.includes("_")
      ? raw.split("_")[0]
      : raw;
  return rawKey ? rawKey.toLowerCase() : null;
}

function parseSupplierKeyFilter(input: string): string | null {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return null;
  // Accept formats: "THE_", "the", "the:", "the_" etc.
  const cleaned = trimmed.replace(/[:_]+$/g, "");
  if (!cleaned) return null;
  if (/^[A-Za-z0-9]{2,10}$/.test(cleaned)) return cleaned.toLowerCase();
  return null;
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const q = (searchParams.get("q") ?? "").trim();
  const supplierKeyParam = parseSupplierKeyFilter(searchParams.get("supplierKey") ?? "");
  const providerKeys = normalizeKeys(searchParams.get("providerKeys"));
  const lockedOnly = ["1", "true", "yes"].includes((searchParams.get("lockedOnly") ?? "").toLowerCase());
  const isMerchant = String(GALAXUS_PRICE_MODEL ?? "").toLowerCase() === "merchant";

  const where: Record<string, unknown> = {};
  if (lockedOnly) where.manualLock = true;
  if (supplierKeyParam) {
    where.AND = [
      {
        OR: [
          { supplierVariantId: { startsWith: `${supplierKeyParam}:`, mode: "insensitive" } },
          { supplierVariantId: { startsWith: `${supplierKeyParam}_`, mode: "insensitive" } },
          { providerKey: { startsWith: `${supplierKeyParam.toUpperCase()}_`, mode: "insensitive" } },
        ],
      },
    ];
  }
  if (providerKeys.length > 0) {
    where.providerKey = { in: providerKeys };
  }
  if (q) {
    const qAsSupplierKey = q.endsWith("_") || q.endsWith(":") ? parseSupplierKeyFilter(q) : null;
    if (qAsSupplierKey) {
      const existingAnd = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
      where.AND = [
        ...existingAnd,
        {
          OR: [
            { supplierVariantId: { startsWith: `${qAsSupplierKey}:`, mode: "insensitive" } },
            { supplierVariantId: { startsWith: `${qAsSupplierKey}_`, mode: "insensitive" } },
            { providerKey: { startsWith: `${qAsSupplierKey.toUpperCase()}_`, mode: "insensitive" } },
          ],
        },
      ];
    } else {
      where.OR = [
      { supplierVariantId: { contains: q, mode: "insensitive" } },
      { providerKey: { contains: q, mode: "insensitive" } },
      { gtin: { contains: q, mode: "insensitive" } },
      { supplierSku: { contains: q, mode: "insensitive" } },
      { supplierProductName: { contains: q, mode: "insensitive" } },
      ];
    }
  }

  const items = await prisma.supplierVariant.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });
  const partners = await (prisma as any).partner.findMany({ select: PARTNER_KEY_SELECT });
  const galaxusPartnerKeysLower = partnerKeysLowerSet(partners ?? []);

  const enriched = items.map((item: any) => {
    const buyPrice = parseNumber(item?.price);
    const manualLock = Boolean(item?.manualLock);
    const manualPrice = parseNumber(item?.manualPrice);
    const supplierKey = extractSupplierKey(item?.supplierVariantId ?? null);
    let galaxusPriceExVat: number | null = null;
    let galaxusPriceIncVat: number | null = null;
    if (manualLock && manualPrice && manualPrice > 0) {
      galaxusPriceIncVat = manualPrice;
      const defaults = getDefaultPricing();
      const vatRate = defaults.vatRate;
      galaxusPriceExVat = manualPrice / (1 + vatRate);
    } else if (buyPrice && buyPrice > 0) {
      if (isMerchant) {
        galaxusPriceExVat = buyPrice;
      } else {
        galaxusPriceExVat = resolveGalaxusSellExVatForChannel(buyPrice, supplierKey, galaxusPartnerKeysLower);
      }
    }
    if (galaxusPriceExVat !== null && galaxusPriceIncVat === null) {
      const vatRate = resolvePricingOverrides(null).vatRate;
      galaxusPriceIncVat = galaxusPriceExVat * (1 + vatRate);
    }
    return {
      ...item,
      galaxusPriceExVat,
      galaxusPriceIncVat,
    };
  });

  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({ ok: true, items: enriched, nextOffset });
}

type UpdatePayload = {
  supplierVariantId?: string;
  providerKey?: string;
  gtin?: string;
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
  imageLastSyncedAt?: string | Date | null;
  imageSyncError?: string | null;
  manualPrice?: number | null;
  manualStock?: number | null;
  manualLock?: boolean;
  manualNote?: string | null;
  /** Calendar days — used in Stock feed RestockTime/RestockDate when no STX order ETA exists */
  leadTimeDays?: number | null;
  deliveryType?: string | null;
  lastSyncAt?: string | Date | null;
  clearManual?: boolean;
};

function toDecimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(2));
}

function parseDateOrNull(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  const parsed = new Date(String(value));
  return Number.isNaN(parsed.valueOf()) ? null : parsed;
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
          const providerKey = String(entry.providerKey ?? "").trim();
          const gtin = String(entry.gtin ?? "").trim();
          const target = supplierVariantId
            ? await tx.supplierVariant.findUnique({ where: { supplierVariantId } })
            : providerKey && gtin
              ? await tx.supplierVariant.findUnique({
                  where: { providerKey_gtin: { providerKey, gtin } },
                })
              : null;

          if (!target) {
            output.push({
              ok: false,
              error: "Variant not found",
              supplierVariantId: supplierVariantId || null,
              providerKey: providerKey || null,
              gtin: gtin || null,
            });
            continue;
          }

          const data: Prisma.SupplierVariantUpdateInput = {};
          let touchManualMeta = false;
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
          if ("leadTimeDays" in entry) {
            const v = entry.leadTimeDays;
            data.leadTimeDays =
              v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Math.round(Number(v));
          }
          if ("providerKey" in entry) {
            data.providerKey = entry.providerKey ? String(entry.providerKey) : null;
          }
          if ("gtin" in entry) {
            data.gtin = entry.gtin ? String(entry.gtin) : null;
          }
          if ("supplierSku" in entry && entry.supplierSku) {
            data.supplierSku = String(entry.supplierSku);
          }
          if ("supplierBrand" in entry) {
            data.supplierBrand = entry.supplierBrand ? String(entry.supplierBrand) : null;
          }
          if ("supplierProductName" in entry) {
            data.supplierProductName = entry.supplierProductName ? String(entry.supplierProductName) : null;
          }
          if ("sizeRaw" in entry) {
            data.sizeRaw = entry.sizeRaw ? String(entry.sizeRaw) : null;
          }
          if ("sizeNormalized" in entry) {
            data.sizeNormalized = entry.sizeNormalized ? String(entry.sizeNormalized) : null;
          }
          if ("price" in entry) {
            const nextPrice = entry.price ?? null;
            data.price = toDecimalOrNull(
              typeof nextPrice === "number" ? nextPrice : Number.parseFloat(String(nextPrice))
            ) ?? data.price;
          }
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
          if (entry.clearManual) {
            data.manualPrice = null;
            data.manualStock = null;
            data.manualLock = false;
            data.manualNote = null;
            touchManualMeta = true;
          }
          const keysTouched = Object.keys(data).filter((k) => k !== "manualUpdatedAt");
          if (keysTouched.length === 0) {
            output.push({
              ok: true,
              skipped: true,
              supplierVariantId: target.supplierVariantId,
            });
            continue;
          }
          if (touchManualMeta) {
            data.manualUpdatedAt = now;
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
    const ok = failed.length === 0;
    const succeeded = results.filter((r: any) => r && r.ok === true && r.item);
    if (succeeded.length > 0) {
      const origin = new URL(request.url).origin;
      await requestFeedPush({ origin, scope: "full", triggerSource: "manual-pricing", runNow: true });
    }
    return NextResponse.json({
      ok,
      results,
      ...(failed.length > 0
        ? {
            error: failed.map((f: any) => `${f.supplierVariantId ?? "?"}: ${f.error}`).join("; "),
          }
        : {}),
    });
  } catch (error: any) {
    console.error("[GALAXUS][PRICING] Update failed", error);
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Update failed" },
      { status: 500 }
    );
  }
}
