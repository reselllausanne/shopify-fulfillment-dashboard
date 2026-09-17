import type { AdsConfig } from "@/adsanalytics/config";
import { toIsoDate } from "@/adsanalytics/dates";
import { googleAdsMutate } from "@/adsanalytics/google/adsClient";
import {
  EXPLORER_DEFAULT_FEED_LABEL,
  EXPLORER_DEFAULT_MERCHANT_ID,
} from "@/adsanalytics/explorer/core";

export type PmaxBrandCampaignSpec = {
  campaignName: string;
  /** Daily budget in micros (CHF × 1e6). */
  budgetMicros: number;
  /** Target ROAS ratio (5.0 = 500%). */
  targetRoas: number;
  merchantId: string;
  feedLabel: string;
  /** Merchant Center product_brand value (feed casing). */
  brand: string;
  finalUrl: string;
  /** PAUSED or ENABLED on create. */
  status?: "PAUSED" | "ENABLED";
};

export type PmaxBrandCampaignCreateResult = {
  budgetResourceName: string;
  campaignResourceName: string;
  campaignId: string;
  assetGroupResourceName: string;
  assetGroupId: string;
  operationCount: number;
  validateOnly: boolean;
};

const SWITZERLAND_GEO = "geoTargetConstants/2756";

function tempId(counter: { n: number }): number {
  counter.n -= 1;
  return counter.n;
}

function assetGroupRn(config: AdsConfig, assetGroupId: number | string): string {
  return `customers/${config.customerId}/assetGroups/${assetGroupId}`;
}

function listingFilterRn(
  config: AdsConfig,
  assetGroupId: number | string,
  filterId: number | string
): string {
  return `customers/${config.customerId}/assetGroupListingGroupFilters/${assetGroupId}~${filterId}`;
}

function productBrandCase(value?: string): Record<string, unknown> {
  const brand: Record<string, unknown> = {};
  if (value != null && value.length > 0) brand.value = value;
  return { productBrand: brand };
}

type ImageAssetPayload = { data: string; mimeType: "IMAGE_PNG" | "IMAGE_JPEG" };

