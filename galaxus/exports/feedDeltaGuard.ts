/**
 * Pre-publish Galaxus feed delta report + mass-exclusion guardrail.
 *
 * Compares previous successful run positive-stock / offer counts to the
 * candidate CSV about to upload. Blocks publish when drop exceeds threshold.
 */

export type FeedDeltaExclusion = {
  providerKey: string;
  supplier: string;
  reason: string;
  detail?: string;
};

export type FeedDeltaLaneChange = {
  providerKey: string;
  supplier: string;
  from: string;
  to: string;
};

export type FeedDeltaReport = {
  dryRun: boolean;
  generatedAt: string;
  previous: {
    stockRows: number | null;
    offerRows: number | null;
    positiveStockRows: number | null;
  };
  next: {
    stockRows: number;
    offerRows: number;
    positiveStockRows: number;
  };
  added: number;
  updated: number;
  removedOrExcluded: number;
  expressToStandard: number;
  exclusionsByReason: Record<string, number>;
  exclusionsBySupplier: Record<string, number>;
  sampleExclusions: FeedDeltaExclusion[];
  sampleExpressToStandard: FeedDeltaLaneChange[];
  guard: {
    blocked: boolean;
    thresholdAbs: number;
    thresholdPct: number;
    positiveStockDrop: number;
    positiveStockDropPct: number;
    message?: string;
  };
};

export type FeedDeltaGuardConfig = {
  /** Absolute max positive-stock rows that may disappear in one run. */
  maxPositiveStockDropAbs: number;
  /** Relative max drop vs previous positive stock (0–1). */
  maxPositiveStockDropPct: number;
};

/** Defaults: block if >15k positive rows vanish OR >8% of previous positive stock. */
export function readFeedDeltaGuardConfig(
  env: NodeJS.ProcessEnv = process.env
): FeedDeltaGuardConfig {
  const absRaw = Number.parseInt(String(env.GALAXUS_FEED_MAX_POSITIVE_DROP_ABS ?? "15000"), 10);
  const pctRaw = Number.parseFloat(String(env.GALAXUS_FEED_MAX_POSITIVE_DROP_PCT ?? "0.08"));
  return {
    maxPositiveStockDropAbs: Number.isFinite(absRaw) && absRaw > 0 ? absRaw : 15000,
    maxPositiveStockDropPct:
      Number.isFinite(pctRaw) && pctRaw > 0 && pctRaw <= 1 ? pctRaw : 0.08,
  };
}

export function buildFeedDeltaReport(input: {
  dryRun: boolean;
  previousStockRows: number | null;
  previousOfferRows: number | null;
  previousPositiveStockRows: number | null;
  nextStockRows: number;
  nextOfferRows: number;
  nextPositiveStockRows: number;
  added?: number;
  updated?: number;
  expressToStandard?: number;
  exclusions?: FeedDeltaExclusion[];
  laneChanges?: FeedDeltaLaneChange[];
  config?: FeedDeltaGuardConfig;
}): FeedDeltaReport {
  const config = input.config ?? readFeedDeltaGuardConfig();
  const exclusions = input.exclusions ?? [];
  const laneChanges = input.laneChanges ?? [];

  const exclusionsByReason: Record<string, number> = {};
  const exclusionsBySupplier: Record<string, number> = {};
  for (const row of exclusions) {
    exclusionsByReason[row.reason] = (exclusionsByReason[row.reason] ?? 0) + 1;
    exclusionsBySupplier[row.supplier] = (exclusionsBySupplier[row.supplier] ?? 0) + 1;
  }

  const prevPos = input.previousPositiveStockRows;
  const positiveStockDrop =
    prevPos != null ? Math.max(0, prevPos - input.nextPositiveStockRows) : 0;
  const positiveStockDropPct =
    prevPos != null && prevPos > 0 ? positiveStockDrop / prevPos : 0;

  const blocked =
    prevPos != null &&
    prevPos > 0 &&
    (positiveStockDrop >= config.maxPositiveStockDropAbs ||
      positiveStockDropPct >= config.maxPositiveStockDropPct);

  const removedOrExcluded =
    exclusions.length > 0
      ? exclusions.length
      : prevPos != null
        ? positiveStockDrop
        : 0;

  return {
    dryRun: input.dryRun,
    generatedAt: new Date().toISOString(),
    previous: {
      stockRows: input.previousStockRows,
      offerRows: input.previousOfferRows,
      positiveStockRows: input.previousPositiveStockRows,
    },
    next: {
      stockRows: input.nextStockRows,
      offerRows: input.nextOfferRows,
      positiveStockRows: input.nextPositiveStockRows,
    },
    added: input.added ?? Math.max(0, input.nextStockRows - (input.previousStockRows ?? 0)),
    updated: input.updated ?? 0,
    removedOrExcluded,
    expressToStandard: input.expressToStandard ?? laneChanges.length,
    exclusionsByReason,
    exclusionsBySupplier,
    sampleExclusions: exclusions.slice(0, 25),
    sampleExpressToStandard: laneChanges.slice(0, 25),
    guard: {
      blocked,
      thresholdAbs: config.maxPositiveStockDropAbs,
      thresholdPct: config.maxPositiveStockDropPct,
      positiveStockDrop,
      positiveStockDropPct: Number(positiveStockDropPct.toFixed(4)),
      message: blocked
        ? `Blocked publish: positive-stock drop ${positiveStockDrop} (${(
            positiveStockDropPct * 100
          ).toFixed(1)}%) exceeds abs=${config.maxPositiveStockDropAbs} or pct=${(
            config.maxPositiveStockDropPct * 100
          ).toFixed(1)}%`
        : undefined,
    },
  };
}

