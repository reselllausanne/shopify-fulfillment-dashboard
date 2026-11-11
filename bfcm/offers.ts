import {
  BF2026_SCHEDULE,
  type EditorialCampaignFile,
} from "@/bfcm/schedule";

export const SHOP_ORIGIN = "https://www.resell-lausanne.ch";

export type OfferVariant = {
  variant_id: string;
  model_id?: string;
  title: string;
  size_eu: string;
  campaign_approved: boolean;
  local_stock_verified: boolean;
  available_local_quantity: number;
  delivery_48h_eligible: boolean;
  reference_validated: boolean;
  sale_price_chf: number;
  reference_price_chf: number;
  image_url: string;
  url: string;
};

export type EditorialSelection = {
  campaign_file: EditorialCampaignFile;
  approved: boolean;
  product_urls: readonly string[];
  variant_ids: readonly string[];
};

export type OfferSelectionStatus =
  | "matched"
  | "generic"
  | "empty"
  | "awaiting_selection";

export type OfferSelection = {
  status: OfferSelectionStatus;
  items: OfferVariant[];
};

export function canonicalSize(value: unknown): string | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const normalized = String(value)
    .trim()
    .replace(/^EU\s*/i, "")
    .replace(",", ".")
    .replace(/\s+/g, " ");
  if (!/^\d{2}(?:\.5|\s(?:1\/3|2\/3))?$/.test(normalized)) return null;
  const whole = Number(normalized.split(/[. ]/)[0]);
  return whole >= 15 && whole <= 55 ? normalized : null;
}

export function explicitSizes(values: readonly unknown[]): string[] {
  const sizes: string[] = [];
  for (const value of values) {
    const size = canonicalSize(value);
    if (!size || sizes.includes(size)) continue;
    sizes.push(size);
    if (sizes.length === BF2026_SCHEDULE.maxExplicitSizes) break;
  }
  return sizes;
}

function validHttpsUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

function validShopUrl(value: unknown): value is string {
  if (!validHttpsUrl(value)) return false;
  return new URL(value).origin === SHOP_ORIGIN;
}

function cents(value: number): number | null {
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

/** Every commercial claim must belong to the same Shopify variant. */
export function eligibleVariant(variant: OfferVariant): boolean {
  const sale = cents(variant.sale_price_chf);
  const reference = cents(variant.reference_price_chf);
  return (
    variant.campaign_approved === true &&
    variant.local_stock_verified === true &&
    Number.isInteger(variant.available_local_quantity) &&
    variant.available_local_quantity > 0 &&
    variant.delivery_48h_eligible === true &&
    variant.reference_validated === true &&
    sale !== null &&
    reference !== null &&
    sale > 0 &&
    reference > 0 &&
    sale * 2 <= reference &&
    canonicalSize(variant.size_eu) !== null &&
    variant.variant_id.length > 0 &&
    validHttpsUrl(variant.image_url) &&
    validShopUrl(variant.url)
  );
}

export function offerModelKey(variant: OfferVariant): string {
  if (variant.model_id?.trim()) return variant.model_id.trim();
  return new URL(variant.url).pathname;
}

/**
 * Crosses owner-approved variants with exact size and verified local inventory.
 * Models already shown to this profile stay out. Preview GETs must not populate
 * `previouslyShownModels`; only actual campaign delivery may do that.
 */
export function selectEditorialOffers(
  catalog: readonly OfferVariant[],
  requestedSizes: readonly unknown[],
  selection: EditorialSelection | null | undefined,
  previouslyShownModels: readonly string[] = [],
  limit = 3,
): OfferSelection {
  if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
    throw new Error("Invalid offer limit");
  }
  if (
    selection?.approved !== true ||
    selection.variant_ids.length === 0
  ) {
    return { status: "awaiting_selection", items: [] };
  }

  const sizes = explicitSizes(requestedSizes);
  const invalidRequestedSize =
    requestedSizes.length > 0 && sizes.length === 0;
  if (invalidRequestedSize) return { status: "empty", items: [] };

  const allowed = new Set(selection.variant_ids);
  const oldModels = new Set(previouslyShownModels);
  const currentModels = new Set<string>();
  const items: OfferVariant[] = [];

  for (const variant of catalog) {
    if (!eligibleVariant(variant) || !allowed.has(variant.variant_id)) continue;
    if (
      sizes.length > 0 &&
      !sizes.includes(canonicalSize(variant.size_eu) as string)
    ) {
      continue;
    }
    const model = offerModelKey(variant);
    if (oldModels.has(model) || currentModels.has(model)) continue;
    currentModels.add(model);
    items.push(variant);
    if (items.length === limit) break;
  }

  return {
    status: items.length === 0 ? "empty" : sizes.length ? "matched" : "generic",
    items,
  };
}

function campaignPrefix(campaign: EditorialCampaignFile): string {
  const number = /^0([3-8])_/.exec(campaign)?.[1];
  if (!number) throw new Error("Invalid editorial campaign");
  return `rl_bf_2026_0${number}_`;
}

/**
 * Produces only one campaign's properties. All three slots are cleared first.
 * Preview access remains false and blank; another server-validated step owns it.
 */
export function toCampaignProfileProperties(
  campaign: EditorialCampaignFile,
  offers: Pick<OfferSelection, "items">,
  generatedAt: string,
): Record<string, string | boolean> {
  if (!Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("Invalid snapshot date");
  }
  const prefix = campaignPrefix(campaign);
  const properties: Record<string, string | boolean> = {
    [`${prefix}snapshot_at`]: generatedAt,
  };

  for (let slot = 1; slot <= 3; slot += 1) {
    const key = `${prefix}p${slot}_`;
    for (const field of [
      "url",
      "image",
      "title",
      "size",
      "price",
      "reference",
      "preview_url",
    ]) {
      properties[key + field] = "";
    }
    properties[key + "ready"] = false;
    properties[key + "preview_ready"] = false;

    const variant = offers.items[slot - 1];
    if (!variant) continue;
    if (!eligibleVariant(variant)) throw new Error("Invalid offer snapshot");
    properties[key + "url"] = variant.url;
    properties[key + "image"] = variant.image_url;
    properties[key + "title"] = variant.title;
    properties[key + "size"] = canonicalSize(variant.size_eu) as string;
    properties[key + "price"] = variant.sale_price_chf.toFixed(2);
    properties[key + "reference"] =
      variant.reference_price_chf.toFixed(2);
    properties[key + "ready"] = true;
  }
  return properties;
}

export function selectionHistoryEventAllowed(
  cause: "delivered" | "preview" | "get" | "click",
): boolean {
  return cause === "delivered";
}
