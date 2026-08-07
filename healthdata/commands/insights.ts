import { generateInsights } from "@/healthdata/analytics/insights";
import { withSyncRun } from "@/healthdata/run";

export async function insightsCommand(): Promise<number> {
  return withSyncRun("system", "insights", {}, async (run) => {
    const drafts = await generateInsights();
    const stats = {
      generated: drafts.length,
      keys: drafts.map((d) => d.insightKey),
    };
    await run.setStats(stats);
    return stats;
  });
}
