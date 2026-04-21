import { prisma } from "@/app/lib/prisma";
import { validateGtin } from "@/app/lib/normalize";
import { buildProviderKey, isValidProviderKeyWithGtin } from "@/galaxus/supplier/providerKey";
import { isAllowedDecathlonBrand } from "./brands";
import type {
  DecathlonExclusion,
  DecathlonExclusionReason,
  DecathlonExclusionSummary,
  DecathlonExportCandidate,
} from "./types";

const ELIGIBLE_MAPPING_STATUSES = ["MATCHED", "SUPPLIER_GTIN", "PARTNER_GTIN"] as const;
const EXCLUSION_SAMPLE_LIMIT = 25;

const EXCLUSION_REASONS: DecathlonExclusionReason[] = [
  "MISSING_PROVIDER_KEY",
  "INVALID_PROVIDER_KEY",
  "MISSING_GTIN",
  "INVALID_GTIN",
  "AMBIGUOUS_MAPPING",
  "BRAND_NOT_ALLOWED",
  "MISSING_PRODUCT_FIELDS",
  "MISSING_OFFER_FIELDS",
  "MISSING_PRICE",
  "MISSING_STOCK",
  "MISSING_REQUIRED_ATTRIBUTE",
  "PRODUCT_ALREADY_LIVE",
  "PRODUCT_NOT_LIVE",
];

export function createDecathlonExclusionSummary(): DecathlonExclusionSummary {
  const totals = {} as Record<DecathlonExclusionReason, number>;
  const samples = {} as Record<DecathlonExclusionReason, DecathlonExclusion[]>;
  for (const reason of EXCLUSION_REASONS) {
    totals[reason] = 0;
    samples[reason] = [];
  }
  return { totals, samples };
}

export function recordDecathlonExclusion(
  summary: DecathlonExclusionSummary,
  exclusion: DecathlonExclusion
) {
  summary.totals[exclusion.reason] = (summary.totals[exclusion.reason] ?? 0) + 1;
  const bucket = summary.samples[exclusion.reason] ?? [];
  if (bucket.length < EXCLUSION_SAMPLE_LIMIT) {
    bucket.push(exclusion);
    summary.samples[exclusion.reason] = bucket;
  }
}