export function formatFeedDeltaReportText(report: FeedDeltaReport): string {
  const lines: string[] = [];
  lines.push(`Galaxus feed delta ${report.dryRun ? "(DRY-RUN)" : "(LIVE)"} @ ${report.generatedAt}`);
  lines.push(
    `stock rows: ${report.previous.stockRows ?? "?"} → ${report.next.stockRows} | ` +
      `positive: ${report.previous.positiveStockRows ?? "?"} → ${report.next.positiveStockRows}`
  );
  lines.push(
    `offer rows: ${report.previous.offerRows ?? "?"} → ${report.next.offerRows}`
  );
  lines.push(
    `added=${report.added} updated=${report.updated} removed/excluded=${report.removedOrExcluded} express→standard=${report.expressToStandard}`
  );
  lines.push(
    `guard: blocked=${report.guard.blocked} drop=${report.guard.positiveStockDrop} ` +
      `(${(report.guard.positiveStockDropPct * 100).toFixed(2)}%) ` +
      `thresholds abs=${report.guard.thresholdAbs} pct=${(report.guard.thresholdPct * 100).toFixed(1)}%`
  );
  if (report.guard.message) lines.push(`GUARD: ${report.guard.message}`);

  const reasons = Object.entries(report.exclusionsByReason).sort((a, b) => b[1] - a[1]);
  if (reasons.length) {
    lines.push("exclusions by reason:");
    for (const [reason, n] of reasons) lines.push(`  ${reason}: ${n}`);
  }
  const suppliers = Object.entries(report.exclusionsBySupplier).sort((a, b) => b[1] - a[1]);
  if (suppliers.length) {
    lines.push("exclusions by supplier:");
    for (const [supplier, n] of suppliers.slice(0, 20)) lines.push(`  ${supplier}: ${n}`);
  }
  if (report.sampleExpressToStandard.length) {
    lines.push("sample express→standard:");
    for (const row of report.sampleExpressToStandard.slice(0, 10)) {
      lines.push(`  ${row.providerKey} ${row.from}→${row.to}`);
    }
  }
  if (report.sampleExclusions.length) {
    lines.push("sample exclusions:");
    for (const row of report.sampleExclusions.slice(0, 10)) {
      lines.push(`  ${row.providerKey} [${row.reason}] ${row.detail ?? ""}`);
    }
  }
  return lines.join("\n");
}

/** Count CSV data rows whose QuantityOnStock column is > 0. */
export function countPositiveStockCsvRows(csv: string | Buffer): number {
  const text = Buffer.isBuffer(csv) ? csv.toString("utf8") : csv;
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length <= 1) return 0;
  const header = lines[0]!.split(",").map((h) => h.replace(/^"|"$/g, "").trim());
  const qtyIdx = header.findIndex((h) => h === "QuantityOnStock");
  if (qtyIdx < 0) return Math.max(0, lines.length - 1);
  let n = 0;
  for (let i = 1; i < lines.length; i += 1) {
    const cols = lines[i]!.split(",");
    const raw = (cols[qtyIdx] ?? "").replace(/^"|"$/g, "").trim();
    const qty = Number.parseInt(raw, 10);
    if (Number.isFinite(qty) && qty > 0) n += 1;
  }
  return n;
}
