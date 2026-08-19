import type { AdsConfig } from "@/adsanalytics/config";
import { addDays, toIsoDate } from "@/adsanalytics/dates";
import { googleAdsMutate } from "@/adsanalytics/google/adsClient";
import { CUSTOM_LABEL_3_INDEX, EXPLORER_ACTIVE_LABEL } from "@/adsanalytics/explorer/labels";

export type ExplorerCampaignSpec = {
  campaignName: string;
  budgetMicros: number;
  maxCpcMicros: number;
  merchantId: string;
  feedLabel: string;
  /** Null builds a persistent campaign (Long Tail All); a number ends the test batch. */
  endAfterDays: number | null;
  adGroupName: string;
  /** custom_label_3 value this campaign includes. Everything else is excluded. */
  includeLabel?: string;
  /**
   * When set, the listing tree is narrowed to a single product_brand under the
   * includeLabel subdivision (brand-scoped Explorer). Other brands and other
   * custom_label_3 values are excluded.
   */
  brandFilter?: string;
};

export type ExplorerCampaignCreateResult = {
  budgetResourceName: string;
  campaignResourceName: string;
  campaignId: string;
  adGroupResourceName: string;
  adGroupId: string;
  adGroupAdResourceName: string;
  adGroupAdId: string;
  operationCount: number;
  validateOnly: boolean;
};

const SWITZERLAND_GEO = "geoTargetConstants/2756";

function tempId(counter: { n: number }): number {
  counter.n -= 1;
  return counter.n;
}

function customLabel3Dimension(value?: string): Record<string, unknown> {
  const attr: Record<string, unknown> = { index: CUSTOM_LABEL_3_INDEX };
  if (value != null && value.length > 0) attr.value = value;
  return { productCustomAttribute: attr };
}

function productBrandDimension(value?: string): Record<string, unknown> {
  const brand: Record<string, unknown> = {};
  if (value != null && value.length > 0) brand.value = value;
  return { productBrand: brand };
}

function adGroupCriterionResourceName(
  customerId: string,
  adGroupId: number | string,
  criterionId: number | string
): string {
  return `customers/${customerId}/adGroupCriteria/${adGroupId}~${criterionId}`;
}

