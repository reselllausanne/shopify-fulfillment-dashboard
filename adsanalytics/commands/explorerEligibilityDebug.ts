import { computeExplorerEligibilityDebug, writeExplorerReport } from "@/adsanalytics/explorer/core";
import { log, withSyncRun } from "@/adsanalytics/run";

type ExplorerEligibilityDebugOptions = { days?: number };

export async function explorerEligibilityDebugCommand(
  options: ExplorerEligibilityDebugOptions = {}
): Promise<number> {
  return withSyncRun("explorer:eligibility-debug", options, async () => {
    const days = Math.max(7, Math.floor(options.days ?? 30));
    const report = await computeExplorerEligibilityDebug(days);
    const stamp = new Date().toISOString().slice(0, 10);
    const outPath = await writeExplorerReport(`explorer-eligibility-debug-${stamp}.json`, report);
    log("explorer_eligibility_debug.summary", {
      days,
      finalCandidates: report.finalCandidates.length,
      zeroImpressionFromInventory: report.zeroImpressionFromInventory,
      knownReferenceZeroImpression: report.knownReferenceZeroImpression,
      campaignSourceCountDistribution: report.campaignSourceCountDistribution,
      reportPath: outPath,
    });
    return {
      days,
      finalCandidates: report.finalCandidates.length,
      zeroImpressionFromInventory: report.zeroImpressionFromInventory,
      reportPath: outPath,
    };
  });
}

