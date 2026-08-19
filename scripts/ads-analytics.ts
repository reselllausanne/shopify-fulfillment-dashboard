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
 *   npm run ads -- deep-dive
 *   npm run ads -- sync-spend --days=30
 */
import "dotenv/config";

import { analyzeCommand } from "../adsanalytics/commands/analyze";
import { analyzeModelsCommand } from "../adsanalytics/commands/analyzeModels";
import { authCheckCommand } from "../adsanalytics/commands/authCheck";
import { authHealthCommand } from "../adsanalytics/commands/authHealth";
import { authOauthCommand } from "../adsanalytics/commands/authOauth";
import { backfillCommand } from "../adsanalytics/commands/backfill";
import { comparePeriodsCommand } from "../adsanalytics/commands/comparePeriods";
import { deepDiveCommand } from "../adsanalytics/commands/deepDive";
import { diagnoseCommand } from "../adsanalytics/commands/diagnose";
import { diagnoseAovCommand } from "../adsanalytics/commands/diagnoseAov";
import { diagnoseCvrCommand } from "../adsanalytics/commands/diagnoseCvr";
import { explorerActivateCommand } from "../adsanalytics/commands/explorerActivate";
import { explorerApprovalAuditCommand } from "../adsanalytics/commands/explorerApprovalAudit";
import { explorerAgeBackfillCommand } from "../adsanalytics/commands/explorerAgeBackfill";
import { explorerBatchSupersedeCommand } from "../adsanalytics/commands/explorerBatchSupersede";
import { explorerCampaignCreateCommand } from "../adsanalytics/commands/explorerCampaignCreate";
import { explorerCampaignDiscoverCommand } from "../adsanalytics/commands/explorerCampaignDiscover";
import { explorerCampaignRegisterCommand } from "../adsanalytics/commands/explorerCampaignRegister";
import { explorerCoreExclusionsCommand } from "../adsanalytics/commands/explorerCoreExclusions";
import { explorerCoreExclusionsExtendCommand } from "../adsanalytics/commands/explorerCoreExclusionsExtend";
import { explorerEligibilityDebugCommand } from "../adsanalytics/commands/explorerEligibilityDebug";
import { explorerMerchantApplyCommand } from "../adsanalytics/commands/explorerMerchantApply";
import { explorerMerchantCanaryCommand } from "../adsanalytics/commands/explorerMerchantCanary";
import { explorerMerchantCanaryVerifyCommand } from "../adsanalytics/commands/explorerMerchantCanaryVerify";
import { explorerMerchantPrepareCommand } from "../adsanalytics/commands/explorerMerchantPrepare";
import { explorerMerchantVerifyCommand } from "../adsanalytics/commands/explorerMerchantVerify";
import { explorerMetricsSyncCommand } from "../adsanalytics/commands/explorerMetricsSync";
import { explorerMonitorCommand } from "../adsanalytics/commands/explorerMonitor";
import { explorerOverlapProofCommand } from "../adsanalytics/commands/explorerOverlapProof";
import { explorerPlanCommand } from "../adsanalytics/commands/explorerPlan";
import { explorerPreflightCommand } from "../adsanalytics/commands/explorerPreflight";
import { explorerReconcileCommand } from "../adsanalytics/commands/explorerReconcile";
import { explorerRollbackCommand } from "../adsanalytics/commands/explorerRollback";
import { explorerRoutingDebugCommand } from "../adsanalytics/commands/explorerRoutingDebug";
import { explorerWeeklyPlanCommand } from "../adsanalytics/commands/explorerWeeklyPlan";
import { funnelCommand } from "../adsanalytics/commands/funnel";
import { funnelSnapshotCommand } from "../adsanalytics/commands/funnelSnapshot";
import { inventorySyncCommand } from "../adsanalytics/commands/inventorySync";
import { longTailCampaignActivateCommand } from "../adsanalytics/commands/longTailCampaignActivate";
import { longTailCampaignCreateCommand } from "../adsanalytics/commands/longTailCampaignCreate";
import { merchantAuthCheckCommand } from "../adsanalytics/commands/merchantAuthCheck";
import { merchantAuthExchangeCommand } from "../adsanalytics/commands/merchantAuthExchange";
import { merchantAuthUrlCommand } from "../adsanalytics/commands/merchantAuthUrl";
import { merchantRegisterGcpCommand } from "../adsanalytics/commands/merchantRegisterGcp";
import { merchantSourcesAuditCommand } from "../adsanalytics/commands/merchantSourcesAudit";
import { overlapVerifyCommand } from "../adsanalytics/commands/overlapVerify";
import { pmaxExcludeRoutedLabelsCommand } from "../adsanalytics/commands/pmaxExcludeRoutedLabels";
import { probeCommand } from "../adsanalytics/commands/probe";
import { syncSpendCommand } from "../adsanalytics/commands/syncSpend";
import { validateCommand } from "../adsanalytics/commands/validate";
import { EXIT_FAILED, EXIT_OK, logError } from "../adsanalytics/run";