async function loadSourceImage(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to fetch marketing image (${res.status}): ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function buildPmaxImageAssets(sourceUrl: string): Promise<{
  marketing: ImageAssetPayload;
  square: ImageAssetPayload;
  logo: ImageAssetPayload;
}> {
  const sharp = (await import("sharp")).default;
  const source = await loadSourceImage(sourceUrl);
  const marketingBuf = await sharp(source)
    .resize(1200, 628, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  const squareBuf = await sharp(source)
    .resize(1200, 1200, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
  const logoBuf = await sharp(source)
    .resize(512, 512, { fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png()
    .toBuffer();
  const asPayload = (buf: Buffer): ImageAssetPayload => ({
    data: buf.toString("base64"),
    mimeType: "IMAGE_PNG",
  });
  return {
    marketing: asPayload(marketingBuf),
    square: asPayload(squareBuf),
    logo: asPayload(logoBuf),
  };
}

export async function buildPmaxBrandCampaignMutateOperations(
  config: AdsConfig,
  spec: PmaxBrandCampaignSpec,
  now: Date = new Date()
): Promise<{ mutateOperations: unknown[]; tempIds: { budget: number; campaign: number; assetGroup: number } }> {
  const images = await buildPmaxImageAssets(DEFAULT_PMAX_BRAND_LOGO_URL);
  const counter = { n: 0 };
  const budgetTemp = tempId(counter);
  const campaignTemp = tempId(counter);
  const assetGroupTemp = tempId(counter);

  const listingRootTemp = tempId(counter);
  const listingBrandIncludeTemp = tempId(counter);
  const listingBrandExcludeTemp = tempId(counter);

  const budgetRn = `customers/${config.customerId}/campaignBudgets/${budgetTemp}`;
  const campaignRn = `customers/${config.customerId}/campaigns/${campaignTemp}`;
  const assetGroupRnVal = assetGroupRn(config, assetGroupTemp);
  const status = spec.status ?? "ENABLED";

  const headlines = [
    `${spec.brand.toUpperCase()} at Resell Lausanne`,
    `Shop ${spec.brand.toUpperCase()} Sneakers`,
    `Authentic ${spec.brand.toUpperCase()} Footwear`,
  ];
  const descriptions = [
    `Buy ${spec.brand.toUpperCase()} boots and sneakers with fast delivery in Switzerland.`,
    `Premium ${spec.brand.toUpperCase()} styles — shop now at Resell Lausanne.`,
  ];
  const longHeadline = `Shop ${spec.brand.toUpperCase()} footwear at Resell Lausanne`;

  const assetTemps: number[] = [];
  const mutateOperations: unknown[] = [
    {
      campaignBudgetOperation: {
        create: {
          resourceName: budgetRn,
          name: `${spec.campaignName} Budget ${toIsoDate(now)}`,
          amountMicros: String(spec.budgetMicros),
          deliveryMethod: "STANDARD",
          explicitlyShared: false,
        },
      },
    },
    {
      campaignOperation: {
        create: {
          resourceName: campaignRn,
          name: spec.campaignName,
          advertisingChannelType: "PERFORMANCE_MAX",
          status,
          campaignBudget: budgetRn,
          containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
          maximizeConversionValue: { targetRoas: spec.targetRoas },
          shoppingSetting: {
            merchantId: spec.merchantId,
            feedLabel: spec.feedLabel,
          },
          brandGuidelinesEnabled: false,
          assetAutomationSettings: [
            {
              assetAutomationType: "TEXT_ASSET_AUTOMATION",
              assetAutomationStatus: "OPTED_IN",
            },
            {
              assetAutomationType: "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
              assetAutomationStatus: "OPTED_IN",
            },
            {
              assetAutomationType: "GENERATE_IMAGE_EXTRACTION",
              assetAutomationStatus: "OPTED_IN",
            },
          ],
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
      assetGroupOperation: {
        create: {
          resourceName: assetGroupRnVal,
          name: `${spec.brand.toUpperCase()} Products`,
          campaign: campaignRn,
          finalUrls: [spec.finalUrl],
          status,
        },
      },
    },
  ];

  const rootListingRn = listingFilterRn(config, assetGroupTemp, listingRootTemp);
  mutateOperations.push(
    {
      assetGroupListingGroupFilterOperation: {
        create: {
          resourceName: rootListingRn,
          assetGroup: assetGroupRnVal,
          type: "SUBDIVISION",
          listingSource: "SHOPPING",
        },
      },
    },
    {
      assetGroupListingGroupFilterOperation: {
        create: {
          resourceName: listingFilterRn(config, assetGroupTemp, listingBrandIncludeTemp),
          assetGroup: assetGroupRnVal,
          parentListingGroupFilter: rootListingRn,
          type: "UNIT_INCLUDED",
          listingSource: "SHOPPING",
          caseValue: productBrandCase(spec.brand),
        },
      },
    },
    {
      assetGroupListingGroupFilterOperation: {
        create: {
          resourceName: listingFilterRn(config, assetGroupTemp, listingBrandExcludeTemp),
          assetGroup: assetGroupRnVal,
          parentListingGroupFilter: rootListingRn,
          type: "UNIT_EXCLUDED",
          listingSource: "SHOPPING",
          caseValue: productBrandCase(),
        },
      },
    }
  );

  for (const text of headlines) {
    const id = tempId(counter);
    assetTemps.push(id);
    mutateOperations.push({
      assetOperation: {
        create: {
          resourceName: `customers/${config.customerId}/assets/${id}`,
          name: `${spec.campaignName} headline ${Math.abs(id)}`,
          textAsset: { text },
        },
      },
    });
  }
  for (const text of descriptions) {
    const id = tempId(counter);
    assetTemps.push(id);
    mutateOperations.push({
      assetOperation: {
        create: {
          resourceName: `customers/${config.customerId}/assets/${id}`,
          name: `${spec.campaignName} description ${Math.abs(id)}`,
          textAsset: { text },
        },
      },
    });
  }
  const longHeadlineId = tempId(counter);
  mutateOperations.push({
    assetOperation: {
      create: {
        resourceName: `customers/${config.customerId}/assets/${longHeadlineId}`,
        name: `${spec.campaignName} long headline`,
        textAsset: { text: longHeadline },
      },
    },
  });

  const businessNameId = tempId(counter);
  mutateOperations.push({
    assetOperation: {
      create: {
        resourceName: `customers/${config.customerId}/assets/${businessNameId}`,
        name: `${spec.campaignName} business name`,
        textAsset: { text: "Resell Lausanne" },
      },
    },
  });

  const marketingImageId = tempId(counter);
  mutateOperations.push({
    assetOperation: {
      create: {
        resourceName: `customers/${config.customerId}/assets/${marketingImageId}`,
        name: `${spec.campaignName} marketing image`,
        imageAsset: { data: images.marketing.data, mimeType: images.marketing.mimeType },
      },
    },
  });

  const squareMarketingImageId = tempId(counter);
  mutateOperations.push({
    assetOperation: {
      create: {
        resourceName: `customers/${config.customerId}/assets/${squareMarketingImageId}`,
        name: `${spec.campaignName} square marketing image`,
        imageAsset: { data: images.square.data, mimeType: images.square.mimeType },
      },
    },
  });

  const logoImageId = tempId(counter);
  mutateOperations.push({
    assetOperation: {
      create: {
        resourceName: `customers/${config.customerId}/assets/${logoImageId}`,
        name: `${spec.campaignName} logo`,
        imageAsset: { data: images.logo.data, mimeType: images.logo.mimeType },
      },
    },
  });

  const linkAsset = (assetId: number, fieldType: string) => {
    mutateOperations.push({
      assetGroupAssetOperation: {
        create: {
          assetGroup: assetGroupRnVal,
          asset: `customers/${config.customerId}/assets/${assetId}`,
          fieldType,
        },
      },
    });
  };

  for (let i = 0; i < headlines.length; i += 1) {
    linkAsset(assetTemps[i]!, "HEADLINE");
  }
  for (let i = 0; i < descriptions.length; i += 1) {
    linkAsset(assetTemps[headlines.length + i]!, "DESCRIPTION");
  }
  linkAsset(longHeadlineId, "LONG_HEADLINE");
  linkAsset(businessNameId, "BUSINESS_NAME");
  linkAsset(marketingImageId, "MARKETING_IMAGE");
  linkAsset(squareMarketingImageId, "SQUARE_MARKETING_IMAGE");
  linkAsset(logoImageId, "LOGO");

  return {
    mutateOperations,
    tempIds: { budget: budgetTemp, campaign: campaignTemp, assetGroup: assetGroupTemp },
  };
}

function extractCampaignId(resourceName: string): string {
  const match = resourceName.match(/\/campaigns\/(\d+)$/);
  if (!match) throw new Error(`Could not parse campaign id from ${resourceName}`);
  return match[1]!;
}

function extractAssetGroupId(resourceName: string): string {
  const match = resourceName.match(/\/assetGroups\/(\d+)$/);
  if (!match) throw new Error(`Could not parse asset group id from ${resourceName}`);
  return match[1]!;
}

export async function createPmaxBrandCampaign(
  config: AdsConfig,
  spec: PmaxBrandCampaignSpec,
  options: { validateOnlyFirst?: boolean } = {}
): Promise<PmaxBrandCampaignCreateResult> {
  const { mutateOperations, tempIds } = await buildPmaxBrandCampaignMutateOperations(config, spec);

  if (options.validateOnlyFirst !== false) {
    const dry = await googleAdsMutate(config, mutateOperations, {
      validateOnly: true,
      partialFailure: false,
    });
    if (dry.partialFailureError) {
      throw new Error(`PMax create validate_only failed: ${JSON.stringify(dry.partialFailureError)}`);
    }
  }

  const live = await googleAdsMutate(config, mutateOperations, {
    validateOnly: false,
    partialFailure: false,
  });
  if (live.partialFailureError) {
    throw new Error(`PMax create failed: ${JSON.stringify(live.partialFailureError)}`);
  }

  let budgetResourceName = "";
  let campaignResourceName = "";
  let assetGroupResourceName = "";

  for (const result of live.results) {
    const campaignBudget = result.campaignBudgetResult as { resourceName?: string } | undefined;
    const campaign = result.campaignResult as { resourceName?: string } | undefined;
    const assetGroup = result.assetGroupResult as { resourceName?: string } | undefined;
    if (campaignBudget?.resourceName) budgetResourceName = campaignBudget.resourceName;
    if (campaign?.resourceName) campaignResourceName = campaign.resourceName;
    if (assetGroup?.resourceName) assetGroupResourceName = assetGroup.resourceName;
  }

  if (!campaignResourceName) {
    campaignResourceName = `customers/${config.customerId}/campaigns/${Math.abs(tempIds.campaign)}`;
    budgetResourceName =
      budgetResourceName ||
      `customers/${config.customerId}/campaignBudgets/${Math.abs(tempIds.budget)}`;
    assetGroupResourceName =
      assetGroupResourceName ||
      `customers/${config.customerId}/assetGroups/${Math.abs(tempIds.assetGroup)}`;
  }

  return {
    budgetResourceName,
    campaignResourceName,
    campaignId: extractCampaignId(campaignResourceName),
    assetGroupResourceName,
    assetGroupId: extractAssetGroupId(assetGroupResourceName),
    operationCount: mutateOperations.length,
    validateOnly: false,
  };
}

export const DEFAULT_PMAX_BRAND_FINAL_URL = "https://www.resell-lausanne.ch";
export const DEFAULT_PMAX_BRAND_LOGO_URL =
  "https://www.resell-lausanne.ch/cdn/shop/t/30/assets/logo-fullstack.png?v=22424771050372487161777561326";

export function defaultUggPmaxSpec(overrides: Partial<PmaxBrandCampaignSpec> = {}): PmaxBrandCampaignSpec {
  return {
    campaignName: "UGG PM Feed Only",
    budgetMicros: 100_000_000,
    targetRoas: 5.0,
    merchantId: EXPLORER_DEFAULT_MERCHANT_ID,
    feedLabel: EXPLORER_DEFAULT_FEED_LABEL,
    brand: "ugg",
    finalUrl: DEFAULT_PMAX_BRAND_FINAL_URL,
    status: "ENABLED",
    ...overrides,
  };
}
