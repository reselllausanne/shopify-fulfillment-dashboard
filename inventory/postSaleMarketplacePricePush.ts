import { resolveAppOriginForPartnerJobs } from "@/app/lib/partnerJobOrigin";
import { runDecathlonPriceSync } from "@/decathlon/mirakl/sync";
import { startFeedPushAsync } from "@/galaxus/ops/feedPipeline";

/** Coalesce bursts (multi-line orders, 5-min cron batch) into one marketplace price push. */
const DEBOUNCE_MS = 30_000;

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let debounceOrigin: string | null = null;

export type PostSalePricePushResult = {
  galaxus?: {
    ok: boolean;
    accepted?: boolean;
    queued?: boolean;
    runId?: string;
    triggerId?: string;
    error?: string;
    status?: number;
  };
  decathlon?: { ok: boolean; error?: string };
};

/**
 * Fire-and-forget Galaxus PriceData + Decathlon PRI01 after a sale refreshed DB prices.
 * Debounced so webhook + cron do not stampede SFTP/Mirakl.
 */
export function schedulePostSaleMarketplacePricePush(origin?: string | null): void {
  const resolved = resolveAppOriginForPartnerJobs(origin);
  if (resolved) debounceOrigin = resolved;

  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    const appOrigin = debounceOrigin ?? resolveAppOriginForPartnerJobs(null) ?? "http://127.0.0.1:3000";
    debounceOrigin = null;
    void runPostSaleMarketplacePricePush(appOrigin).catch((err) => {
      console.error("[post-sale][price-push] unhandled", err);
    });
  }, DEBOUNCE_MS);
}

/** Immediate push (tests / manual). Prefer {@link schedulePostSaleMarketplacePricePush} in production. */
export async function runPostSaleMarketplacePricePush(
  origin?: string | null
): Promise<PostSalePricePushResult> {
  const appOrigin = resolveAppOriginForPartnerJobs(origin) ?? "http://127.0.0.1:3000";
  const out: PostSalePricePushResult = {};

  try {
    out.galaxus = await startFeedPushAsync({
      origin: appOrigin,
      scope: "price",
      triggerSource: "shopify-post-sale",
    });
    if (out.galaxus.queued) {
      console.info("[post-sale][price-push] Galaxus price push queued — will run when feed idle", {
        triggerId: out.galaxus.triggerId,
        activeRunId: out.galaxus.runId,
      });
    } else if (!out.galaxus.ok) {
      console.warn("[post-sale][price-push] Galaxus price push failed", out.galaxus);
    } else {
      console.info("[post-sale][price-push] Galaxus price push accepted", {
        runId: out.galaxus.runId,
      });
    }
  } catch (err: any) {
    out.galaxus = { ok: false, error: err?.message ?? String(err) };
    console.error("[post-sale][price-push] Galaxus error", err);
  }

  try {
    await runDecathlonPriceSync();
    out.decathlon = { ok: true };
    console.info("[post-sale][price-push] Decathlon PRI01 price sync done");
  } catch (err: any) {
    out.decathlon = { ok: false, error: err?.message ?? String(err) };
    console.error("[post-sale][price-push] Decathlon error", err);
  }

  return out;
}

/** @internal test helper */
export function resetPostSalePricePushDebounceForTests(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = null;
  debounceOrigin = null;
}
