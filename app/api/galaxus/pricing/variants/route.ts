import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { GALAXUS_PRICE_MODEL } from "@/galaxus/edi/config";
import {
  computeGalaxusSellPriceExVat,
  resolvePricingOverrides,
  type PricingOverrides,
} from "@/galaxus/exports/pricing";
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

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? "50"), 1), 200);
  const offset = Math.max(Number(searchParams.get("offset") ?? "0"), 0);
  const q = (searchParams.get("q") ?? "").trim();
  const providerKeys = normalizeKeys(searchParams.get("providerKeys"));
  const lockedOnly = ["1", "true", "yes"].includes((searchParams.get("lockedOnly") ?? "").toLowerCase());
  const isMerchant = String(GALAXUS_PRICE_MODEL ?? "").toLowerCase() === "merchant";

  const where: Record<string, unknown> = {};
  if (lockedOnly) where.manualLock = true;
  if (providerKeys.length > 0) {
    where.providerKey = { in: providerKeys };
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
  const partners = await (prisma as any).partner.findMany({
    select: {
      key: true,
      targetMargin: true,
      shippingPerPair: true,
      bufferPerPair: true,
      roundTo: true,
      vatRate: true,
    },
  });
  const partnerByKey = new Map<string, any>(
    (partners ?? []).map((row: any) => [String(row.key ?? "").toLowerCase(), row])
  );
  const resolveOverrides = (supplierKey: string | null): PricingOverrides | null => {
    if (!supplierKey) return null;
    const partner = partnerByKey.get(supplierKey.toLowerCase());
    if (!partner) return null;
    return {
      targetMargin: parseNumber(partner.targetMargin),
      shippingPerPair: parseNumber(partner.shippingPerPair),
      bufferPerPair: parseNumber(partner.bufferPerPair),
      roundTo: parseNumber(partner.roundTo),
      vatRate: parseNumber(partner.vatRate),
    };
  };

  const enriched = items.map((item: any) => {
    const buyPrice = parseNumber(item?.price);
    const manualLock = Boolean(item?.manualLock);
    const manualPrice = parseNumber(item?.manualPrice);
    const supplierKey = extractSupplierKey(item?.supplierVariantId ?? null);
    let galaxusPriceExVat: number | null = null;
    let galaxusPriceIncVat: number | null = null;
    if (manualLock && manualPrice && manualPrice > 0) {
      galaxusPriceIncVat = manualPrice;
      const overrides = resolvePricingOverrides(resolveOverrides(supplierKey));
      const vatRate = parseNumber(overrides.vatRate) ?? 0;
      galaxusPriceExVat = manualPrice / (1 + vatRate);
    } else if (buyPrice && buyPrice > 0) {
      if (isMerchant) {
        galaxusPriceExVat = buyPrice;
      } else {
        const overrides = resolvePricingOverrides(resolveOverrides(supplierKey));
        galaxusPriceExVat = computeGalaxusSellPriceExVat({
          buyPriceExVatCHF: buyPrice,
          shippingPerPairCHF: overrides.shippingPerPair,
          targetNetMargin: overrides.targetMargin,
          bufferPerPairCHF: overrides.bufferPerPair,
          roundTo: overrides.roundTo,
          vatRate: overrides.vatRate,
        }).sellPriceExVatCHF;
      }
    }
    if (galaxusPriceExVat !== null && galaxusPriceIncVat === null) {
      const overrides = resolvePricingOverrides(resolveOverrides(supplierKey));
      const vatRate = parseNumber(overrides.vatRate) ?? 0;
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
  manualPrice?: number | null;
  manualStock?: number | null;
  manualLock?: boolean;
  manualNote?: string | null;
  /** Calendar days — used in Stock feed RestockTime/RestockDate when no STX order ETA exists */
  leadTimeDays?: number | null;
  clearManual?: boolean;
};

function toDecimalOrNull(value: number | null | undefined): Prisma.Decimal | null {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value)) return null;
  return new Prisma.Decimal(value.toFixed(2));
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
