import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { normalizeSize, normalizeSku, validateGtin } from "@/app/lib/normalize";
import { GALAXUS_FEED_SUPPLIER_BLOCKLIST } from "@/galaxus/config";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { enrichSupplierVariantsForListing } from "@/galaxus/supplier/supplierVariantListExtras";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";
import {
  partnerCatalogVariantWhere,
  partnerOwnsSupplierVariant,
} from "@/app/lib/partnerCatalogScope";

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
  leadTimeDays?: number | null;
  manualPrice?: number | null;
  manualStock?: number | null;
  manualLock?: boolean;
  manualNote?: string | null;
  supplierGender?: string | null;
  supplierColorway?: string | null;
};

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

  const isNer = session.partnerKey?.toLowerCase() === "ner";
  const { searchParams } = new URL(req.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "200"), 1), 500);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const q = (searchParams.get("q") ?? "").trim();
  const mineOnly =
    !isNer || ["1", "true", "yes"].includes((searchParams.get("mine") ?? "").toLowerCase());

  const mineWhere = mineOnly ? partnerCatalogVariantWhere(session.partnerKey) : null;
  const qWhere: Prisma.SupplierVariantWhereInput | null = q
    ? {
        OR: [
          { supplierVariantId: { contains: q, mode: "insensitive" } },
          { providerKey: { contains: q, mode: "insensitive" } },
          { gtin: { contains: q, mode: "insensitive" } },
          { supplierSku: { contains: q, mode: "insensitive" } },
          { supplierProductName: { contains: q, mode: "insensitive" } },
        ],
      }
    : null;
  const where: Prisma.SupplierVariantWhereInput =
    mineWhere && qWhere ? { AND: [mineWhere, qWhere] } : mineWhere ?? qWhere ?? {};

  const items = await prisma.supplierVariant.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: limit,
    skip: offset,
  });

  const enriched = await enrichSupplierVariantsForListing(prisma, items);

  const mapped = enriched.map((item) => {
    const extras = {
      displayProductName: item.displayProductName,
      partnerKeyResolved: item.partnerKeyResolved,
      partnerDisplayName: item.partnerDisplayName,
      kickdbProductName: item.kickdbProductName,
    };
    const owned = isNer || partnerOwnsSupplierVariant(item.supplierVariantId, session.partnerKey);
    if (!owned) {
      return {
        ...extras,
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
      };
    }
    return {
      ...extras,
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
      leadTimeDays: item.leadTimeDays ?? null,
      supplierGender: item.supplierGender ?? null,
      supplierColorway: item.supplierColorway ?? null,
    };
  });

  const partnerKeyLower = session.partnerKey.toLowerCase();
  const galaxusFeedExcludedForPartner = GALAXUS_FEED_SUPPLIER_BLOCKLIST.split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(partnerKeyLower);

  const gtins = [
    ...new Set(
      mapped
        .map((item) => (item.gtin ? String(item.gtin).trim() : ""))
        .filter((g) => validateGtin(g))
    ),
  ];

  const refByGtin = new Map<string, { min: number; count: number }>();
  if (gtins.length > 0) {
    const idPrefixPattern = `${partnerKeyLower}:%`;
    const idUnderscoreRe = `^${partnerKeyLower}_`;
    const rows = await prisma.$queryRaw<Array<{ gtin: string; min_price: unknown; cnt: bigint }>>(
      Prisma.sql`
        SELECT sv."gtin", MIN(sv."price") AS min_price, COUNT(*)::bigint AS cnt
        FROM "public"."SupplierVariant" sv
        WHERE sv."gtin" IN (${Prisma.join(gtins)})
          AND NOT (sv."supplierVariantId" ILIKE ${idPrefixPattern})
          AND sv."supplierVariantId" !~* ${idUnderscoreRe}
        GROUP BY sv."gtin"
      `
    );
    for (const r of rows) {
      const g = String(r.gtin ?? "").trim();
      const v = Number(r.min_price);
      if (validateGtin(g) && Number.isFinite(v)) {
        refByGtin.set(g, { min: v, count: Number(r.cnt) });
      }
    }
  }

  const mappedWithRef = mapped.map((item) => {
    const g = item.gtin ? String(item.gtin).trim() : "";
    const ref = validateGtin(g) ? refByGtin.get(g) : undefined;
    return {
      ...item,
      referenceMinPriceChf: ref != null ? ref.min : null,
      referenceOfferCount: ref != null ? ref.count : null,
    };
  });

  const nextOffset = items.length === limit ? offset + limit : null;
  return NextResponse.json({
    ok: true,
    items: mappedWithRef,
    nextOffset,
    galaxusFeedExcludedForPartner,
  });
}

