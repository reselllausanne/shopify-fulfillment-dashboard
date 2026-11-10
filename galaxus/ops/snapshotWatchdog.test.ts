import { beforeEach, describe, expect, it, vi } from "vitest";

const isReady = vi.fn();
const getMeta = vi.fn();
const startRebuild = vi.fn();
const findMany = vi.fn();

vi.mock("@/galaxus/exports/feedSnapshot", () => ({
  FEED_SNAPSHOT_REBUILD_JOB: "ops-feed-snapshot-rebuild",
  isFeedSnapshotReady: (...a: unknown[]) => isReady(...a),
  getFeedSnapshotMeta: (...a: unknown[]) => getMeta(...a),
  startFeedSnapshotRebuildAsync: (...a: unknown[]) => startRebuild(...a),
}));
vi.mock("@/app/lib/prisma", () => ({
  prisma: { galaxusJobRun: { findMany: (...a: unknown[]) => findMany(...a) } },
}));

import {
  __resetSnapshotWatchdogThrottle,
  ensureFeedSnapshotRebuild,
} from "@/galaxus/ops/snapshotWatchdog";

const NOW = Date.UTC(2026, 10, 10, 21, 0, 0);
const MIN = 60_000;
const ago = (ms: number) => new Date(NOW - ms);

describe("ensureFeedSnapshotRebuild", () => {
  beforeEach(() => {
    isReady.mockReset().mockResolvedValue(false);
    getMeta.mockReset().mockResolvedValue({ updatedAt: ago(2 * 60 * MIN) });
    startRebuild.mockReset().mockResolvedValue({ ok: true, accepted: true });
    findMany.mockReset().mockResolvedValue([]);
    __resetSnapshotWatchdogThrottle();
  });

  it("does nothing when snapshot is ready", async () => {
    isReady.mockResolvedValue(true);
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "skipped", reason: "snapshot_ready" });
    expect(startRebuild).not.toHaveBeenCalled();
  });

  it("enqueues a rebuild when invalid and idle", async () => {
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "enqueued" });
    expect(startRebuild).toHaveBeenCalledWith("o");
  });

  it("waits during the grace window after invalidation", async () => {
    getMeta.mockResolvedValue({ updatedAt: ago(5 * MIN) });
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "skipped", reason: "grace" });
    expect(startRebuild).not.toHaveBeenCalled();
  });

  it("does not start while a rebuild is in flight (finishedAt == startedAt)", async () => {
    const t = ago(90 * MIN);
    findMany.mockResolvedValue([{ startedAt: t, finishedAt: t }]);
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "skipped", reason: "rebuild_in_flight" });
    expect(startRebuild).not.toHaveBeenCalled();
  });

  it("does not retry right after a failed attempt", async () => {
    findMany.mockResolvedValue([{ startedAt: ago(10 * MIN), finishedAt: ago(5 * MIN) }]);
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "skipped", reason: "recent_attempt" });
  });

  it("retries after a failed attempt older than the retry delay", async () => {
    findMany.mockResolvedValue([{ startedAt: ago(5 * 60 * MIN), finishedAt: ago(4 * 60 * MIN) }]);
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "enqueued" });
  });

  it("caps attempts per 24h", async () => {
    findMany.mockResolvedValue(
      [1, 2, 3, 4].map((h) => ({ startedAt: ago((h + 1) * 60 * MIN), finishedAt: ago(h * 60 * MIN) }))
    );
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "skipped", reason: "daily_cap" });
    expect(startRebuild).not.toHaveBeenCalled();
  });

  it("reports a refused enqueue (already queued) without throwing", async () => {
    startRebuild.mockResolvedValue({ ok: false, error: "already running", status: 409 });
    const res = await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(res).toEqual({ action: "enqueue_refused", error: "already running" });
  });

  it("is throttled between checks unless forced", async () => {
    isReady.mockResolvedValue(true);
    await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW });
    expect(await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW + 1000 })).toEqual({
      action: "skipped",
      reason: "throttled",
    });
    expect(await ensureFeedSnapshotRebuild({ origin: "o", nowMs: NOW + 1000, force: true })).toEqual({
      action: "skipped",
      reason: "snapshot_ready",
    });
  });
});