export function buildExplorerCampaignMutateOperations(
  config: AdsConfig,
  spec: ExplorerCampaignSpec,
  now: Date = new Date()
): { mutateOperations: unknown[]; tempIds: { budget: number; campaign: number; adGroup: number } } {
  const counter = { n: 0 };
  const budgetTemp = tempId(counter);
  const campaignTemp = tempId(counter);
  const adGroupTemp = tempId(counter);
  const listingRootTemp = tempId(counter);
  const listingLabelSubdivisionTemp = tempId(counter);
  const listingBrandIncludeTemp = spec.brandFilter ? tempId(counter) : null;
  const listingBrandExcludeTemp = spec.brandFilter ? tempId(counter) : null;
  const listingLabelIncludeTemp = spec.brandFilter ? null : tempId(counter);
  const listingLabelExcludeTemp = tempId(counter);

  const budgetRn = `customers/${config.customerId}/campaignBudgets/${budgetTemp}`;
  const campaignRn = `customers/${config.customerId}/campaigns/${campaignTemp}`;
  const adGroupRn = `customers/${config.customerId}/adGroups/${adGroupTemp}`;
  const includeLabel = spec.includeLabel ?? EXPLORER_ACTIVE_LABEL;
  const brandFilter = spec.brandFilter?.trim();
  const endDate =
    spec.endAfterDays == null
      ? {}
      : { endDateTime: `${addDays(toIsoDate(now), spec.endAfterDays)} 23:59:59` };

  const mutateOperations: unknown[] = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetRn,
          name: `${spec.campaignName} Budget ${toIsoDate(now)}`,
          amountMicros: String(spec.budgetMicros),
          deliveryMethod: "STANDARD",
          explicitlyShared: true,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignRn,
          name: spec.campaignName,
          advertisingChannelType: "SHOPPING",
          status: "PAUSED",
          campaignBudget: budgetRn,
          manualCpc: {},
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          ...endDate,
          shoppingSetting: {
            merchantId: spec.merchantId,
            feedLabel: spec.feedLabel,
            campaignPriority: 1,
            enableLocal: false,
          },
        },
      },
    },
    {
      campaignCriterionOperation: {
        create: {
          campaign: campaignRn,
          location: { geoTargetConstant: SWITZERLAND_GEO },
        },
      },
    },
    {
      adGroupOperation: {
        create: {
          resourceName: adGroupRn,
          name: spec.adGroupName,
          campaign: campaignRn,
          status: "PAUSED",
          type: "SHOPPING_PRODUCT_ADS",
          cpcBidMicros: String(spec.maxCpcMicros),
        },
      },
    },
    {
      adGroupAdOperation: {
        create: {
          adGroup: adGroupRn,
          status: "PAUSED",
          ad: {
            shoppingProductAd: {},
          },
        },
      },
    },
    {
      adGroupCriterionOperation: {
        create: {
          resourceName: adGroupCriterionResourceName(config.customerId, adGroupTemp, listingRootTemp),
          adGroup: adGroupRn,
          status: "ENABLED",
          listingGroup: { type: "SUBDIVISION" },
        },
      },
    },
  ];

  const rootCriterionRn = adGroupCriterionResourceName(
    config.customerId,
    adGroupTemp,
    listingRootTemp
  );

  if (brandFilter && listingBrandIncludeTemp != null && listingBrandExcludeTemp != null) {
    const labelSubRn = adGroupCriterionResourceName(
      config.customerId,
      adGroupTemp,
      listingLabelSubdivisionTemp
    );
    mutateOperations.push(
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: labelSubRn,
            adGroup: adGroupRn,
            status: "ENABLED",
            listingGroup: {
              type: "SUBDIVISION",
              parentAdGroupCriterion: rootCriterionRn,
              caseValue: customLabel3Dimension(includeLabel),
            },
          },
        },
      },
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: adGroupCriterionResourceName(
              config.customerId,
              adGroupTemp,
              listingBrandIncludeTemp
            ),
            adGroup: adGroupRn,
            status: "ENABLED",
            cpcBidMicros: String(spec.maxCpcMicros),
            listingGroup: {
              type: "UNIT",
              parentAdGroupCriterion: labelSubRn,
              caseValue: productBrandDimension(brandFilter),
            },
          },
        },
      },
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: adGroupCriterionResourceName(
              config.customerId,
              adGroupTemp,
              listingBrandExcludeTemp
            ),
            adGroup: adGroupRn,
            status: "ENABLED",
            negative: true,
            listingGroup: {
              type: "UNIT",
              parentAdGroupCriterion: labelSubRn,
              caseValue: productBrandDimension(),
            },
          },
        },
      },
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: adGroupCriterionResourceName(
              config.customerId,
              adGroupTemp,
              listingLabelExcludeTemp
            ),
            adGroup: adGroupRn,
            status: "ENABLED",
            negative: true,
            listingGroup: {
              type: "UNIT",
              parentAdGroupCriterion: rootCriterionRn,
              caseValue: customLabel3Dimension(),
            },
          },
        },
      }
    );
  } else if (listingLabelIncludeTemp != null) {
    mutateOperations.push(
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: adGroupCriterionResourceName(
              config.customerId,
              adGroupTemp,
              listingLabelIncludeTemp
            ),
            adGroup: adGroupRn,
            status: "ENABLED",
            cpcBidMicros: String(spec.maxCpcMicros),
            listingGroup: {
              type: "UNIT",
              parentAdGroupCriterion: rootCriterionRn,
              caseValue: customLabel3Dimension(includeLabel),
            },
          },
        },
      },
      {
        adGroupCriterionOperation: {
          create: {
            resourceName: adGroupCriterionResourceName(
              config.customerId,
              adGroupTemp,
              listingLabelExcludeTemp
            ),
            adGroup: adGroupRn,
            status: "ENABLED",
            negative: true,
            listingGroup: {
              type: "UNIT",
              parentAdGroupCriterion: rootCriterionRn,
              caseValue: customLabel3Dimension(),
            },
          },
        },
      }
    );
  }

  return {
    mutateOperations,
    tempIds: { budget: budgetTemp, campaign: campaignTemp, adGroup: adGroupTemp },
  };
}

function extractCampaignId(resourceName: string): string {
  const match = resourceName.match(/\/campaigns\/(\d+)$/);
  if (!match) throw new Error(`Could not parse campaign id from ${resourceName}`);
  return match[1]!;
}

function extractAdGroupId(resourceName: string): string {
  const match = resourceName.match(/\/adGroups\/(\d+)$/);
  if (!match) throw new Error(`Could not parse ad group id from ${resourceName}`);
  return match[1]!;
}

function extractAdGroupAdId(resourceName: string): string {
  const match = resourceName.match(/\/adGroupAds\/\d+~(\d+)$/);
  if (!match) throw new Error(`Could not parse ad group ad id from ${resourceName}`);
  return match[1]!;
}

