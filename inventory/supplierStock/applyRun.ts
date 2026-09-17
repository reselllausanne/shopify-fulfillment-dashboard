import { prisma } from "@/app/lib/prisma";
import { scraperQuery } from "@/app/lib/scraperDb";
import { allSupplierSeeds, buildSupplierSeed, seedScrapeIntervalHours } from "./defaults";
import { shouldPauseAfterInvalidRun } from "./invalidRunPolicy";
import { createSupplierStockNotifier } from "./notify";
import { enrichObservation, reconcileObservation, zeroMissingFromCompleteSnapshot } from "./reconcile";
import { evaluateScrapeRunValidity } from "./runValidity";
import type {
  AvailabilityStatus,
  ScrapeRunMetrics,
  SupplierStockPolicyStatus,
  VariantObservation,
} from "./types";

type ScrapeRunRow = {
  id: string;
  shop_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  products_listed: number;
  variants_upserted: number;
  with_gtin: number;
  errors: number;
  message: string | null;
};

type DbVariantRow = {
  supplierVariantId: string;
  supplierSku: string;
  gtin: string | null;
  price: unknown;
  stock: number;
  supplierProductName: string | null;
  supplierProductType: string | null;
  leadTimeDays: number | null;
  manualNote: string | null;
  updatedAt: Date;
};

export type FinalizeRunInput = {
  supplierKey: string;
  scrapeRunId: number;
  dryRun?: boolean;
  priorActiveCatalog?: number;
};

export type FinalizeRunResult = {
  ok: boolean;
  dryRun: boolean;
  supplierKey: string;
  scrapeRunId: number;
  valid: boolean;
  invalidReason?: string;
  completeSnapshot: boolean;
  variantsProcessed: number;
  qtyZeroed: number;
  reviewItemsCreated: number;
  policyStatus: SupplierStockPolicyStatus;
  paused: boolean;
};

function prismaAny() {
  return prisma as any;
}

