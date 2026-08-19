import { Prisma } from "@prisma/client";

import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/adsanalytics/explorer/limiter";
import {
  deleteSupplementalProductInput,
  extractCustomLabel3,
  getProcessedProduct,
  insertSupplementalProductLabel,
  MerchantApiError,
  type MerchantProductRef,
} from "@/adsanalytics/explorer/merchantClient";
import {
  EXPLORER_ACTIVE_LABEL,
  EXPLORER_LABELS,
  LONG_TAIL_ALL_LABEL,
  ROUTED_LABELS,
} from "@/adsanalytics/explorer/labels";

export { EXPLORER_ACTIVE_LABEL, EXPLORER_LABELS, LONG_TAIL_ALL_LABEL, ROUTED_LABELS };

export const DESTINATIONS = ["CORE_ALL", "EXPLORER_ALL", "LONG_TAIL_ALL"] as const;
export type Destination = (typeof DESTINATIONS)[number];

/** custom_label_3 value that materializes each destination. CORE_ALL means "no label". */
export const DESTINATION_LABEL: Record<Destination, string | null> = {
  CORE_ALL: null,
  EXPLORER_ALL: EXPLORER_ACTIVE_LABEL,
  LONG_TAIL_ALL: LONG_TAIL_ALL_LABEL,
};

export function isDestination(value: unknown): value is Destination {
  return typeof value === "string" && (DESTINATIONS as readonly string[]).includes(value);
}

export function destinationForLabel(label: string | null | undefined): Destination {
  const normalized = (label ?? "").trim();
  if ((EXPLORER_LABELS as readonly string[]).includes(normalized)) return "EXPLORER_ALL";
  if (normalized === LONG_TAIL_ALL_LABEL) return "LONG_TAIL_ALL";
  return "CORE_ALL";
}

export function labelForDestination(destination: Destination): string | null {
  return DESTINATION_LABEL[destination];
}

export function destinationOperation(destination: Destination): string {
  return `set:${destination}`;
}

export type ModelOffer = MerchantProductRef & { shopifyProductId: string };

export type DestinationContext = {
  batchId: string;
  merchantId: string;
  dataSource: string;
  concurrency?: number;
  dryRun?: boolean;
};

export type OfferReadback = {
  offer: ModelOffer;
  observedLabel: string | null;
  observedDestination: Destination;
  matches: boolean;
  error?: string;
};

export type SetModelDestinationResult = {
  modelId: string;
  destination: Destination;
  targetLabel: string | null;
  offerCount: number;
  alreadyConverged: boolean;
  mutated: number;
  mutationErrors: string[];
  verified: boolean;
  mismatches: OfferReadback[];
  committed: boolean;
  dryRun: boolean;
};

const DEFAULT_CONCURRENCY = 8;
/** One short peek after mutate. Merchant often needs minutes-to-hours; sitting in a 6×20s
 * loop per model just serializes the drain. Unconfirmed writes stay pending and the
 * resume path (readback only) commits them on the next pass. */
const DEFAULT_VERIFY_ATTEMPTS = 1;
const DEFAULT_VERIFY_DELAY_MS = 3_000;