export function parseDecimal(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === "object" && "toString" in value) {
    const parsed = Number.parseFloat(String(value));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

export async function loadDecathlonCandidates(summary: DecathlonExclusionSummary) {
  const prismaAny = prisma as any;
  const candidates: DecathlonExportCandidate[] = [];
  let scanned = 0;
  const pageSize = 500;
  let cursorUpdatedAt: Date | null = null;
  let cursorId: string | null = null;
  let lastBatch = 0;

  do {
    const whereClause: Record<string, unknown> = {
      status: { in: ELIGIBLE_MAPPING_STATUSES as unknown as string[] },
      gtin: { not: null },
      ...(cursorUpdatedAt && cursorId
        ? {
            OR: [
              { updatedAt: { lt: cursorUpdatedAt } },
              { updatedAt: cursorUpdatedAt, id: { lt: cursorId } },
            ],
          }
        : {}),
    };
    const mappings: any[] = await prismaAny.variantMapping.findMany({
      where: whereClause,
      select: {
        id: true,
        gtin: true,
        providerKey: true,
        status: true,
        updatedAt: true,
        supplierVariantId: true,
        supplierVariant: {
          select: {
            supplierVariantId: true,
            supplierSku: true,
            providerKey: true,
            gtin: true,
            price: true,
            manualPrice: true,
            manualStock: true,
            manualLock: true,
            stock: true,
            sizeRaw: true,
            sizeNormalized: true,
            supplierBrand: true,
            supplierProductName: true,
            supplierGender: true,
            supplierColorway: true,
            weightGrams: true,
            hostedImageUrl: true,
            sourceImageUrl: true,
            images: true,
            leadTimeDays: true,
            deliveryType: true,
          },
        },
        kickdbVariant: {
          select: {
            sizeUs: true,
            sizeEu: true,
            gtin: true,
            ean: true,
            providerKey: true,
            product: {
              select: {
                name: true,
                brand: true,
                imageUrl: true,
                description: true,
                gender: true,
                colorway: true,
                countryOfManufacture: true,
                releaseDate: true,
                retailPrice: true,
                styleId: true,
                traitsJson: true,
              },
            },
          },
        },
      },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: pageSize,
    });

    lastBatch = mappings.length;
    if (mappings.length > 0) {
      const last = mappings[mappings.length - 1];
      cursorUpdatedAt = last.updatedAt ?? null;
      cursorId = last.id ?? null;
    }

    for (const mapping of mappings) {
      scanned += 1;
      const variant = mapping?.supplierVariant ?? null;
      const supplierVariantId =
        mapping?.supplierVariantId ?? variant?.supplierVariantId ?? null;
      if (!variant) {
        recordDecathlonExclusion(summary, {
          reason: "MISSING_PRODUCT_FIELDS",
          message: "Missing supplier variant",
          supplierVariantId,
        });
        continue;
      }

      const gtin = String(mapping?.gtin ?? variant?.gtin ?? "").trim();
      if (!gtin) {
        recordDecathlonExclusion(summary, {
          reason: "MISSING_GTIN",
          message: "Missing GTIN",
          supplierVariantId,
        });
        continue;
      }
      if (!validateGtin(gtin)) {
        recordDecathlonExclusion(summary, {
          reason: "INVALID_GTIN",
          message: "Invalid GTIN",
          supplierVariantId,
          gtin,
        });
        continue;
      }

      const providerKeyRaw = mapping?.providerKey ?? variant?.providerKey ?? null;
      const providerKey = providerKeyRaw ? String(providerKeyRaw).trim() : "";
      if (!providerKey) {
        recordDecathlonExclusion(summary, {
          reason: "MISSING_PROVIDER_KEY",
          message: "Missing providerKey",
          supplierVariantId,
          gtin,
        });
        continue;
      }
      if (!isValidProviderKeyWithGtin(providerKey)) {
        recordDecathlonExclusion(summary, {
          reason: "INVALID_PROVIDER_KEY",
          message: "ProviderKey format invalid",
          supplierVariantId,
          providerKey,
          gtin,
        });
        continue;
      }
      const expectedProviderKey = buildProviderKey(gtin, supplierVariantId);
      if (expectedProviderKey && expectedProviderKey !== providerKey) {
        recordDecathlonExclusion(summary, {
          reason: "INVALID_PROVIDER_KEY",
          message: `ProviderKey mismatch: expected ${expectedProviderKey}`,
          supplierVariantId,
          providerKey,
          gtin,
        });
        continue;
      }

      const brand = String(variant?.supplierBrand ?? mapping?.kickdbVariant?.product?.brand ?? "").trim();
      if (!isAllowedDecathlonBrand(brand)) {
        recordDecathlonExclusion(summary, {
          reason: "BRAND_NOT_ALLOWED",
          message: `Brand not allowed: ${brand || "unknown"}`,
          supplierVariantId,
          providerKey,
          gtin,
        });
        continue;
      }

      candidates.push({
        providerKey,
        gtin,
        mapping,
        variant,
        kickdbVariant: mapping?.kickdbVariant ?? null,
        product: mapping?.kickdbVariant?.product ?? null,
      });
    }
  } while (lastBatch === pageSize);

  const byProviderKey = new Map<string, DecathlonExportCandidate[]>();
  for (const candidate of candidates) {
    const bucket = byProviderKey.get(candidate.providerKey) ?? [];
    bucket.push(candidate);
    byProviderKey.set(candidate.providerKey, bucket);
  }

  const ambiguousKeys = new Set(
    Array.from(byProviderKey.entries())
      .filter(([, bucket]) => bucket.length > 1)
      .map(([key]) => key)
  );
  if (ambiguousKeys.size > 0) {
    for (const candidate of candidates) {
      if (!ambiguousKeys.has(candidate.providerKey)) continue;
      recordDecathlonExclusion(summary, {
        reason: "AMBIGUOUS_MAPPING",
        message: "Multiple variants share providerKey",
        providerKey: candidate.providerKey,
        supplierVariantId: candidate?.variant?.supplierVariantId ?? null,
        gtin: candidate.gtin,
      });
    }
  }

  const afterAmbiguous = candidates.filter((candidate) => !ambiguousKeys.has(candidate.providerKey));

  const byGtin = new Map<string, DecathlonExportCandidate[]>();
  for (const candidate of afterAmbiguous) {
    const bucket = byGtin.get(candidate.gtin) ?? [];
    bucket.push(candidate);
    byGtin.set(candidate.gtin, bucket);
  }
  const filtered: DecathlonExportCandidate[] = [];
  for (const [gtin, bucket] of byGtin) {
    if (bucket.length === 1) {
      filtered.push(bucket[0]);
      continue;
    }
    bucket.sort((a, b) => {
      const pa = Number(a.variant?.price ?? Infinity);
      const pb = Number(b.variant?.price ?? Infinity);
      if (pa !== pb) return pa - pb;
      const sa = Number(a.variant?.stock ?? 0);
      const sb = Number(b.variant?.stock ?? 0);
      return sb - sa;
    });
    filtered.push(bucket[0]);
    for (let i = 1; i < bucket.length; i++) {
      recordDecathlonExclusion(summary, {
        reason: "DUPLICATE_GTIN" as DecathlonExclusionReason,
        message: `Duplicate GTIN ${gtin}: kept ${bucket[0].providerKey} (cheaper)`,
        providerKey: bucket[i].providerKey,
        supplierVariantId: bucket[i]?.variant?.supplierVariantId ?? null,
        gtin,
      });
    }
  }

  return { candidates: filtered, scanned };
}
