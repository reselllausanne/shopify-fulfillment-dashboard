import { computeBaselines } from "@/healthdata/analytics/baselines";
import { EXIT_OK, log, withSyncRun } from "@/healthdata/run";

export async function baselinesCommand(_opts: { days: number }): Promise<number> {
  return withSyncRun("system", "baselines", _opts, async (run) => {
    const written = await computeBaselines();
    const stats = { baselinesWritten: written };
    await run.setStats(stats);
    log("baselines_done", stats);
    return stats;
  });
}
