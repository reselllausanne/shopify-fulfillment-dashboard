/**
 * Finalize supplier stock after a scrape.
 * Absolute rule: SupplierVariant.stock is NEVER fresh proof.
 * Only structured SupplierVariantObservation payloads from this run renew evidence.
 */

import { prisma } from "@/app/lib/prisma";
import { scraperQuery } from "@/app/lib/scraperDb";
import { allSupplierSeeds, buildSupplierSeed, seedScrapeIntervalHours } from "./defaults";
import { shouldPauseAfterInvalidRun } from "./invalidRunPolicy";
import { createSupplierStockNotifier } from "./notify";
import { observationFromSourcePayload } from "./observation";
import { enrichObservation, reconcileObservation, zeroMissingFromCompleteSnapshot } from "./reconcile";
import { evaluateScrapeRunValidity } from "./runValidity";
import type {
  ScrapeRunMetrics,
  SnapshotCompleteness,
  SupplierStockPolicyStatus,
  SupplierVariantObservation,
} from "./types";
import {
  TEMPORARY_MONITORING_EXCEPTION,
  ZERO_REASON_NO_FRESH_SOURCE,
  isScrapeSuccessStatus,
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

export type FinalizeRunInput = {
  supplierKey: string;
  scrapeRunId: number;
  dryRun?: boolean;
  priorActiveCatalog?: number;
  /** Structured page proofs from THIS run — required for lastProofAt / publishedQty > 0. */
  observations?: SupplierVariantObservation[];
  snapshotCompleteness?: SnapshotCompleteness;
  incompletenessReason?: string | null;
  partialRun?: boolean;
  previousReliableSnapshotCount?: number | null;
};

export type FinalizeRunResult = {
  ok: boolean;
  dryRun: boolean;
  supplierKey: string;
  scrapeRunId: number;
  valid: boolean;
  invalidReason?: string;
  completeSnapshot: boolean;
  snapshotCompleteness: SnapshotCompleteness;
  variantsProcessed: number;
  qtyZeroed: number;
  reviewItemsCreated: number;
  policyStatus: SupplierStockPolicyStatus;
  paused: boolean;
  observationContractPresent: boolean;
  exceptionTag?: string | null;
};

function prismaAny() {
  return prisma as any;
}

/** Staging/local only — never auto-seed policies in production finalize. */
export function maySeedSupplierStockPolicies(): boolean {
  return String(process.env.SUPPLIER_STOCK_ALLOW_SEED ?? "").trim() === "1";
}

export async function ensureSupplierStockPolicies(supplierKeys?: string[]): Promise<number> {
  if (!maySeedSupplierStockPolicies()) {
    console.warn(
      "[supplier-stock] seed skipped — set SUPPLIER_STOCK_ALLOW_SEED=1 for staging/local explicit seed only"
    );
    return 0;
  }
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
        notes:
          seed.status === "monitoring_only"
            ? TEMPORARY_MONITORING_EXCEPTION
            : "review_required until observation contract validated",
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

async function loadPreviousReliableSnapshotCount(supplierKey: string): Promise<number | null> {
  try {
    const prev = await prismaAny().supplierScrapeQualityRun.findFirst({
      where: { supplierKey, valid: true, completeSnapshot: true },
      orderBy: { startedAt: "desc" },
      select: { productsDiscovered: true, variantsProcessed: true, summaryJson: true },
    });
    if (!prev) return null;
    const fromSummary = Number((prev.summaryJson as any)?.reliableCatalogCount);
    if (Number.isFinite(fromSummary) && fromSummary > 0) return fromSummary;
    return Math.max(Number(prev.productsDiscovered) || 0, Number(prev.variantsProcessed) || 0) || null;
  } catch {
    return null;
  }
}

function parseSnapshotHintsFromMessage(message: string | null | undefined): {
  snapshotCompleteness: SnapshotCompleteness;
  incompletenessReason: string | null;
  partialRun: boolean;
} {
  const msg = String(message ?? "");
  if (/snapshotCompleteness[=:]full\b/i.test(msg) || /snapshot[=:]full\b/i.test(msg)) {
    return { snapshotCompleteness: "full", incompletenessReason: null, partialRun: false };
  }
  if (/max=\d+|partial|pagination.?stop|categories.?incomplete|resume/i.test(msg)) {
    return {
      snapshotCompleteness: "partial",
      incompletenessReason: "message_indicates_partial",
      partialRun: true,
    };
  }
  return { snapshotCompleteness: "unknown", incompletenessReason: "snapshot_not_declared_full", partialRun: false };
}

export async function finalizeSupplierStockRun(input: FinalizeRunInput): Promise<FinalizeRunResult> {
  const supplierKey = String(input.supplierKey).trim().toLowerCase();
  const dryRun = Boolean(input.dryRun);
  const p = prismaAny();
  const observations = input.observations ?? [];
  const observationContractPresent = observations.length > 0;

  // Do NOT auto-seed policies here — production activation is manual per supplier.
  const policy = await getSupplierStockPolicy(supplierKey).catch(() => null);
  const policyStatus = (policy?.status ??
    (supplierKey === "wel" || supplierKey === "rei" ? "monitoring_only" : "review_required")) as SupplierStockPolicyStatus;

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
      snapshotCompleteness: "unknown",
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus,
      paused: false,
      observationContractPresent,
    };
  }

  const msgHints = parseSnapshotHintsFromMessage(run.message);
  const priorActive = input.priorActiveCatalog ?? (await countActiveCatalog(supplierKey));
  const previousReliable =
    input.previousReliableSnapshotCount ?? (await loadPreviousReliableSnapshotCount(supplierKey));

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
    snapshotCompleteness: input.snapshotCompleteness ?? msgHints.snapshotCompleteness,
    incompletenessReason: input.incompletenessReason ?? msgHints.incompletenessReason,
    partialRun: input.partialRun ?? msgHints.partialRun,
    previousReliableSnapshotCount: previousReliable,
  };

  const validity = evaluateScrapeRunValidity(metrics);
  let consecutiveInvalid = Number(policy?.consecutiveInvalidRuns) || 0;
  let paused = false;
  let newPolicyStatus = policyStatus;
  let exceptionTag: string | null = null;
  let qtyZeroed = 0;

  if (!validity.valid) {
    const pauseDecision = shouldPauseAfterInvalidRun({
      policyStatus,
      consecutiveInvalidRuns: consecutiveInvalid,
      invalidReason: validity.invalidReason,
    });
    consecutiveInvalid = pauseDecision.consecutiveInvalidRuns;
    paused = pauseDecision.shouldPause;
    exceptionTag = pauseDecision.exceptionTag ?? null;
    if (pauseDecision.newStatus) newPolicyStatus = pauseDecision.newStatus;

    if (!dryRun && policy) {
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

      if (pauseDecision.zeroMarketplaceStock && policyStatus !== "monitoring_only") {
        const updated = await p.supplierVariant.updateMany({
          where: {
            supplierVariantId: { startsWith: `${supplierKey}_` },
            stock: { gt: 0 },
            manualLock: false,
          },
          data: { stock: 0 },
        });
        qtyZeroed = Number(updated?.count ?? 0);
      }

      if (pauseDecision.notify) {
        const notifier = createSupplierStockNotifier();
        await notifier.notifyInvalidRunPause({
          supplierKey,
          displayName: policy?.displayName,
          subject: `[Supplier stock] ${supplierKey} ${paused ? "paused" : "alert"} after invalid scrape`,
          bodyText: [
            `Supplier ${supplierKey}`,
            `Run #${input.scrapeRunId} invalid: ${validity.invalidReason}`,
            `Consecutive invalid: ${consecutiveInvalid}`,
            pauseDecision.exceptionTag ? `Exception: ${pauseDecision.exceptionTag}` : null,
            `Offers zeroed: ${qtyZeroed}`,
            `Last success: ${policy?.lastValidRunAt ? new Date(policy.lastValidRunAt).toISOString() : "unknown"}`,
          ]
            .filter(Boolean)
            .join("\n"),
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
          qtyZeroed,
          errorRate: validity.errorRate,
          coverageVsPrevious: validity.coverageVsPrevious,
          marketplacePublishStatus: newPolicyStatus,
          startedAt: metrics.startedAt,
          finishedAt: metrics.finishedAt,
          summaryJson: {
            metrics,
            validity,
            flags: validity.flags,
            snapshotCompleteness: validity.snapshotCompleteness,
            incompletenessReason: validity.incompletenessReason,
            observationContractPresent,
            exceptionTag,
            note: "NO historical SupplierVariant.stock used as proof",
          },
        },
        update: {
          valid: false,
          invalidReason: validity.invalidReason,
          qtyZeroed,
          errorRate: validity.errorRate,
          coverageVsPrevious: validity.coverageVsPrevious,
          summaryJson: {
            metrics,
            validity,
            flags: validity.flags,
            snapshotCompleteness: validity.snapshotCompleteness,
            incompletenessReason: validity.incompletenessReason,
            observationContractPresent,
            exceptionTag,
          },
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
      snapshotCompleteness: validity.snapshotCompleteness,
      variantsProcessed: 0,
      qtyZeroed,
      reviewItemsCreated: 0,
      policyStatus: newPolicyStatus,
      paused,
      observationContractPresent,
      exceptionTag,
    };
  }

  // Valid run — only structured observations renew proof. Never scan SupplierVariant.stock.
  let confirmedInStock = 0;
  let confirmedOutOfStock = 0;
  let preorders = 0;
  let variantUncertain = 0;
  let priceMissing = 0;
  let excludedByDimension = 0;
  let reviewItemsCreated = 0;
  const seenIds = new Set<string>();
  const now = new Date();

  if (!observationContractPresent) {
    // Valid scrape mechanics but no page-level proof contract → cannot publish / cannot approve.
    if (!dryRun) {
      await p.supplierScrapeQualityRun.upsert({
        where: { scrapeRunId: input.scrapeRunId },
        create: {
          supplierKey,
          scrapeRunId: input.scrapeRunId,
          valid: true,
          completeSnapshot: false,
          productsDiscovered: metrics.productsListed,
          variantsProcessed: 0,
          marketplacePublishStatus: policyStatus,
          startedAt: metrics.startedAt,
          finishedAt: metrics.finishedAt,
          summaryJson: {
            observationContractPresent: false,
            incompletenessReason: "observation_contract_missing",
            note: ZERO_REASON_NO_FRESH_SOURCE,
            snapshotCompleteness: metrics.snapshotCompleteness,
          },
        },
        update: {
          valid: true,
          completeSnapshot: false,
          summaryJson: {
            observationContractPresent: false,
            incompletenessReason: "observation_contract_missing",
            note: ZERO_REASON_NO_FRESH_SOURCE,
          },
        },
      });
      // Reset consecutive invalid only on true success status (already validated).
      if (policy && isScrapeSuccessStatus(run.status)) {
        await p.supplierStockPolicy.update({
          where: { supplierKey },
          data: {
            consecutiveInvalidRuns: 0,
            lastValidRunAt: new Date(),
            lastScrapeRunId: input.scrapeRunId,
          },
        });
      }
    }

    return {
      ok: true,
      dryRun,
      supplierKey,
      scrapeRunId: input.scrapeRunId,
      valid: true,
      completeSnapshot: false,
      snapshotCompleteness: "unknown",
      variantsProcessed: 0,
      qtyZeroed: 0,
      reviewItemsCreated: 0,
      policyStatus,
      paused: false,
      observationContractPresent: false,
      exceptionTag: policyStatus === "monitoring_only" ? TEMPORARY_MONITORING_EXCEPTION : null,
    };
  }

  for (const raw of observations) {
    const baseObs = observationFromSourcePayload({
      ...raw,
      supplierKey,
      scrapeRunId: input.scrapeRunId,
    });
    seenIds.add(baseObs.supplierVariantId);
    const obs = enrichObservation(baseObs, {
      gtin: raw.gtin,
      supplierSku: raw.supplierSku,
      manufacturerRef: raw.manufacturerRef,
      productName: raw.productName,
      productUrl: raw.productUrl ?? raw.variantUrl,
    });
    const reconciled = reconcileObservation(obs);

    if (obs.availabilityStatus === "confirmed_in_stock") confirmedInStock++;
    else if (obs.availabilityStatus === "confirmed_out_of_stock") confirmedOutOfStock++;
    else if (obs.availabilityStatus === "preorder" || obs.availabilityStatus === "backorder_or_supplier_order") {
      preorders++;
    } else if (obs.availabilityStatus === "variant_uncertain") variantUncertain++;
    if (obs.excluded) excludedByDimension++;
    if (obs.availabilityStatus === "price_missing") priceMissing++;

    const writeProofAt = Boolean(obs.hasFreshSourceEvidence);

    if (!dryRun) {
      await p.supplierVariantEvidence.upsert({
        where: { supplierVariantId: obs.supplierVariantId },
        create: {
          supplierKey,
          supplierVariantId: obs.supplierVariantId,
          gtin: obs.gtin,
          supplierSku: obs.supplierSku,
          manufacturerRef: obs.manufacturerRef,
          productName: obs.productName,
          productUrl: obs.productUrl ?? obs.variantUrl,
          variantUrl: obs.variantUrl,
          sourcePrice: obs.sourcePrice,
          sourceLeadTimeDays: obs.sourceLeadTimeDays,
          supplierStockQty: obs.supplierStockQty,
          availabilityStatus: reconciled.availabilityStatus,
          availabilitySignal: obs.purchaseSignal ?? obs.availabilitySignal,
          quantitySource: obs.quantitySource,
          publishedQty: reconciled.publishedQty,
          zeroReason: reconciled.zeroReason,
          confidenceStatus: obs.identityMatchLevel,
          confidenceScore: obs.confidenceScore,
          lastProofAt: writeProofAt ? now : null,
          lastObservedAt: now,
          sourceScrapeRunId: input.scrapeRunId,
          rawParseJson: obs.rawParseJson ?? undefined,
          needsReview: reconciled.needsReview,
        },
        update: {
          gtin: obs.gtin,
          supplierSku: obs.supplierSku,
          manufacturerRef: obs.manufacturerRef,
          productName: obs.productName,
          productUrl: obs.productUrl ?? obs.variantUrl,
          variantUrl: obs.variantUrl,
          sourcePrice: obs.sourcePrice,
          sourceLeadTimeDays: obs.sourceLeadTimeDays,
          supplierStockQty: obs.supplierStockQty,
          availabilityStatus: reconciled.availabilityStatus,
          availabilitySignal: obs.purchaseSignal ?? obs.availabilitySignal,
          quantitySource: obs.quantitySource,
          publishedQty: reconciled.publishedQty,
          zeroReason: reconciled.zeroReason,
          confidenceStatus: obs.identityMatchLevel,
          confidenceScore: obs.confidenceScore,
          ...(writeProofAt ? { lastProofAt: now } : {}),
          lastObservedAt: now,
          sourceScrapeRunId: input.scrapeRunId,
          rawParseJson: obs.rawParseJson ?? undefined,
          needsReview: reconciled.needsReview,
        },
      });

      // Apply published qty to DB stock only when approved (not monitoring_only / review_required).
      if (policyStatus === "approved" && writeProofAt) {
        await p.supplierVariant.updateMany({
          where: { supplierVariantId: obs.supplierVariantId, manualLock: false },
          data: { stock: reconciled.publishedQty, lastSyncAt: now },
        });
      }

      if (reconciled.needsReview) {
        await p.supplierStockReviewItem.create({
          data: {
            supplierKey,
            supplierVariantId: obs.supplierVariantId,
            gtin: obs.gtin,
            supplierSku: obs.supplierSku,
            manufacturerRef: obs.manufacturerRef,
            productName: obs.productName,
            productUrl: obs.productUrl ?? obs.variantUrl,
            foundPrice: obs.sourcePrice,
            proposedQty: reconciled.publishedQty,
            foundLeadTimeDays: obs.sourceLeadTimeDays,
            proposedStatus: reconciled.availabilityStatus,
            reason: reconciled.reviewReason ?? reconciled.zeroReason ?? ZERO_REASON_NO_FRESH_SOURCE,
            lastProofAt: writeProofAt ? now : null,
            sourceScrapeRunId: input.scrapeRunId,
            rawParseJson: obs.rawParseJson ?? undefined,
            status: "open",
          },
        });
        reviewItemsCreated++;
      }
    }
  }

  if (validity.completeSnapshot && policyStatus === "approved") {
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
        where: { supplierVariantId: z.supplierVariantId, manualLock: false },
        data: { stock: 0 },
      });
    }
  } else if (!validity.completeSnapshot && validity.flags.includes("coverage_below_threshold_review")) {
    // Alert-only — do not zero absents.
    if (!dryRun) {
      reviewItemsCreated++;
      await p.supplierStockReviewItem.create({
        data: {
          supplierKey,
          supplierVariantId: `${supplierKey}_coverage_alert`,
          productName: "Coverage below threshold",
          proposedQty: 0,
          proposedStatus: "manual_review_required",
          reason: validity.incompletenessReason ?? "coverage_below_threshold",
          sourceScrapeRunId: input.scrapeRunId,
          status: "open",
        },
      });
    }
  }

  if (!dryRun) {
    if (policy && isScrapeSuccessStatus(run.status)) {
      await p.supplierStockPolicy.update({
        where: { supplierKey },
        data: {
          consecutiveInvalidRuns: 0,
          lastValidRunAt: new Date(),
          lastScrapeRunId: input.scrapeRunId,
          status: policyStatus === "paused_due_to_scrape_failure" ? "review_required" : policyStatus,
        },
      });
    }

    await p.supplierScrapeQualityRun.upsert({
      where: { scrapeRunId: input.scrapeRunId },
      create: {
        supplierKey,
        scrapeRunId: input.scrapeRunId,
        valid: true,
        completeSnapshot: validity.completeSnapshot,
        productsDiscovered: metrics.productsListed,
        variantsProcessed: observations.length,
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
        summaryJson: {
          metrics,
          validity,
          observationContractPresent: true,
          snapshotCompleteness: validity.snapshotCompleteness,
          incompletenessReason: validity.incompletenessReason,
          reliableCatalogCount: listedOrWrote(metrics),
          note: "Evidence from SupplierVariantObservation only — never SupplierVariant.stock",
        },
      },
      update: {
        valid: true,
        completeSnapshot: validity.completeSnapshot,
        variantsProcessed: observations.length,
        confirmedInStock,
        confirmedOutOfStock,
        preorders,
        variantUncertain,
        priceMissing,
        qtyZeroed,
        excludedByDimension,
        errorRate: validity.errorRate,
        coverageVsPrevious: validity.coverageVsPrevious,
        summaryJson: {
          metrics,
          validity,
          observationContractPresent: true,
          snapshotCompleteness: validity.snapshotCompleteness,
          incompletenessReason: validity.incompletenessReason,
        },
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
    snapshotCompleteness: validity.snapshotCompleteness,
    variantsProcessed: observations.length,
    qtyZeroed,
    reviewItemsCreated,
    policyStatus,
    paused: false,
    observationContractPresent: true,
    exceptionTag: policyStatus === "monitoring_only" ? TEMPORARY_MONITORING_EXCEPTION : null,
  };
}

function listedOrWrote(metrics: ScrapeRunMetrics): number {
  return Math.max(metrics.productsListed, metrics.variantsUpserted);
}