function usage(): void {
  console.info(`ads-analytics — phase 1 Google Ads POC (read-only)

Commands:
  auth:check                 Verify OAuth + reach the Ads account
  auth:oauth                 One-time browser login → write refresh token to .env
  auth:health                Exercise Ads + Merchant grants, alert when revoked
  probe --days=N             Pull product rows (100k cap), dump sample to tmp/
  backfill --days=N          Month-by-month upsert (no row cap); syncs DailyAdSpend
  backfill --from= --to=     Exact inclusive date window upsert
  sync-spend --days=N        DB-only: ads_campaign_daily → DailyAdSpend
  sync-spend --from= --to=   Exact inclusive window sync
  validate [--days=N]        Diagnostic: product totals vs campaign totals
  analyze --days=N           Offer-level descriptive report
  analyze:models --from= --to=   Model-level (shopify_product_id) report + cohorts
  compare                    Compare current / prior-month / YoY windows
  deep-dive                  Catalogue cohorts + changepoint + PMax channels/settings + cooldown
  deep-dive --skip-live      Same, but skip live Google Ads queries
  inventory:sync             Current shopping_product snapshot + campaign union + settings snapshot
  funnel --days=30 --granularity=model      Inventory/performance funnel (offer|variant|model)
  funnel:snapshot --days=30  Persist daily funnel snapshots for offer/variant/model
  diagnose --days=30         ROAS drop diagnosis + AOV/CVR/CPC bridge + absolute CHF loss ranking
  diagnose:cvr --days=30     CVR Prior vs Current by campaign/device/lang/product-data/action/brand
  diagnose:aov --days=30     AOV Prior vs Current by campaign/brand/model/price-band + Shopify price
  overlap:verify             Listing-group vs shopping_product campaign-scope overlap audit
  merchant:auth-check        Validate Merchant API auth for configured merchant account
  merchant:auth:url          Generate Merchant OAuth consent URL (content scope)
  merchant:auth:exchange     Exchange OAuth code for Merchant refresh token
  merchant:register-gcp --merchant-id=<id> --email=<email>
                             Register current GCP project for Merchant API access
  merchant:sources:audit     Audit Merchant data sources + custom_label_3 usage
  explorer:plan --models=500 --days=30 --seed=pilot-001
                             Build deterministic long-tail explorer batch plan
                             --require-routing-clean --source-campaign=all
                             --require-empty-custom-label-3
  explorer:preflight --batch=<id>
                             Safety preflight before any apply steps
  explorer:eligibility-debug --days=30
                             Waterfall debug for candidate elimination
  explorer:approval-audit --days=30
                             Offer/model approval diagnostics
  explorer:age-backfill --days=30
                             Backfill shopify_product_created_at for candidates
  explorer:routing-debug --batch=<id>
                             Debug listing leaf routing groups for batch offers
  explorer:merchant:prepare --batch=<id> --dry-run
                             Build deterministic Merchant outbox writes plan
  explorer:merchant:canary --batch=<id> [--limit=3]
                             Live canary: insert label, verify, delete, verify revert
  explorer:merchant:canary:verify --batch=<id>
                             Read-only verify: ProductInput deletion + propagation + rule integrity
  explorer:merchant:apply --batch=<id> --confirm=<planHash>
                             Persist Merchant write outbox (live calls blocked this phase)
  explorer:merchant:verify --batch=<id>
                             Verify write-outbox completion gate
  explorer:core-exclusions --batch=<id> --validate-only
                             Build PMax listing-tree exclusion mutation plan
  explorer:core-exclusions --batch=<id> --confirm=<planHash>
                             Confirm exclusion plan (live calls blocked this phase)
  explorer:campaign:create --batch=<id> [--brand=<value>] [--name-suffix=<value>]
                             [--validate-only|--confirm=<planHash>]
                             Build/apply Explorer Standard Shopping campaign create plan.
                             --brand=adidas narrows the listing tree to that product_brand;
                             --name-suffix=Adidas overrides the default "Long Tail" suffix.
  explorer:activate --batch=<id> --confirm=<planHash>
                             Activation gate checks (live enable blocked this phase)
  explorer:monitor --batch=<id>
                             Batch metrics snapshot (concentration/ROAS/exposure)
  explorer:metrics:sync --batch=<id> [--from= --to=] [--skip-ingest]
                             Ingest offer-level Ads metrics and roll them up per model
  explorer:reconcile --batch=<id> [--dry-run] [--skip-ingest] [--force]
                             metric sync → rules → Merchant mutation → readback → DB commit
  explorer:campaign:discover [--role=<role>] [--name=<substring>]
  explorer:campaign:register --role=CORE_ALL|EXPLORER_ALL|LONG_TAIL_ALL --campaign-id=<id> [--force]
                             Bind an existing Ads campaign to a routing role
  longtail:campaign:create [--validate-only|--confirm=<planHash>]
  longtail:campaign:activate [--validate-only|--confirm=<planHash>]
                             Create the persistent Long Tail All shopping campaign (PAUSED)
  explorer:core-exclusions:extend [--label=long_tail_all] [--validate-only|--confirm=<hash>]
                             Add a missing routed-label exclusion to the core campaign
  pmax:exclude-routed-labels --campaign-id=<id> [--labels=explorer_active,long_tail_all]
                             [--validate-only|--confirm=<hash>]
                             Idempotent: subdivide UNIT_INCLUDED leaves + extend CL3 subdivisions
                             so any PMax excludes routed labels (used for brand PMax hardening)
  explorer:overlap:proof     Prove each routed label is targeted by exactly one campaign
  explorer:rollback --batch=<id> --confirm=<planHash>
                             Idempotent rollback state transition (live calls blocked)
  explorer:weekly:plan       Self-serve weekly cycle for source_campaign=all:
                             plan (1000 models, seed=weekly-YYYYWww) → preflight
                             → core-exclusions validate → merchant prepare/apply
                             → activate. Idempotent per ISO week. Reuses the
                             registered EXPLORER_ALL campaign; never creates one.
  explorer:batch:supersede --old-batch=<id> --new-batch=<id>
                             Mark old batch superseded after new plan success

Flags:
  --days=N                   Lookback window
  --from=YYYY-MM-DD --to=YYYY-MM-DD
  --max-rows=N               Cap rows scanned by probe (default 100000)
  --granularity=offer|variant|model
  --force                    Re-fetch settled months on backfill
  --skip-campaigns           Backfill products only
  --skip-products            Backfill campaigns only
  --models=N                 Explorer batch target model count
  --seed=STRING              Deterministic explorer selection seed
  --batch=<uuid>             Explorer batch id
  --dry-run                  Plan only, no writes
  --validate-only            Build mutation plan only
  --confirm=<planHash>       Required hash confirmation for apply/activate/rollback
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
    case "auth:health":
      return authHealthCommand();
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
    case "deep-dive":
      return deepDiveCommand({ skipLive: flag(args, "skip-live") });
    case "inventory:sync":
      return inventorySyncCommand();
    case "funnel":
      return funnelCommand({
        days: intFlag(args, "days", 30),
        granularity: stringFlag(args, "granularity") as "offer" | "variant" | "model" | undefined,
      });
    case "funnel:snapshot":
      return funnelSnapshotCommand({ days: intFlag(args, "days", 30) });
    case "diagnose":
      return diagnoseCommand({ days: intFlag(args, "days", 30) });
    case "diagnose:cvr":
      return diagnoseCvrCommand({ days: intFlag(args, "days", 30) });
    case "diagnose:aov":
      return diagnoseAovCommand({ days: intFlag(args, "days", 30) });
    case "overlap:verify":
      return overlapVerifyCommand();
    case "merchant:auth-check":
      return merchantAuthCheckCommand();
    case "merchant:auth:url":
      return merchantAuthUrlCommand();
    case "merchant:auth:exchange":
      return merchantAuthExchangeCommand({
        code: stringFlag(args, "code"),
        writeEnv: flag(args, "write-env") ? true : undefined,
      });
    case "merchant:sources:audit":
      return merchantSourcesAuditCommand();
    case "merchant:register-gcp":
      return merchantRegisterGcpCommand({
        merchantId: stringFlag(args, "merchant-id"),
        email: stringFlag(args, "email"),
      });
    case "explorer:plan":
      return explorerPlanCommand({
        models: intFlag(args, "models", 500),
        days: intFlag(args, "days", 30),
        seed: stringFlag(args, "seed"),
        requireRoutingClean: flag(args, "require-routing-clean"),
        sourceCampaignName: stringFlag(args, "source-campaign"),
        requireEmptyCustomLabel3: flag(args, "require-empty-custom-label-3"),
        abortForbiddenBrands: !flag(args, "allow-forbidden-brands"),
      });
    case "explorer:preflight":
      return explorerPreflightCommand({ batch: stringFlag(args, "batch") });
    case "explorer:eligibility-debug":
      return explorerEligibilityDebugCommand({ days: intFlag(args, "days", 30) });
    case "explorer:approval-audit":
      return explorerApprovalAuditCommand({ days: intFlag(args, "days", 30) });
    case "explorer:age-backfill":
      return explorerAgeBackfillCommand({ days: intFlag(args, "days", 30) });
    case "explorer:routing-debug":
      return explorerRoutingDebugCommand({ batch: stringFlag(args, "batch") });
    case "explorer:merchant:prepare":
      return explorerMerchantPrepareCommand({
        batch: stringFlag(args, "batch"),
        dryRun: flag(args, "dry-run") ? true : undefined,
      });
    case "explorer:merchant:canary":
      return explorerMerchantCanaryCommand({
        batch: stringFlag(args, "batch"),
        limit: intFlag(args, "limit", 3),
      });
    case "explorer:merchant:canary:verify":
      return explorerMerchantCanaryVerifyCommand({
        batch: stringFlag(args, "batch"),
      });
    case "explorer:merchant:apply":
      return explorerMerchantApplyCommand({
        batch: stringFlag(args, "batch"),
        confirm: stringFlag(args, "confirm"),
      });
    case "explorer:merchant:verify":
      return explorerMerchantVerifyCommand({ batch: stringFlag(args, "batch") });
    case "explorer:core-exclusions":
      return explorerCoreExclusionsCommand({
        batch: stringFlag(args, "batch"),
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
        allowOnlySourceCampaignName: stringFlag(args, "allow-only-source-campaign"),
        allowForbiddenBrands: flag(args, "allow-forbidden-brands") ? true : undefined,
      });
    case "explorer:campaign:create":
      return explorerCampaignCreateCommand({
        batch: stringFlag(args, "batch"),
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
        brand: stringFlag(args, "brand"),
        nameSuffix: stringFlag(args, "name-suffix"),
      });
    case "explorer:activate":
      return explorerActivateCommand({
        batch: stringFlag(args, "batch"),
        confirm: stringFlag(args, "confirm"),
      });
    case "explorer:monitor":
      return explorerMonitorCommand({ batch: stringFlag(args, "batch") });
    case "explorer:metrics:sync":
      return explorerMetricsSyncCommand({
        batch: stringFlag(args, "batch"),
        from: stringFlag(args, "from"),
        to: stringFlag(args, "to"),
        skipIngest: flag(args, "skip-ingest") ? true : undefined,
      });
    case "explorer:reconcile":
      return explorerReconcileCommand({
        batch: stringFlag(args, "batch"),
        dryRun: flag(args, "dry-run") ? true : undefined,
        skipIngest: flag(args, "skip-ingest") ? true : undefined,
        force: flag(args, "force") ? true : undefined,
        maxTransitions: stringFlag(args, "max-transitions")
          ? intFlag(args, "max-transitions", 0)
          : undefined,
      });
    case "explorer:campaign:discover":
      return explorerCampaignDiscoverCommand({
        role: stringFlag(args, "role"),
        name: stringFlag(args, "name"),
      });
    case "explorer:campaign:register":
      return explorerCampaignRegisterCommand({
        role: stringFlag(args, "role"),
        campaignId: stringFlag(args, "campaign-id"),
        force: flag(args, "force") ? true : undefined,
      });
    case "longtail:campaign:create":
      return longTailCampaignCreateCommand({
        budgetMicros: stringFlag(args, "budget-micros")
          ? intFlag(args, "budget-micros", 0)
          : undefined,
        maxCpcMicros: stringFlag(args, "max-cpc-micros")
          ? intFlag(args, "max-cpc-micros", 0)
          : undefined,
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
      });
    case "longtail:campaign:activate":
      return longTailCampaignActivateCommand({
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
      });
    case "pmax:exclude-routed-labels":
      return pmaxExcludeRoutedLabelsCommand({
        campaignId: stringFlag(args, "campaign-id"),
        labels: stringFlag(args, "labels"),
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
      });
    case "explorer:core-exclusions:extend":
      return explorerCoreExclusionsExtendCommand({
        label: stringFlag(args, "label"),
        batch: stringFlag(args, "batch"),
        validateOnly: flag(args, "validate-only") || !stringFlag(args, "confirm"),
        confirm: stringFlag(args, "confirm"),
      });
    case "explorer:overlap:proof":
      return explorerOverlapProofCommand({
        eligibleOnly: flag(args, "all-offers") ? false : undefined,
      });
    case "explorer:rollback":
      return explorerRollbackCommand({
        batch: stringFlag(args, "batch"),
        confirm: stringFlag(args, "confirm"),
      });
    case "explorer:weekly:plan":
      return explorerWeeklyPlanCommand();
    case "explorer:batch:supersede":
      return explorerBatchSupersedeCommand({
        oldBatch: stringFlag(args, "old-batch"),
        newBatch: stringFlag(args, "new-batch"),
      });
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