export async function createExplorerShoppingCampaign(
  config: AdsConfig,
  spec: ExplorerCampaignSpec,
  options: { validateOnlyFirst?: boolean } = {}
): Promise<ExplorerCampaignCreateResult> {
  const { mutateOperations, tempIds } = buildExplorerCampaignMutateOperations(config, spec);

  if (options.validateOnlyFirst !== false) {
    const dry = await googleAdsMutate(config, mutateOperations, { validateOnly: true });
    if (dry.partialFailureError) {
      throw new Error(`Campaign create validate_only failed: ${JSON.stringify(dry.partialFailureError)}`);
    }
  }

  const live = await googleAdsMutate(config, mutateOperations, { validateOnly: false });
  if (live.partialFailureError) {
    throw new Error(`Campaign create failed: ${JSON.stringify(live.partialFailureError)}`);
  }

  let budgetResourceName = "";
  let campaignResourceName = "";
  let adGroupResourceName = "";
  let adGroupAdResourceName = "";

  for (const result of live.results) {
    const campaignBudget = result.campaignBudgetResult as { resourceName?: string } | undefined;
    const campaign = result.campaignResult as { resourceName?: string } | undefined;
    const adGroup = result.adGroupResult as { resourceName?: string } | undefined;
    const adGroupAd = result.adGroupAdResult as { resourceName?: string } | undefined;
    if (campaignBudget?.resourceName) budgetResourceName = campaignBudget.resourceName;
    if (campaign?.resourceName) campaignResourceName = campaign.resourceName;
    if (adGroup?.resourceName) adGroupResourceName = adGroup.resourceName;
    if (adGroupAd?.resourceName) adGroupAdResourceName = adGroupAd.resourceName;
  }

  if (!campaignResourceName) {
    budgetResourceName =
      budgetResourceName ||
      `customers/${config.customerId}/campaignBudgets/${Math.abs(tempIds.budget)}`;
    campaignResourceName = `customers/${config.customerId}/campaigns/${Math.abs(tempIds.campaign)}`;
    adGroupResourceName = `customers/${config.customerId}/adGroups/${Math.abs(tempIds.adGroup)}`;
  }
  if (!adGroupAdResourceName) {
    throw new Error("Could not resolve adGroupAd resource name from campaign create response");
  }

  return {
    budgetResourceName,
    campaignResourceName,
    campaignId: extractCampaignId(campaignResourceName),
    adGroupResourceName,
    adGroupId: extractAdGroupId(adGroupResourceName),
    adGroupAdResourceName,
    adGroupAdId: extractAdGroupAdId(adGroupAdResourceName),
    operationCount: mutateOperations.length,
    validateOnly: false,
  };
}

export async function enableExplorerCampaign(
  config: AdsConfig,
  campaignResourceName: string
): Promise<{ resourceName: string }> {
  const response = await googleAdsMutate(config, [
    {
      campaignOperation: {
        update: {
          resourceName: campaignResourceName,
          status: "ENABLED",
        },
        updateMask: "status",
      },
    },
  ]);
  if (response.partialFailureError) {
    throw new Error(`Campaign enable failed: ${JSON.stringify(response.partialFailureError)}`);
  }
  const result = response.results[0]?.campaignResult as { resourceName?: string } | undefined;
  return { resourceName: result?.resourceName ?? campaignResourceName };
}

export async function enableExplorerAdGroup(
  config: AdsConfig,
  adGroupResourceName: string
): Promise<{ resourceName: string }> {
  const response = await googleAdsMutate(config, [
    {
      adGroupOperation: {
        update: {
          resourceName: adGroupResourceName,
          status: "ENABLED",
        },
        updateMask: "status",
      },
    },
  ]);
  if (response.partialFailureError) {
    throw new Error(`Ad group enable failed: ${JSON.stringify(response.partialFailureError)}`);
  }
  const result = response.results[0]?.adGroupResult as { resourceName?: string } | undefined;
  return { resourceName: result?.resourceName ?? adGroupResourceName };
}

export async function enableExplorerAdGroupAd(
  config: AdsConfig,
  adGroupAdResourceName: string
): Promise<{ resourceName: string }> {
  const response = await googleAdsMutate(config, [
    {
      adGroupAdOperation: {
        update: {
          resourceName: adGroupAdResourceName,
          status: "ENABLED",
        },
        updateMask: "status",
      },
    },
  ]);
  if (response.partialFailureError) {
    throw new Error(`Ad group ad enable failed: ${JSON.stringify(response.partialFailureError)}`);
  }
  const result = response.results[0]?.adGroupAdResult as { resourceName?: string } | undefined;
  return { resourceName: result?.resourceName ?? adGroupAdResourceName };
}

export type PurchaseConversionCheck = {
  pass: boolean;
  primaryPurchaseActions: string[];
  note: string;
};

export async function verifyPurchasePrimaryConversion(
  config: AdsConfig,
  searchAll: (
    cfg: AdsConfig,
    query: string
  ) => Promise<{ rows: Array<Record<string, unknown>>; stats: unknown }>
): Promise<PurchaseConversionCheck> {
  const { rows } = await searchAll(
    config,
    [
      "SELECT",
      "  conversion_action.id,",
      "  conversion_action.name,",
      "  conversion_action.category,",
      "  conversion_action.status,",
      "  conversion_action.primary_for_goal",
      "FROM conversion_action",
      "WHERE conversion_action.status = 'ENABLED'",
      "  AND conversion_action.category = 'PURCHASE'",
      "  AND conversion_action.primary_for_goal = true",
    ].join("\n")
  );

  const names = rows
    .map((row) => {
      const ca = row.conversionAction as Record<string, unknown> | undefined;
      return ca?.name != null ? String(ca.name) : "";
    })
    .filter((n) => n.length > 0);

  return {
    pass: names.length > 0,
    primaryPurchaseActions: names,
    note:
      names.length > 0
        ? "At least one ENABLED PURCHASE conversion action is primary_for_goal."
        : "No ENABLED primary PURCHASE conversion action found; verify account goals manually.",
  };
}
