#!/usr/bin/env npx tsx
/**
 * Create (or reuse) Google Ads Secondary UPLOAD_CLICKS action for G4 shadow.
 *
 *   npx tsx scripts/tracking-create-secondary-action.ts              # dry / list
 *   npx tsx scripts/tracking-create-secondary-action.ts --create     # create if missing
 *
 * Safe defaults: primaryForGoal=false, category=PURCHASE, counting=ONE_PER_CLICK.
 * Does NOT enable TRACKING_GOOGLE_ADS_SECONDARY_* env / uploads.
 */
import "dotenv/config";

import { resolveAdsConfig } from "../adsanalytics/config";
import { mutateResource, searchAll } from "../adsanalytics/google/adsClient";
import {
  validateSecondaryAction,
  type ConversionActionCheck,
} from "../tracking/adapters/googleAdsSecondary";
import { isProductionId } from "../tracking/guards";

const ACTION_NAME = "TEST purchase (shadow)";

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
  if (!hit) return undefined;
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true";
}

function asCheck(c: Record<string, unknown>): ConversionActionCheck {
  return {
    id: String(c.id ?? ""),
    name: String(c.name ?? ""),
    status: String(c.status ?? ""),
    type: String(c.type ?? ""),
    primaryForGoal: c.primaryForGoal === true,
    includeInConversionsMetric: c.includeInConversionsMetric === true,
  };
}

async function loadByName(name: string) {
  const cfg = resolveAdsConfig();
  const { rows } = await searchAll(
    cfg,
    `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.category,
      conversion_action.primary_for_goal,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
    WHERE conversion_action.name = '${name.replace(/'/g, "\\'")}'
      AND conversion_action.status != 'REMOVED'
    `,
  );
  return rows.map((r) => asCheck((r.conversionAction ?? {}) as Record<string, unknown>));
}

async function forceSecondary(resourceName: string, id: string) {
  const cfg = resolveAdsConfig();
  await mutateResource(
    cfg,
    "conversionActions",
    [
      {
        update: {
          resourceName,
          primaryForGoal: false,
        },
        updateMask: "primaryForGoal",
      },
    ],
    { validateOnly: false },
  );
  const { rows } = await searchAll(
    cfg,
    `
    SELECT
      conversion_action.id,
      conversion_action.name,
      conversion_action.status,
      conversion_action.type,
      conversion_action.primary_for_goal,
      conversion_action.include_in_conversions_metric
    FROM conversion_action
    WHERE conversion_action.id = ${id}
    `,
  );
  return asCheck((rows[0]?.conversionAction ?? {}) as Record<string, unknown>);
}

async function main() {
  const doCreate = arg("create") === "true";
  const cfg = resolveAdsConfig();

  const existing = await loadByName(ACTION_NAME);
  if (existing.length) {
    let check = existing[0]!;
    if (check.primaryForGoal || check.includeInConversionsMetric) {
      console.log("existing action not Secondary — forcing primaryForGoal=false");
      check = await forceSecondary(
        `customers/${cfg.customerId}/conversionActions/${check.id}`,
        check.id,
      );
    }
    const problems = validateSecondaryAction(check);
    console.log(JSON.stringify({ reused: true, check, problems }, null, 2));
    if (problems.length) throw new Error(`action invalid: ${problems.join("; ")}`);
    if (isProductionId(check.id)) throw new Error("id is production — refuse");
    console.log(`\nSet on VPS after approval:\nTRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID=${check.id}`);
    return;
  }

  if (!doCreate) {
    console.log(`No "${ACTION_NAME}" found. Re-run with --create to create Secondary UPLOAD_CLICKS.`);
    return;
  }

  console.log("validateOnly create…");
  await mutateResource(
    cfg,
    "conversionActions",
    [
      {
        create: {
          name: ACTION_NAME,
          type: "UPLOAD_CLICKS",
          category: "PURCHASE",
          status: "ENABLED",
          primaryForGoal: false,
          countingType: "ONE_PER_CLICK",
          valueSettings: {
            defaultValue: 0,
            defaultCurrencyCode: "CHF",
            alwaysUseDefaultValue: false,
          },
        },
      },
    ],
    { validateOnly: true },
  );

  console.log("live create…");
  const created = await mutateResource(
    cfg,
    "conversionActions",
    [
      {
        create: {
          name: ACTION_NAME,
          type: "UPLOAD_CLICKS",
          category: "PURCHASE",
          status: "ENABLED",
          primaryForGoal: false,
          countingType: "ONE_PER_CLICK",
          valueSettings: {
            defaultValue: 0,
            defaultCurrencyCode: "CHF",
            alwaysUseDefaultValue: false,
          },
        },
      },
    ],
    { validateOnly: false },
  );

  const resourceName = String(
    (created.results[0] as { resourceName?: string } | undefined)?.resourceName ??
      (created.results[0] as { conversionActionResult?: { resourceName?: string } })
        ?.conversionActionResult?.resourceName ??
      "",
  );
  const id = resourceName.split("/").pop() ?? "";
  if (!id) {
    console.log("create response:", JSON.stringify(created, null, 2));
    throw new Error("create succeeded but no resourceName/id in response");
  }

  let check = (await loadByName(ACTION_NAME))[0];
  if (!check) throw new Error("created but not found on re-read");
  if (check.primaryForGoal) {
    console.log("API returned primary — forcing secondary…");
    check = await forceSecondary(resourceName, id);
  }

  const problems = validateSecondaryAction(check);
  console.log(JSON.stringify({ created: true, resourceName, check, problems }, null, 2));
  if (problems.length) throw new Error(`action invalid after create: ${problems.join("; ")}`);
  if (isProductionId(check.id)) throw new Error("id is production — refuse");

  console.log(`\nSet on VPS after approval:\nTRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID=${check.id}`);
  console.log("Still need TRACKING_GOOGLE_ADS_SECONDARY_APPROVED_AT + ENABLED=1 before --live uploads.");
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
