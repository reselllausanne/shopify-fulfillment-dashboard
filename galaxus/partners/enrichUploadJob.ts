import { prisma } from "@/app/lib/prisma";
import { buildSupplierVariantId } from "@/app/lib/partnerImport";
import { validateGtin } from "@/app/lib/normalize";
import { runKickdbEnrich } from "@/galaxus/kickdb/enrichJob";
import { requestFeedPush } from "@/galaxus/ops/feedPipeline";
import { assertMappingIntegrity, buildProviderKey, normalizeProviderKey } from "@/galaxus/supplier/providerKey";

type PartnerEnrichOptions = {
  partnerKey: string;
  limit?: number;
  force?: boolean;
  debug?: boolean;
  origin?: string | null;
};

export async function runPartnerUploadEnrich(options: PartnerEnrichOptions) {
  const prismaAny = prisma as any;
  const debug = Boolean(options.debug);
  const force = Boolean(options.force);
  const limit = Math.min(Number(options.limit ?? 500), 2000);
  const partnerKey = normalizeProviderKey(options.partnerKey);
  if (!partnerKey) {
    throw new Error("Partner key missing");
  }

  const statusFilter = force
    ? { in: ["PENDING_ENRICH", "PENDING_GTIN", "AMBIGUOUS_GTIN"] as const }
    : "PENDING_ENRICH";

  const pendingRows = await prismaAny.partnerUploadRow.findMany({
    where: {
      providerKey: partnerKey,
      status: statusFilter,
    },
    orderBy: { updatedAt: "desc" },
    take: limit,
  });

  if (!pendingRows.length) {
    return { processed: 0, resolved: 0, candidates: 0, results: [] as Array<Record<string, unknown>> };
  }

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let resolvedCount = 0;
  const now = new Date();

  for (const row of pendingRows) {
    const providerKeyValue = normalizeProviderKey(row.providerKey) ?? partnerKey;
    const sku = String(row.sku ?? "").trim();
    const sizeNormalized = String(row.sizeNormalized ?? row.sizeRaw ?? "").trim();
    if (!sku || !sizeNormalized) {
      await prismaAny.partnerUploadRow.update({
        where: { id: row.id },
        data: {
          status: "PENDING_GTIN",
          errorsJson: [{ message: "Invalid SKU or size" }],
          updatedAt: now,
        },
      });
      continue;
    }
    const supplierVariantId =
      String(row.supplierVariantId ?? "").trim() ||
      buildSupplierVariantId(providerKeyValue, sku, sizeNormalized);

    let resolvedGtin: string | null = null;
    let gtinCandidates: string[] = [];
    let isAmbiguous = false;

    const existingVariant = await prismaAny.supplierVariant.findUnique({
      where: { supplierVariantId },
      select: { gtin: true, providerKey: true },
    });
    if (existingVariant?.gtin && validateGtin(existingVariant.gtin) && !force) {
      resolvedGtin = existingVariant.gtin;
    } else {
      try {
        const enrich = await runKickdbEnrich({ supplierVariantId, force });
        const match = enrich?.results?.find((result: any) => result.supplierVariantId === supplierVariantId);
        const mapping = await prismaAny.variantMapping.findUnique({
          where: { supplierVariantId },
          select: { gtin: true },
        });
        gtinCandidates = match?.gtinCandidates ?? [];
        isAmbiguous = match?.status === "AMBIGUOUS_GTIN" || gtinCandidates.length > 1;
        resolvedGtin = match?.gtin ?? mapping?.gtin ?? null;
      } catch (err: any) {
        const message = err?.message ?? "Enrichment failed";
        await prismaAny.partnerUploadRow.update({
          where: { id: row.id },
          data: {
            status: "PENDING_GTIN",
            errorsJson: [{ message }],
            updatedAt: now,
          },
        });
        if (debug) {
          results.push({ rowId: row.id, status: "ERROR", error: message });
        }
        continue;
      }
    }

    if (isAmbiguous) {
      await prismaAny.partnerUploadRow.update({
        where: { id: row.id },
        data: {
          status: "AMBIGUOUS_GTIN",
          gtinResolved: null,
          gtinCandidatesJson: gtinCandidates,
          updatedAt: now,
        },
      });
      if (debug) {
        results.push({
          rowId: row.id,
          supplierVariantId,
          status: "AMBIGUOUS_GTIN",
          gtinCandidates,
        });
      }
      processed += 1;
      continue;
    }

    if (!resolvedGtin || !validateGtin(resolvedGtin)) {
      await prismaAny.partnerUploadRow.update({
        where: { id: row.id },
        data: {
          status: "PENDING_GTIN",
          gtinResolved: null,
          errorsJson: [{ message: "GTIN not resolved" }],
          updatedAt: now,
        },
      });
      if (debug) {
        results.push({ rowId: row.id, supplierVariantId, status: "PENDING_GTIN" });
      }
      processed += 1;
      continue;
    }

    const fullProviderKey = buildProviderKey(resolvedGtin, supplierVariantId);
    if (!fullProviderKey) {
      await prismaAny.partnerUploadRow.update({
        where: { id: row.id },
        data: {
          status: "PENDING_GTIN",
          gtinResolved: null,
          errorsJson: [{ message: "Invalid GTIN" }],
          updatedAt: now,
        },
      });
      if (debug) {
        results.push({ rowId: row.id, supplierVariantId, status: "ERROR", error: "Invalid GTIN" });
      }
      processed += 1;
      continue;
    }

    assertMappingIntegrity({
      supplierVariantId,
      gtin: resolvedGtin,
      providerKey: fullProviderKey,
      status: "MATCHED",
    });

    let offer = await prismaAny.supplierVariant.findUnique({
      where: { providerKey_gtin: { providerKey: fullProviderKey, gtin: resolvedGtin } },
    });

    if (offer) {
      offer = await prismaAny.supplierVariant.update({
        where: { supplierVariantId: offer.supplierVariantId },
        data: {
          supplierSku: sku,
          providerKey: fullProviderKey,
          gtin: resolvedGtin,
          sizeRaw: row.sizeRaw,
          sizeNormalized: row.sizeNormalized,
          stock: row.rawStock,
          price: row.price,
          lastSyncAt: now,
        },
      });
    } else {
      offer = await prismaAny.supplierVariant.upsert({
        where: { supplierVariantId },
        create: {
          supplierVariantId,
          supplierSku: sku,
          providerKey: fullProviderKey,
          gtin: resolvedGtin,
          sizeRaw: row.sizeRaw,
          sizeNormalized: row.sizeNormalized,
          stock: row.rawStock,
          price: row.price,
          lastSyncAt: now,
        },
        update: {
          supplierSku: sku,
          providerKey: fullProviderKey,
          gtin: resolvedGtin,
          sizeRaw: row.sizeRaw,
          sizeNormalized: row.sizeNormalized,
          stock: row.rawStock,
          price: row.price,
          lastSyncAt: now,
        },
      });
    }

    if (offer.supplierVariantId !== supplierVariantId) {
      const existingMapping = await prismaAny.variantMapping.findUnique({
        where: { supplierVariantId: offer.supplierVariantId },
        select: { supplierVariantId: true },
      });
      if (existingMapping) {
        await prismaAny.variantMapping.deleteMany({
          where: { supplierVariantId },
        });
      } else {
        await prismaAny.variantMapping.updateMany({
          where: { supplierVariantId },
          data: { supplierVariantId: offer.supplierVariantId },
        });
      }
      await prismaAny.supplierVariant.deleteMany({
        where: { supplierVariantId },
      });
    }

    await prismaAny.variantMapping.upsert({
      where: { supplierVariantId: offer.supplierVariantId },
      create: {
        supplierVariantId: offer.supplierVariantId,
        gtin: resolvedGtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      },
      update: {
        gtin: resolvedGtin,
        providerKey: fullProviderKey,
        status: "MATCHED",
      },
    });

    await prismaAny.partnerUploadRow.update({
      where: { id: row.id },
      data: {
        status: "RESOLVED",
        gtinResolved: resolvedGtin,
        updatedAt: now,
      },
    });

    resolvedCount += 1;
    processed += 1;

    if (debug) {
      results.push({ rowId: row.id, supplierVariantId, status: "RESOLVED", gtin: resolvedGtin });
    }
  }

  if (resolvedCount > 0 && options.origin) {
    await requestFeedPush({ origin: options.origin, scope: "full", triggerSource: "partner-admin", runNow: true });
  }

  return {
    processed,
    resolved: resolvedCount,
    candidates: pendingRows.length,
    results: debug ? results : [],
  };
}
