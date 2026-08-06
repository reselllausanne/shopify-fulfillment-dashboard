#!/usr/bin/env npx tsx
/**
 * Phase 1 Google Ads analytics CLI.
 *
 * Usage:
 *   npm run ads -- auth:check
 *   npm run ads -- probe --days=30
 *   npm run ads -- backfill --days=30
 *   npm run ads -- backfill --from=2026-06-06 --to=2026-07-05
 *   npm run ads -- validate --days=30
 *   npm run ads -- analyze --days=30
 *   npm run ads -- analyze:models --from=2026-07-06 --to=2026-08-04
 *   npm run ads -- compare
 *   npm run ads -- sync-spend --days=30
 */
import "dotenv/config";

import { analyzeCommand } from "../adsanalytics/commands/analyze";
import { analyzeModelsCommand } from "../adsanalytics/commands/analyzeModels";
import { authCheckCommand } from "../adsanalytics/commands/authCheck";
import { authOauthCommand } from "../adsanalytics/commands/authOauth";
import { backfillCommand } from "../adsanalytics/commands/backfill";
import { comparePeriodsCommand } from "../adsanalytics/commands/comparePeriods";
import { probeCommand } from "../adsanalytics/commands/probe";
import { syncSpendCommand } from "../adsanalytics/commands/syncSpend";
import { validateCommand } from "../adsanalytics/commands/validate";
import { EXIT_FAILED, EXIT_OK, logError } from "../adsanalytics/run";

function usage(): void {
  console.info(`ads-analytics — phase 1 Google Ads POC (read-only)

Commands:
  auth:check                 Verify OAuth + reach the Ads account
  auth:oauth                 One-time browser login → write refresh token to .env
  probe --days=N             Pull product rows (100k cap), dump sample to tmp/
  backfill --days=N          Month-by-month upsert (no row cap); syncs DailyAdSpend
  backfill --from= --to=     Exact inclusive date window upsert
  sync-spend --days=N        DB-only: ads_campaign_daily → DailyAdSpend
  sync-spend --from= --to=   Exact inclusive window sync
  validate [--days=N]        Diagnostic: product totals vs campaign totals
  analyze --days=N           Offer-level descriptive report
  analyze:models --from= --to=   Model-level (shopify_product_id) report + cohorts
  compare                    Compare current / prior-month / YoY windows

Flags:
  --days=N                   Lookback window
  --from=YYYY-MM-DD --to=YYYY-MM-DD
  --max-rows=N               Cap rows scanned by probe (default 100000)
  --force                    Re-fetch settled months on backfill
  --skip-campaigns           Backfill products only
  --skip-products            Backfill campaigns only
`);
}

function flag(args: string[], name: string): boolean {
  return args.includes(`--${name}`);
}

function intFlag(args: string[], name: string, fallback: number): number {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  if (!hit) return fallback;
  const value = Number(hit.slice(prefix.length));
  if (!Number.isFinite(value) || value < 1) {
    throw new Error(`Invalid --${name}=${hit.slice(prefix.length)}`);
  }
  return Math.floor(value);
}

function stringFlag(args: string[], name: string): string | undefined {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : undefined;
}

async function main(): Promise<number> {
  const [, , command, ...args] = process.argv;

  if (!command || command === "help" || command === "--help" || command === "-h") {
    usage();
    return EXIT_OK;
  }

  switch (command) {
    case "auth:check":
      return authCheckCommand();
    case "auth:oauth":
      return authOauthCommand();
    case "probe":
      return probeCommand({
        days: intFlag(args, "days", 30),
        maxRows: intFlag(args, "max-rows", 100_000),
      });
    case "backfill":
      return backfillCommand({
        days: stringFlag(args, "from") ? undefined : intFlag(args, "days", 30),
        from: stringFlag(args, "from"),
        to: stringFlag(args, "to"),
        force: flag(args, "force"),
        skipCampaigns: flag(args, "skip-campaigns"),
        skipProducts: flag(args, "skip-products"),
      });
    case "validate":
      return validateCommand({ days: intFlag(args, "days", 30) });
    case "analyze":
      return analyzeCommand({ days: intFlag(args, "days", 30) });
    case "analyze:models":
      return analyzeModelsCommand({
        from: stringFlag(args, "from"),
        to: stringFlag(args, "to"),
        days: stringFlag(args, "from") ? undefined : intFlag(args, "days", 30),
      });
    case "compare":
      return comparePeriodsCommand();
    case "sync-spend":
      return syncSpendCommand({
        days: stringFlag(args, "from") ? undefined : intFlag(args, "days", 30),
        from: stringFlag(args, "from"),
        to: stringFlag(args, "to"),
      });
    default:
      logError("cli.unknown_command", { command });
      usage();
      return EXIT_FAILED;
  }
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err) => {
    logError("cli.fatal", {
      message: err instanceof Error ? err.message : String(err),
    });
    process.exitCode = EXIT_FAILED;
  });
