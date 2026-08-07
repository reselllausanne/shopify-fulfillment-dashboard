import { recomputeDailyWindow } from "@/healthdata/repository";
import { EXIT_OK, log, withSyncRun } from "@/healthdata/run";
import { prisma } from "@/app/lib/prisma";

export async function normalizeCommand(opts: { days: number }): Promise<number> {
  const to = new Date();
  const from = new Date(to.getTime() - opts.days * 86400_000);
  const fromDate = from.toISOString().slice(0, 10);
  const toDate = to.toISOString().slice(0, 10);

  return withSyncRun(
    "system",
    "normalize",
    { days: opts.days },
    async (run) => {
      const written = await recomputeDailyWindow(fromDate, toDate);
      const raw = await prisma.healthRawProviderEvent.count({
        where: { occurredAt: { gte: from, lte: to } },
      });
      const stats = { rewrittenDays: written, rawInWindow: raw, fromDate, toDate };
      await run.setStats(stats);
      log("normalize_done", stats);
      return stats;
    }
  );
}

export async function statusCommand(): Promise<number> {
  const { getDebugSnapshot } = await import("@/healthdata/repository");
  const snap = await getDebugSnapshot();
  log("status", snap as unknown as Record<string, unknown>);
  return EXIT_OK;
}
