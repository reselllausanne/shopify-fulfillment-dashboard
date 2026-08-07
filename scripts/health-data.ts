#!/usr/bin/env npx tsx
/**
 * Personal health data CLI (Garmin mock → WHOOP).
 *
 * Usage:
 *   npm run health -- auth:check
 *   npm run health -- backfill --days=90 --provider=mock_garmin
 *   npm run health -- sync --provider=mock_garmin
 *   npm run health -- normalize --days=90
 *   npm run health -- status
 *   npm run health -- baselines --days=42
 *   npm run health -- insights
 */
import "dotenv/config";

import { authCheckCommand } from "../healthdata/commands/authCheck";
import { backfillCommand } from "../healthdata/commands/backfill";
import { normalizeCommand, statusCommand } from "../healthdata/commands/normalize";
import { syncCommand } from "../healthdata/commands/sync";
import { baselinesCommand } from "../healthdata/commands/baselines";
import { insightsCommand } from "../healthdata/commands/insights";
import { EXIT_FAILED, EXIT_OK, logError } from "../healthdata/run";

function usage(): void {
  console.info(`health-data — personal triathlon / recovery POC

Commands:
  auth:check                 Config + connected accounts + capabilities
  backfill --days=N          Raw + normalize backfill (default mock_garmin)
  sync                       Incremental sync from watermark
  normalize --days=N         Recompute daily metrics window
  status                     Debug snapshot (runs, counts, coverage)
  baselines --days=N         Compute personal baselines (7/28/42)
  insights                   Generate explainable rule insights

Flags:
  --days=N
  --provider=mock_garmin|garmin|whoop
  --account-id=UUID
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
    case "backfill": {
      const provider = stringFlag(args, "provider");
      // WHOOP default short (new device); mock/garmin keep longer fixture window.
      const defaultDays = provider === "whoop" ? 7 : 90;
      return backfillCommand({
        days: intFlag(args, "days", defaultDays),
        provider,
        accountId: stringFlag(args, "account-id"),
      });
    }
    case "sync":
      return syncCommand({
        provider: stringFlag(args, "provider"),
        accountId: stringFlag(args, "account-id"),
        lookbackDays: intFlag(args, "days", 3),
      });
    case "normalize":
      return normalizeCommand({ days: intFlag(args, "days", 90) });
    case "status":
      return statusCommand();
    case "baselines":
      return baselinesCommand({ days: intFlag(args, "days", 42) });
    case "insights":
      return insightsCommand();
    default:
      usage();
      logError("unknown_command", { command, help: flag(args, "help") });
      return EXIT_FAILED;
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    logError("fatal", { error: err instanceof Error ? err.message : String(err) });
    process.exit(EXIT_FAILED);
  });
