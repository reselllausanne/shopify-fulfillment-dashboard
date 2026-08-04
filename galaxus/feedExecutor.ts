import type { FeedScope, FeedTriggerSource } from "@/galaxus/ops/types";

/** When "worker", web/cron only enqueue — worker-galaxus-feed executes exports. */
export function galaxusFeedRunsOnWorker(): boolean {
  const raw = String(process.env.GALAXUS_FEED_RUN_ON ?? "worker").trim().toLowerCase();
  return raw === "worker" || raw === "1" || raw === "true";
}

/** Set on worker-galaxus-feed container only. */
export function isGalaxusFeedWorkerProcess(): boolean {
  return String(process.env.GALAXUS_FEED_WORKER ?? "").trim() === "1";
}

export function galaxusFeedExecutorMayRunFeeds(): boolean {
  if (!galaxusFeedRunsOnWorker()) return true;
  return isGalaxusFeedWorkerProcess();
}

/** Peak season: skip master-specs + scraper-triggered heavy feeds (env toggle). */
export function galaxusHeavyFeedsPaused(): boolean {
  const raw = String(process.env.GALAXUS_PAUSE_HEAVY_FEEDS ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes";
}

const HEAVY_TRIGGER_SOURCES = new Set<FeedTriggerSource>(["scraper", "unknown"]);

/** Post-sale pushes only touch qty/price — skip the 2nd full-catalog validation pass. */
export function skipGalaxusFeedValidationForTrigger(
  triggerSource?: FeedTriggerSource | string | null
): boolean {
  const src = String(triggerSource ?? "").trim();
  return src === "shopify-post-sale" || src === "inventory-sync";
}

/** Skip check-all when stock/offer CSV came from DB snapshot (validated at rebuild time). */
export function skipGalaxusFeedValidationForSnapshotExport(params: {
  stockFromSnapshot?: boolean;
  offerFromSnapshot?: boolean;
  needsMaster?: boolean;
  needsSpecs?: boolean;
}): boolean {
  if (params.needsMaster || params.needsSpecs) return false;
  return Boolean(params.stockFromSnapshot || params.offerFromSnapshot);
}

export function shouldSkipGalaxusFeedCheckAll(params: {
  triggerSource?: FeedTriggerSource | string | null;
  stockFromSnapshot?: boolean;
  offerFromSnapshot?: boolean;
  needsMaster?: boolean;
  needsSpecs?: boolean;
}): boolean {
  if (skipGalaxusFeedValidationForTrigger(params.triggerSource)) return true;
  return skipGalaxusFeedValidationForSnapshotExport(params);
}

export function galaxusFeedPushBlocked(params: {
  scope: FeedScope;
  triggerSource?: FeedTriggerSource;
}): string | null {
  if (!galaxusHeavyFeedsPaused()) return null;
  if (params.scope === "master-specs") {
    return "heavy_feeds_paused:master-specs";
  }
  if (params.triggerSource && HEAVY_TRIGGER_SOURCES.has(params.triggerSource)) {
    return `heavy_feeds_paused:${params.triggerSource}`;
  }
  return null;
}
