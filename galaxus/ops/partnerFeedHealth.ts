import { prisma } from "@/app/lib/prisma";
import { notifyPartnerFeedImportStale } from "@/galaxus/ops/feedFailureAlert";

const HOUR_MS = 3600 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** A partner feed counts as "stale" once its last SUCCESSFUL import is older than this. */
export const PARTNER_FEED_STALE_MS =
  Number(process.env.GALAXUS_PARTNER_FEED_STALE_MS ?? 2 * DAY_MS) || 2 * DAY_MS;

/**
 * Only alert feeds that are still active (uploaded something within this window). Avoids nagging
 * about intentionally-retired partners whose last success is naturally old. Default 4 days, so a
 * partner uploading daily but failing for 2 days still registers as active.
 */
export const PARTNER_FEED_ACTIVE_WINDOW_MS =
  Number(process.env.GALAXUS_PARTNER_FEED_ACTIVE_WINDOW_MS ?? 4 * DAY_MS) || 4 * DAY_MS;

const COMPLETED_STATUSES = ["COMPLETED", "COMPLETED_WITH_ERRORS"];

export type PartnerFeedLastImport = {
  partnerId: string;
  partnerName: string | null;
  partnerKey: string | null;
  /** Most recent successful (COMPLETED / COMPLETED_WITH_ERRORS) upload. */
  lastCompletedAt: Date | string | null;
  /** Most recent upload of ANY status (used to tell active feeds from retired ones). */
  lastAttemptAt: Date | string | null;
};

export type PartnerFeedStaleResult = {
  partnerId: string;
  partnerKey: string | null;
  partnerName: string | null;
  lastCompletedAt: string | null;
  hoursSinceSuccess: number | null;
};

function toMs(value: Date | string | null): number | null {
  if (!value) return null;
  const t = new Date(value).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Pure: which active partner feeds have gone too long without a successful import. */
export function evaluatePartnerFeedStaleness(
  rows: PartnerFeedLastImport[],
  nowMs: number,
  thresholdMs: number = PARTNER_FEED_STALE_MS,
  activeWindowMs: number = PARTNER_FEED_ACTIVE_WINDOW_MS
): PartnerFeedStaleResult[] {
  const stale: PartnerFeedStaleResult[] = [];
  for (const r of rows) {
    const attemptMs = toMs(r.lastAttemptAt);
    // Inactive feed (no recent upload at all) → not our problem to alert on.
    if (attemptMs == null || nowMs - attemptMs > activeWindowMs) continue;
    const completedMs = toMs(r.lastCompletedAt);
    const ageMs = completedMs == null ? Number.POSITIVE_INFINITY : nowMs - completedMs;
    if (ageMs > thresholdMs) {
      stale.push({
        partnerId: r.partnerId,
        partnerKey: r.partnerKey,
        partnerName: r.partnerName,
        lastCompletedAt: completedMs == null ? null : new Date(completedMs).toISOString(),
        hoursSinceSuccess:
          completedMs == null ? null : Math.round((ageMs / HOUR_MS) * 10) / 10,
      });
    }
  }
  return stale;
}

/**
 * Detect partner feeds that are still uploading but failing to import, and alert (Slack + email).
 * Wired into the ops tick so a silent import outage surfaces within ~one tick of crossing 2 days.
 */
export async function checkPartnerFeedImportHealth(
  nowMs: number = Date.now()
): Promise<{ stale: PartnerFeedStaleResult[] }> {
  const prismaAny = prisma as any;
  const partners: Array<{ id: string; name: string | null; key: string | null }> =
    await prismaAny.partner.findMany({ select: { id: true, name: true, key: true } });

  const rows: PartnerFeedLastImport[] = [];
  for (const p of partners) {
    const [lastCompleted, lastAttempt] = await Promise.all([
      prismaAny.partnerUpload.findFirst({
        where: { partnerId: p.id, status: { in: COMPLETED_STATUSES } },
        orderBy: { updatedAt: "desc" },
        select: { updatedAt: true },
      }),
      prismaAny.partnerUpload.findFirst({
        where: { partnerId: p.id },
        orderBy: { createdAt: "desc" },
        select: { createdAt: true },
      }),
    ]);
    rows.push({
      partnerId: p.id,
      partnerName: p.name ?? null,
      partnerKey: p.key ?? null,
      lastCompletedAt: lastCompleted?.updatedAt ?? null,
      lastAttemptAt: lastAttempt?.createdAt ?? null,
    });
  }

  const stale = evaluatePartnerFeedStaleness(rows, nowMs);
  for (const s of stale) {
    await notifyPartnerFeedImportStale({
      partnerKey: s.partnerKey,
      partnerName: s.partnerName,
      lastCompletedAt: s.lastCompletedAt,
      hoursSinceSuccess: s.hoursSinceSuccess,
    });
  }
  return { stale };
}
