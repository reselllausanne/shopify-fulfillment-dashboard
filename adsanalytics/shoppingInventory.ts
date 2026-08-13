import type { GoogleAdsRow } from "@/adsanalytics/google/adsClient";
import { parseOfferId } from "@/adsanalytics/transform";

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function asBigInt(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value === "number") return BigInt(Math.round(value));
  if (typeof value === "string" && /^-?\d+$/.test(value.trim())) return BigInt(value.trim());
  return BigInt(0);
}

function section(row: GoogleAdsRow, name: string): Record<string, unknown> {
  const value = row[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export type ShoppingProductCurrentRow = {
  merchantId: bigint;
  channel: string;
  languageCode: string;
  feedLabel: string;
  offerId: string;
  title: string;
  brand: string;
  productType: string;
  customAttr0: string;
  customAttr1: string;
  customAttr2: string;
  customAttr3: string;
  customAttr4: string;
  status: string;
  availability: string;
  shopifyProductId: bigint | null;
  shopifyVariantId: bigint | null;
};

export function shoppingOfferKey(parts: {
  merchantId: bigint;
  channel: string;
  languageCode: string;
  feedLabel: string;
  offerId: string;
}): string {
  return [
    parts.merchantId.toString(),
    parts.channel,
    parts.languageCode,
    parts.feedLabel,
    parts.offerId,
  ].join("|");
}

function joinProductType(p: Record<string, unknown>): string {
  return [
    asString(p.productTypeLevel1),
    asString(p.productTypeLevel2),
    asString(p.productTypeLevel3),
    asString(p.productTypeLevel4),
    asString(p.productTypeLevel5),
  ]
    .filter((s) => s.length > 0)
    .join(" > ");
}

export function mapShoppingProductCurrentRow(row: GoogleAdsRow): ShoppingProductCurrentRow {
  const p = section(row, "shoppingProduct");
  const offerId = asString(p.itemId);
  const parsed = parseOfferId(offerId);
  return {
    merchantId: asBigInt(p.merchantCenterId),
    channel: asString(p.channel),
    languageCode: asString(p.languageCode),
    feedLabel: asString(p.feedLabel),
    offerId,
    title: asString(p.title),
    brand: asString(p.brand),
    productType: joinProductType(p),
    customAttr0: asString(p.customAttribute0),
    customAttr1: asString(p.customAttribute1),
    customAttr2: asString(p.customAttribute2),
    customAttr3: asString(p.customAttribute3),
    customAttr4: asString(p.customAttribute4),
    status: asString(p.status),
    availability: asString(p.availability),
    shopifyProductId: parsed.shopifyProductId,
    shopifyVariantId: parsed.shopifyVariantId,
  };
}

export type CampaignScopeRow = {
  campaignId: string;
  campaignName: string;
  merchantId: bigint;
  channel: string;
  languageCode: string;
  feedLabel: string;
  offerId: string;
  status: string;
};

export function mapShoppingCampaignScopeRow(row: GoogleAdsRow): CampaignScopeRow {
  const p = section(row, "shoppingProduct");
  const campaignResource = asString(p.campaign);
  const campaignId = campaignResource.split("/").pop() ?? "";
  return {
    campaignId,
    campaignName: "",
    merchantId: asBigInt(p.merchantCenterId),
    channel: asString(p.channel),
    languageCode: asString(p.languageCode),
    feedLabel: asString(p.feedLabel),
    offerId: asString(p.itemId),
    status: asString(p.status),
  };
}

export type ActiveCampaign = {
  campaignId: string;
  campaignName: string;
  status: string;
  channelType: string;
};

export function mapActiveCampaign(row: GoogleAdsRow): ActiveCampaign {
  const c = section(row, "campaign");
  return {
    campaignId: asString(c.id),
    campaignName: asString(c.name),
    status: asString(c.status),
    channelType: asString(c.advertisingChannelType),
  };
}