function errorMessage(err: unknown): string {
  if (err instanceof MerchantApiError) return err.message;
  if (err instanceof Error) return err.message;
  return String(err);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function loadOffersForModel(
  batchId: string,
  shopifyProductId: string
): Promise<ModelOffer[]> {
  const rows = await prisma.$queryRaw<
    Array<{ offer_id: string; content_language: string; feed_label: string }>
  >(Prisma.sql`
    SELECT DISTINCT
      "offer_id",
      "content_language",
      "feed_label"
    FROM "public"."ads_explorer_offer_writes"
    WHERE "batch_id" = ${batchId}
      AND "shopify_product_id" = ${shopifyProductId}::bigint
    ORDER BY "offer_id", "content_language", "feed_label"
  `);
  return rows.map((r) => ({
    shopifyProductId,
    offerId: r.offer_id,
    contentLanguage: r.content_language,
    feedLabel: r.feed_label,
  }));
}

export async function loadOffersForBatchGroupedByModel(
  batchId: string
): Promise<Map<string, ModelOffer[]>> {
  const rows = await prisma.$queryRaw<
    Array<{
      shopify_product_id: string;
      offer_id: string;
      content_language: string;
      feed_label: string;
    }>
  >(Prisma.sql`
    SELECT DISTINCT
      "shopify_product_id"::text,
      "offer_id",
      "content_language",
      "feed_label"
    FROM "public"."ads_explorer_offer_writes"
    WHERE "batch_id" = ${batchId}
    ORDER BY "shopify_product_id", "offer_id", "content_language", "feed_label"
  `);
  const map = new Map<string, ModelOffer[]>();
  for (const r of rows) {
    const list = map.get(r.shopify_product_id) ?? [];
    list.push({
      shopifyProductId: r.shopify_product_id,
      offerId: r.offer_id,
      contentLanguage: r.content_language,
      feedLabel: r.feed_label,
    });
    map.set(r.shopify_product_id, list);
  }
  return map;
}

async function enqueueDestinationWrites(
  ctx: DestinationContext,
  offers: ModelOffer[],
  destination: Destination
): Promise<void> {
  if (offers.length === 0) return;
  const operation = destinationOperation(destination);
  const values = offers.map(
    (o) => Prisma.sql`(
      gen_random_uuid()::text,
      ${ctx.batchId},
      ${o.shopifyProductId}::bigint,
      ${o.offerId},
      ${o.contentLanguage},
      ${o.feedLabel},
      ${operation},
      'pending',
      0,
      CURRENT_TIMESTAMP,
      CURRENT_TIMESTAMP
    )`
  );
  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "public"."ads_explorer_offer_writes" (
      "id","batch_id","shopify_product_id","offer_id","content_language","feed_label",
      "operation","status","attempts","created_at","updated_at"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("batch_id","offer_id","content_language","feed_label","operation")
    DO UPDATE SET
      "status" = 'pending',
      "last_error" = NULL,
      "processed_at" = NULL,
      "updated_at" = CURRENT_TIMESTAMP
  `);
}

async function markDestinationWrites(
  ctx: DestinationContext,
  offers: ModelOffer[],
  destination: Destination,
  status: "pending_verify" | "succeeded" | "failed",
  lastError?: string
): Promise<void> {
  if (offers.length === 0) return;
  const operation = destinationOperation(destination);
  const keys = offers.map(
    (o) => Prisma.sql`(${o.offerId}, ${o.contentLanguage}, ${o.feedLabel})`
  );
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_offer_writes"
    SET
      "status" = ${status},
      "attempts" = "attempts" + 1,
      "last_error" = ${lastError ? lastError.slice(0, 2000) : null},
      "processed_at" = CURRENT_TIMESTAMP,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "batch_id" = ${ctx.batchId}
      AND "operation" = ${operation}
      AND ("offer_id", "content_language", "feed_label") IN (${Prisma.join(keys)})
  `);
}

/** Read the processed Merchant product for every offer and compare with the target label. */
export async function readbackOffers(
  ctx: DestinationContext,
  offers: ModelOffer[],
  destination: Destination
): Promise<OfferReadback[]> {
  const targetLabel = labelForDestination(destination);
  const limit = createLimiter(ctx.concurrency ?? DEFAULT_CONCURRENCY);
  return Promise.all(
    offers.map((offer) =>
      limit(async (): Promise<OfferReadback> => {
        try {
          const product = await getProcessedProduct(ctx.merchantId, offer);
          const observedLabel = extractCustomLabel3(product);
          const normalized = observedLabel && observedLabel.length > 0 ? observedLabel : null;
          return {
            offer,
            observedLabel: normalized,
            observedDestination: destinationForLabel(normalized),
            matches: (normalized ?? null) === (targetLabel ?? null),
          };
        } catch (err) {
          const message = errorMessage(err);
          // A disappeared offer cannot keep a stale label; treat 404 as CORE_ALL.
          if (err instanceof MerchantApiError && err.status === 404) {
            return {
              offer,
              observedLabel: null,
              observedDestination: "CORE_ALL",
              matches: targetLabel === null,
              error: message,
            };
          }
          return {
            offer,
            observedLabel: null,
            observedDestination: "CORE_ALL",
            matches: false,
            error: message,
          };
        }
      })
    )
  );
}

async function mutateOffers(
  ctx: DestinationContext,
  offers: ModelOffer[],
  destination: Destination
): Promise<{ mutated: number; errors: string[] }> {
  const targetLabel = labelForDestination(destination);
  const limit = createLimiter(ctx.concurrency ?? DEFAULT_CONCURRENCY);
  const errors: string[] = [];
  let mutated = 0;

  await Promise.all(
    offers.map((offer) =>
      limit(async () => {
        try {
          if (targetLabel === null) {
            try {
              await deleteSupplementalProductInput(ctx.merchantId, ctx.dataSource, offer);
            } catch (err) {
              // Already absent from the supplemental source is the desired end state.
              if (!(err instanceof MerchantApiError && err.status === 404)) throw err;
            }
          } else {
            // productInputs:insert upserts on (offerId, contentLanguage, feedLabel),
            // so EXPLORER_ALL -> LONG_TAIL_ALL is a single overwrite.
            await insertSupplementalProductLabel(
              ctx.merchantId,
              ctx.dataSource,
              offer,
              targetLabel
            );
          }
          mutated += 1;
        } catch (err) {
          errors.push(`${offer.offerId}/${offer.contentLanguage}: ${errorMessage(err)}`);
        }
      })
    )
  );

  return { mutated, errors };
}

export async function commitModelDestination(
  batchId: string,
  shopifyProductId: string,
  destination: Destination,
  options: { reason?: string | null; retestAt?: Date | null; cooldownUntil?: Date | null } = {}
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batch_models"
    SET
      "destination" = ${destination},
      "pending_destination" = NULL,
      "destination_reason" = COALESCE(${options.reason ?? null}, "destination_reason"),
      "destination_applied_at" = CURRENT_TIMESTAMP,
      "retest_at" = COALESCE(${options.retestAt ?? null}::timestamptz, "retest_at"),
      "cooldown_until" = COALESCE(${options.cooldownUntil ?? null}::timestamptz, "cooldown_until"),
      "lifecycle_status" = ${destination === "EXPLORER_ALL" ? "active" : "exited"},
      "exit_reason" = ${destination === "EXPLORER_ALL" ? null : (options.reason ?? null)},
      "exited_at" = ${destination === "EXPLORER_ALL" ? null : new Date()}::timestamptz,
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "batch_id" = ${batchId}
      AND "shopify_product_id" = ${shopifyProductId}::bigint
  `);
}

async function markPendingDestination(
  batchId: string,
  shopifyProductId: string,
  destination: Destination,
  reason: string | null
): Promise<void> {
  await prisma.$executeRaw(Prisma.sql`
    UPDATE "public"."ads_explorer_batch_models"
    SET
      "pending_destination" = ${destination},
      "destination_reason" = ${reason},
      "updated_at" = CURRENT_TIMESTAMP
    WHERE "batch_id" = ${batchId}
      AND "shopify_product_id" = ${shopifyProductId}::bigint
  `);
}

/**
 * Single idempotent entry point for routing a model between the three destinations.
 *
 * Order is always mutate -> Merchant readback -> DB commit. A model whose readback has
 * not converged keeps its previous DB destination and stays pending for the next run.
 */
export async function setModelDestination(
  shopifyProductId: string,
  destination: Destination,
  ctx: DestinationContext,
  options: {
    reason?: string | null;
    retestAt?: Date | null;
    cooldownUntil?: Date | null;
    offers?: ModelOffer[];
    verifyAttempts?: number;
    verifyDelayMs?: number;
  } = {}
): Promise<SetModelDestinationResult> {
  const offers = options.offers ?? (await loadOffersForModel(ctx.batchId, shopifyProductId));
  const targetLabel = labelForDestination(destination);
  const dryRun = ctx.dryRun === true;
  const base: SetModelDestinationResult = {
    modelId: shopifyProductId,
    destination,
    targetLabel,
    offerCount: offers.length,
    alreadyConverged: false,
    mutated: 0,
    mutationErrors: [],
    verified: false,
    mismatches: [],
    committed: false,
    dryRun,
  };

  if (offers.length === 0) {
    return { ...base, mutationErrors: ["No Merchant offers known for this model"] };
  }

  const initial = await readbackOffers(ctx, offers, destination);
  if (initial.every((r) => r.matches)) {
    if (!dryRun) {
      await markDestinationWrites(ctx, offers, destination, "succeeded");
      await commitModelDestination(ctx.batchId, shopifyProductId, destination, options);
    }
    return { ...base, alreadyConverged: true, verified: true, committed: !dryRun };
  }

  if (dryRun) {
    return { ...base, mismatches: initial.filter((r) => !r.matches) };
  }

  await enqueueDestinationWrites(ctx, offers, destination);
  await markPendingDestination(ctx.batchId, shopifyProductId, destination, options.reason ?? null);

  const { mutated, errors } = await mutateOffers(ctx, offers, destination);
  if (errors.length > 0) {
    await markDestinationWrites(ctx, offers, destination, "failed", errors.join(" | "));
    return { ...base, mutated, mutationErrors: errors };
  }
  await markDestinationWrites(ctx, offers, destination, "pending_verify");

  const attempts = Math.max(1, options.verifyAttempts ?? DEFAULT_VERIFY_ATTEMPTS);
  const delayMs = Math.max(0, options.verifyDelayMs ?? DEFAULT_VERIFY_DELAY_MS);
  let readback: OfferReadback[] = [];
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    await sleep(attempt === 0 ? Math.min(delayMs, 5_000) : delayMs);
    readback = await readbackOffers(ctx, offers, destination);
    if (readback.every((r) => r.matches)) break;
  }

  const verified = readback.length > 0 && readback.every((r) => r.matches);
  if (!verified) {
    await markDestinationWrites(
      ctx,
      offers,
      destination,
      "pending_verify",
      "Merchant readback not converged yet"
    );
    return { ...base, mutated, verified: false, mismatches: readback.filter((r) => !r.matches) };
  }

  await markDestinationWrites(ctx, offers, destination, "succeeded");
  await commitModelDestination(ctx.batchId, shopifyProductId, destination, options);
  return { ...base, mutated, verified: true, committed: true };
}

/**
 * Resume step for models mutated in a previous run whose readback had not propagated yet.
 * Performs no Merchant writes: readback only, then commit.
 */
export async function verifyPendingDestinations(
  ctx: DestinationContext,
  options: { limit?: number } = {}
): Promise<{
  checked: number;
  committed: number;
  stillPending: number;
  details: Array<{ modelId: string; destination: Destination; converged: boolean }>;
}> {
  const rows = await prisma.$queryRaw<
    Array<{ shopify_product_id: string; pending_destination: string; destination_reason: string | null }>
  >(Prisma.sql`
    SELECT "shopify_product_id"::text, "pending_destination", "destination_reason"
    FROM "public"."ads_explorer_batch_models"
    WHERE "batch_id" = ${ctx.batchId}
      AND "pending_destination" IS NOT NULL
    ORDER BY "shopify_product_id"
    LIMIT ${options.limit ?? 1000}
  `);

  const offersByModel = await loadOffersForBatchGroupedByModel(ctx.batchId);
  const details: Array<{ modelId: string; destination: Destination; converged: boolean }> = [];
  let committed = 0;

  for (const row of rows) {
    if (!isDestination(row.pending_destination)) continue;
    const destination = row.pending_destination;
    const offers = offersByModel.get(row.shopify_product_id) ?? [];
    if (offers.length === 0) {
      details.push({ modelId: row.shopify_product_id, destination, converged: false });
      continue;
    }
    const readback = await readbackOffers(ctx, offers, destination);
    const converged = readback.every((r) => r.matches);
    if (converged && !ctx.dryRun) {
      await markDestinationWrites(ctx, offers, destination, "succeeded");
      await commitModelDestination(ctx.batchId, row.shopify_product_id, destination, {
        reason: row.destination_reason,
      });
      committed += 1;
    }
    details.push({ modelId: row.shopify_product_id, destination, converged });
  }

  return {
    checked: rows.length,
    committed,
    stillPending: rows.length - committed,
    details,
  };
}