export async function POST(req: NextRequest) {
  try {
    const session = await getPartnerSession(req);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const isNer = session.partnerKey?.toLowerCase() === "ner";

    const body = (await req.json().catch(() => ({}))) as { updates?: UpdatePayload[] };
    const updates = Array.isArray(body.updates) ? body.updates : [];
    if (updates.length === 0) {
      return NextResponse.json({ ok: false, error: "No updates provided" }, { status: 400 });
    }

    if (!isNer) {
      const allowedKeys = new Set(["supplierVariantId", "price", "stock"]);
      const invalid = updates.find((entry) =>
        Object.keys(entry).some((key) => !allowedKeys.has(key))
      );
      if (invalid) {
        return NextResponse.json(
          { ok: false, error: "Only price and stock updates are allowed." },
          { status: 403 }
        );
      }
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
          if (!isNer && !partnerOwnsSupplierVariant(supplierVariantId, session.partnerKey)) {
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
          if ("leadTimeDays" in entry) {
            const v = entry.leadTimeDays;
            if (v === null || v === undefined || !Number.isFinite(Number(v))) {
              data.leadTimeDays = null;
            } else {
              const n = Math.round(Number(v));
              if (n < 0 || n > 365) {
                output.push({ ok: false, error: "leadTimeDays must be 0–365 or null", supplierVariantId });
                continue;
              }
              data.leadTimeDays = n;
            }
          }
          if ("manualPrice" in entry) {
            const mp = entry.manualPrice;
            if (mp === null || mp === undefined || !Number.isFinite(Number(mp))) {
              data.manualPrice = null;
            } else {
              data.manualPrice = toDecimalOrNull(mp);
            }
          }
          if ("manualStock" in entry) {
            const ms = entry.manualStock;
            if (ms === null || ms === undefined || !Number.isFinite(Number(ms))) {
              data.manualStock = null;
            } else {
              data.manualStock = Math.round(Number(ms));
            }
          }
          if ("manualLock" in entry) {
            data.manualLock = Boolean(entry.manualLock);
          }
          if ("manualNote" in entry) {
            data.manualNote = entry.manualNote ? String(entry.manualNote) : null;
          }
          if ("supplierGender" in entry) {
            data.supplierGender = entry.supplierGender ? String(entry.supplierGender).trim() : null;
          }
          if ("supplierColorway" in entry) {
            data.supplierColorway = entry.supplierColorway ? String(entry.supplierColorway).trim() : null;
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
            const pkForRow = normalizeProviderKey(session.partnerKey);
            const prevSku = normalizeSku(target.supplierSku ?? "") ?? String(target.supplierSku ?? "").trim();
            const prevSize =
              normalizeSize(target.sizeNormalized ?? target.sizeRaw ?? "") ??
              String(target.sizeNormalized ?? target.sizeRaw ?? "").trim();
            const skuForRow = normalizeSku(updated.supplierSku ?? "") ?? String(updated.supplierSku ?? "").trim();
            const sizeForRow =
              normalizeSize(updated.sizeNormalized ?? updated.sizeRaw ?? "") ??
              String(updated.sizeNormalized ?? updated.sizeRaw ?? "").trim();
            if (pkForRow && prevSku && prevSize && skuForRow && sizeForRow) {
              await (tx as any).partnerUploadRow.updateMany({
                where: {
                  providerKey: pkForRow,
                  status: { in: ["PENDING_GTIN", "AMBIGUOUS_GTIN", "PENDING_ENRICH"] },
                  OR: [
                    { supplierVariantId: updated.supplierVariantId },
                    {
                      AND: [{ sku: prevSku }, { sizeNormalized: prevSize }, { partnerId: session.partnerId }],
                    },
                  ],
                },
                data: {
                  supplierVariantId: updated.supplierVariantId,
                  sku: skuForRow,
                  sizeRaw: updated.sizeRaw ?? "",
                  sizeNormalized: sizeForRow,
                  price: updated.price,
                  rawStock: updated.stock ?? 0,
                  updatedAt: new Date(),
                },
              });
            }
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
      await requestFeedPush({ origin, scope: "full", triggerSource: "partner-admin", runNow: true });
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