function parseProductUrl(manualNote: string | null): string | null {
  if (!manualNote) return null;
  try {
    const parsed = JSON.parse(manualNote) as { productUrl?: string; url?: string };
    return parsed.productUrl ?? parsed.url ?? null;
  } catch {
    const m = manualNote.match(/https?:\/\/[^\s"']+/);
    return m?.[0] ?? null;
  }
}

function variantToObservation(
  row: DbVariantRow,
  supplierKey: string,
  scrapeRunId: number
): VariantObservation {
  const stock = Math.max(0, Math.floor(Number(row.stock) || 0));
  let availabilityStatus: AvailabilityStatus = stock > 0 ? "confirmed_in_stock" : "confirmed_out_of_stock";

  return {
    supplierKey,
    supplierVariantId: row.supplierVariantId,
    gtin: row.gtin,
    supplierSku: row.supplierSku,
    productName: row.supplierProductName,
    productUrl: parseProductUrl(row.manualNote),
    sourcePrice: row.price != null ? Number(row.price) : null,
    currency: "CHF",
    sourceLeadTimeDays: row.leadTimeDays,
    supplierStockQty: stock,
    availabilityStatus,
    quantitySource: "supplier_variant_stock",
    sourceScrapeRunId: scrapeRunId,
    observedAt: row.updatedAt,
    rawParseJson: row.manualNote ? { manualNote: row.manualNote } : null,
  };
}

export async function ensureSupplierStockPolicies(supplierKeys?: string[]): Promise<number> {
  const seeds = supplierKeys?.length
    ? supplierKeys.map((k) => buildSupplierSeed(k))
    : allSupplierSeeds();
  let upserted = 0;

  for (const seed of seeds) {
    await prismaAny().supplierStockPolicy.upsert({
      where: { supplierKey: seed.supplierKey },
      create: {
        supplierKey: seed.supplierKey,
        supplierCode: seed.supplierCode,
        displayName: seed.displayName,
        status: seed.status,
        scrapeIntervalHours: seedScrapeIntervalHours(seed),
        heavySource: seed.heavySource ?? false,
      },
      update: {
        displayName: seed.displayName,
        scrapeIntervalHours: seedScrapeIntervalHours(seed),
        heavySource: seed.heavySource ?? false,
      },
    });
    upserted++;
  }

  return upserted;
}

export async function getSupplierStockPolicy(supplierKey: string) {
  return prismaAny().supplierStockPolicy.findUnique({
    where: { supplierKey: String(supplierKey).trim().toLowerCase() },
  });
}

export async function loadPolicyStatusMap(
  supplierKeys?: string[]
): Promise<Map<string, SupplierStockPolicyStatus>> {
  const map = new Map<string, SupplierStockPolicyStatus>();
  try {
    const rows = await prismaAny().supplierStockPolicy.findMany({
      where: supplierKeys?.length ? { supplierKey: { in: supplierKeys } } : undefined,
      select: { supplierKey: true, status: true },
    });
    for (const row of rows ?? []) {
      map.set(String(row.supplierKey).toLowerCase(), row.status as SupplierStockPolicyStatus);
    }
  } catch {
    /* tables may not exist yet */
  }
  return map;
}

export async function loadEvidencePublishedQtyMap(
  supplierVariantIds: string[]
): Promise<Map<string, { publishedQty: number; lastProofAt: Date | null }>> {
  const map = new Map<string, { publishedQty: number; lastProofAt: Date | null }>();
  const ids = Array.from(new Set(supplierVariantIds.map((id) => String(id).trim()).filter(Boolean)));
  if (ids.length === 0) return map;

  try {
    const rows = await prismaAny().supplierVariantEvidence.findMany({
      where: { supplierVariantId: { in: ids } },
      select: { supplierVariantId: true, publishedQty: true, lastProofAt: true },
    });
    for (const row of rows ?? []) {
      map.set(row.supplierVariantId, {
        publishedQty: Math.max(0, Number(row.publishedQty) || 0),
        lastProofAt: row.lastProofAt ?? null,
      });
    }
  } catch {
    /* best-effort */
  }
  return map;
}

async function countActiveCatalog(supplierKey: string): Promise<number> {
  return prismaAny().supplierVariant.count({
    where: {
      supplierVariantId: { startsWith: `${supplierKey}_` },
      stock: { gt: 0 },
    },
  });
}

async function loadScrapeRun(scrapeRunId: number): Promise<ScrapeRunRow | null> {
  const rows = await scraperQuery<ScrapeRunRow>(
    `SELECT id, shop_id, started_at, finished_at, status,
            products_listed, variants_upserted, with_gtin, errors, message
     FROM scraper.scrape_runs WHERE id = $1 LIMIT 1`,
    [scrapeRunId]
  );
  return rows[0] ?? null;
}

export async function finalizeSupplierStockRun(input: FinalizeRunInput): Promise<FinalizeRunResult> {
  const supplierKey = String(input.supplierKey).trim().toLowerCase();
  const dryRun = Boolean(input.dryRun);
  const p = prismaAny();

  await ensureSupplierStockPolicies([supplierKey]);
  const policy = await getSupplierStockPolicy(supplierKey);
  const policyStatus = (policy?.status ?? "review_required") as SupplierStockPolicyStatus;

  const run = await loadScrapeRun(input.scrapeRunId);
  if (!run) {
    return {
      ok: false,
      dryRun,
      supplierKey,
      scrapeRunId: input.scrapeRunId,
      valid: false,
      invalidReason: "scrape_run_not_found",
      completeSnapshot: false,
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus,
      paused: false,
    };
  }

  const priorActive = input.priorActiveCatalog ?? (await countActiveCatalog(supplierKey));
  const metrics: ScrapeRunMetrics = {
    supplierKey,
    scrapeRunId: input.scrapeRunId,
    status: run.status,
    message: run.message,
    productsListed: Number(run.products_listed) || 0,
    variantsUpserted: Number(run.variants_upserted) || 0,
    withGtin: Number(run.with_gtin) || 0,
    errors: Number(run.errors) || 0,
    priorActiveCatalog: priorActive,
    startedAt: run.started_at ? new Date(run.started_at) : null,
    finishedAt: run.finished_at ? new Date(run.finished_at) : null,
  };

  const validity = evaluateScrapeRunValidity(metrics);
  let consecutiveInvalid = Number(policy?.consecutiveInvalidRuns) || 0;
  let paused = false;
  let newPolicyStatus = policyStatus;

  if (!validity.valid) {
    const pauseDecision = shouldPauseAfterInvalidRun({
      policyStatus,
      consecutiveInvalidRuns: consecutiveInvalid,
      invalidReason: validity.invalidReason,
    });
    consecutiveInvalid = pauseDecision.consecutiveInvalidRuns;
    paused = pauseDecision.shouldPause;
    if (pauseDecision.newStatus) newPolicyStatus = pauseDecision.newStatus;

    if (!dryRun) {
      await p.supplierStockPolicy.update({
        where: { supplierKey },
        data: {
          consecutiveInvalidRuns: consecutiveInvalid,
          lastInvalidRunAt: new Date(),
          lastScrapeRunId: input.scrapeRunId,
          ...(paused
            ? {
                status: pauseDecision.newStatus,
                pausedAt: new Date(),
                pausedReason: pauseDecision.pauseReason,
              }
            : {}),
        },
      });

      if (pauseDecision.notify) {
        const notifier = createSupplierStockNotifier();
        await notifier.notifyInvalidRunPause({
          supplierKey,
          displayName: policy?.displayName,
          subject: `[Supplier stock] ${supplierKey} paused after invalid scrape`,
          bodyText: `Supplier ${supplierKey} scrape run #${input.scrapeRunId} invalid: ${validity.invalidReason}\nConsecutive invalid: ${consecutiveInvalid}`,
        });
      }
    }

    if (!dryRun) {
      await p.supplierScrapeQualityRun.upsert({
        where: { scrapeRunId: input.scrapeRunId },
        create: {
          supplierKey,
          scrapeRunId: input.scrapeRunId,
          valid: false,
          invalidReason: validity.invalidReason,
          completeSnapshot: false,
          productsDiscovered: metrics.productsListed,
          variantsProcessed: 0,
          errorRate: validity.errorRate,
          coverageVsPrevious: validity.coverageVsPrevious,
          marketplacePublishStatus: newPolicyStatus,
          startedAt: metrics.startedAt,
          finishedAt: metrics.finishedAt,
          summaryJson: { metrics, validity, flags: validity.flags },
        },
        update: {
          valid: false,
          invalidReason: validity.invalidReason,
          errorRate: validity.errorRate,
          coverageVsPrevious: validity.coverageVsPrevious,
          summaryJson: { metrics, validity, flags: validity.flags },
        },
      });
    }

    return {
      ok: true,
      dryRun,
      supplierKey,
      scrapeRunId: input.scrapeRunId,
      valid: false,
      invalidReason: validity.invalidReason,
      completeSnapshot: false,
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus: newPolicyStatus,
      paused,
    };
  }

  const startedAt = metrics.startedAt ?? new Date(0);
  const seenVariants = (await p.supplierVariant.findMany({
    where: {
      supplierVariantId: { startsWith: `${supplierKey}_` },
      updatedAt: { gte: startedAt },
    },
    select: {
      supplierVariantId: true,
      supplierSku: true,
      gtin: true,
      price: true,
      stock: true,
      supplierProductName: true,
      supplierProductType: true,
      leadTimeDays: true,
      manualNote: true,
      updatedAt: true,
    },
  })) as DbVariantRow[];

  let confirmedInStock = 0;
  let confirmedOutOfStock = 0;
  let preorders = 0;
  let variantUncertain = 0;
  let priceMissing = 0;
  let excludedByDimension = 0;
  let reviewItemsCreated = 0;
  const seenIds = new Set<string>();
  const now = new Date();

  for (const row of seenVariants) {
    seenIds.add(row.supplierVariantId);
    const baseObs = variantToObservation(row, supplierKey, input.scrapeRunId);
    const obs = enrichObservation(baseObs, {
      gtin: row.gtin,
      supplierSku: row.supplierSku,
      productName: row.supplierProductName,
      productType: row.supplierProductType,
    });
    const reconciled = reconcileObservation(obs);

    if (obs.availabilityStatus === "confirmed_in_stock") confirmedInStock++;
    else if (obs.availabilityStatus === "confirmed_out_of_stock") confirmedOutOfStock++;
    else if (obs.availabilityStatus === "preorder" || obs.availabilityStatus === "backorder_or_supplier_order") {
      preorders++;
    } else if (obs.availabilityStatus === "variant_uncertain") variantUncertain++;
    if (obs.excluded) excludedByDimension++;
    if (obs.availabilityStatus === "price_missing") priceMissing++;

    if (!dryRun) {
      await p.supplierVariantEvidence.upsert({
        where: { supplierVariantId: row.supplierVariantId },
        create: {
          supplierKey,
          supplierVariantId: row.supplierVariantId,
          gtin: row.gtin,
          supplierSku: row.supplierSku,
          productName: row.supplierProductName,
          productUrl: obs.productUrl,
          sourcePrice: row.price,
          sourceLeadTimeDays: row.leadTimeDays,
          supplierStockQty: row.stock,
          availabilityStatus: reconciled.availabilityStatus,
          availabilitySignal: obs.availabilitySignal,
          quantitySource: obs.quantitySource,
          publishedQty: reconciled.publishedQty,
          zeroReason: reconciled.zeroReason,
          confidenceStatus: obs.identityMatchLevel,
          confidenceScore: obs.confidenceScore,
          lastProofAt: now,
          lastObservedAt: now,
          sourceScrapeRunId: input.scrapeRunId,
          rawParseJson: obs.rawParseJson ?? undefined,
          needsReview: reconciled.needsReview,
        },
        update: {
          gtin: row.gtin,
          supplierSku: row.supplierSku,
          productName: row.supplierProductName,
          productUrl: obs.productUrl,
          sourcePrice: row.price,
          sourceLeadTimeDays: row.leadTimeDays,
          supplierStockQty: row.stock,
          availabilityStatus: reconciled.availabilityStatus,
          publishedQty: reconciled.publishedQty,
          zeroReason: reconciled.zeroReason,
          confidenceStatus: obs.identityMatchLevel,
          confidenceScore: obs.confidenceScore,
          lastProofAt: now,
          lastObservedAt: now,
          sourceScrapeRunId: input.scrapeRunId,
          rawParseJson: obs.rawParseJson ?? undefined,
          needsReview: reconciled.needsReview,
        },
      });

      if (reconciled.needsReview) {
        await p.supplierStockReviewItem.create({
          data: {
            supplierKey,
            supplierVariantId: row.supplierVariantId,
            gtin: row.gtin,
            supplierSku: row.supplierSku,
            productName: row.supplierProductName,
            productUrl: obs.productUrl,
            dbPrice: row.price,
            dbQty: row.stock,
            proposedQty: reconciled.publishedQty,
            foundLeadTimeDays: row.leadTimeDays,
            proposedStatus: reconciled.availabilityStatus,
            reason: reconciled.reviewReason ?? reconciled.zeroReason ?? "needs_review",
            lastProofAt: now,
            sourceScrapeRunId: input.scrapeRunId,
            rawParseJson: obs.rawParseJson ?? undefined,
            status: "open",
          },
        });
        reviewItemsCreated++;
      }
    }
  }

  let qtyZeroed = 0;
  if (validity.completeSnapshot) {
    const catalogIds = (
      await p.supplierVariant.findMany({
        where: { supplierVariantId: { startsWith: `${supplierKey}_` } },
        select: { supplierVariantId: true },
      })
    ).map((r: { supplierVariantId: string }) => r.supplierVariantId);

    const missing = zeroMissingFromCompleteSnapshot({
      seenVariantIds: seenIds,
      catalogVariantIds: catalogIds,
    });

    for (const z of missing) {
      qtyZeroed++;
      if (dryRun) continue;

      await p.supplierVariantEvidence.upsert({
        where: { supplierVariantId: z.supplierVariantId },
        create: {
          supplierKey,
          supplierVariantId: z.supplierVariantId,
          availabilityStatus: "stale",
          publishedQty: 0,
          zeroReason: z.zeroReason,
          lastObservedAt: now,
          needsReview: false,
        },
        update: {
          availabilityStatus: "stale",
          publishedQty: 0,
          zeroReason: z.zeroReason,
          lastObservedAt: now,
          needsReview: false,
        },
      });

      await p.supplierVariant.updateMany({
        where: { supplierVariantId: z.supplierVariantId },
        data: { stock: 0 },
      });
    }
  }

  if (!dryRun) {
    await p.supplierStockPolicy.update({
      where: { supplierKey },
      data: {
        consecutiveInvalidRuns: 0,
        lastValidRunAt: new Date(),
        lastScrapeRunId: input.scrapeRunId,
        status: policyStatus === "paused_due_to_scrape_failure" ? "review_required" : policyStatus,
      },
    });

    await p.supplierScrapeQualityRun.upsert({
      where: { scrapeRunId: input.scrapeRunId },
      create: {
        supplierKey,
        scrapeRunId: input.scrapeRunId,
        valid: true,
        completeSnapshot: validity.completeSnapshot,
        productsDiscovered: metrics.productsListed,
        variantsProcessed: seenVariants.length,
        confirmedInStock,
        confirmedOutOfStock,
        preorders,
        variantUncertain,
        priceMissing,
        qtyZeroed,
        excludedByDimension,
        errorRate: validity.errorRate,
        coverageVsPrevious: validity.coverageVsPrevious,
        marketplacePublishStatus: policyStatus,
        startedAt: metrics.startedAt,
        finishedAt: metrics.finishedAt,
        summaryJson: { metrics, validity, seen: seenVariants.length, qtyZeroed },
      },
      update: {
        valid: true,
        completeSnapshot: validity.completeSnapshot,
        variantsProcessed: seenVariants.length,
        confirmedInStock,
        confirmedOutOfStock,
        preorders,
        variantUncertain,
        priceMissing,
        qtyZeroed,
        excludedByDimension,
        errorRate: validity.errorRate,
        coverageVsPrevious: validity.coverageVsPrevious,
        summaryJson: { metrics, validity, seen: seenVariants.length, qtyZeroed },
      },
    });
  }

  return {
    ok: true,
    dryRun,
    supplierKey,
    scrapeRunId: input.scrapeRunId,
    valid: true,
    completeSnapshot: validity.completeSnapshot,
    variantsProcessed: seenVariants.length,
    qtyZeroed,
    reviewItemsCreated,
    policyStatus,
    paused: false,
  };
}
