import {
  EXPLORER_ACTIVE_ADIDAS_LABEL,
  EXPLORER_ACTIVE_JORDAN_LABEL,
  EXPLORER_ACTIVE_LABEL,
  EXPLORER_ACTIVE_NIKE_LABEL,
} from "@/adsanalytics/explorer/labels";

/**
 * Continuous Explorer skim sources. Each PMax brand campaign that is listing-tree
 * separated gets the same weekly loop as `all`: pull 0-imp models, test in the
 * matching Explorer Shopping campaign, promote winners back to core (clear label),
 * park weak models in the shared Long Tail.
 */
export type WeeklyExplorerSource = {
  /** Stable id used in seeds (`weekly-2026W36` / `weekly-2026W36-adidas`). */
  id: string;
  /** Exact Ads campaign name used as source_campaign_name filter. */
  sourceCampaignName: string;
  /** Brand token for explorerLabelForBrand; null = generic explorer_active. */
  brand: string | null;
  /** Merchant custom_label_3 the Explorer Shopping campaign includes. */
  explorerLabel: string;
  /** Known Explorer Shopping campaign id (must target explorerLabel). */
  explorerCampaignId: string;
  weeklyTargetModels: number;
  weeklyFloorModels: number;
  /** Generic `all` must abort nike/adidas/jordan leakage; brand sources must not. */
  abortForbiddenBrands: boolean;
};

export const WEEKLY_EXPLORER_SOURCES: WeeklyExplorerSource[] = [
  {
    id: "all",
    sourceCampaignName: "all",
    brand: null,
    explorerLabel: EXPLORER_ACTIVE_LABEL,
    explorerCampaignId: "24120624946",
    weeklyTargetModels: 1000,
    weeklyFloorModels: 100,
    abortForbiddenBrands: true,
  },
  {
    id: "adidas",
    sourceCampaignName: "Adidas PM Feed only",
    brand: "adidas",
    explorerLabel: EXPLORER_ACTIVE_ADIDAS_LABEL,
    explorerCampaignId: "24159928264",
    weeklyTargetModels: 1000,
    weeklyFloorModels: 50,
    abortForbiddenBrands: false,
  },
  {
    id: "nike",
    sourceCampaignName: "Nike PM Feed Only",
    brand: "nike",
    explorerLabel: EXPLORER_ACTIVE_NIKE_LABEL,
    explorerCampaignId: "24155137616",
    weeklyTargetModels: 1000,
    weeklyFloorModels: 50,
    abortForbiddenBrands: false,
  },
  {
    id: "jordan",
    sourceCampaignName: "Jordan PM Feed Only",
    brand: "jordan",
    explorerLabel: EXPLORER_ACTIVE_JORDAN_LABEL,
    explorerCampaignId: "24159881680",
    weeklyTargetModels: 1000,
    weeklyFloorModels: 50,
    abortForbiddenBrands: false,
  },
];

export function weeklySeedForSource(isoWeekSeed: string, source: WeeklyExplorerSource): string {
  return source.id === "all" ? isoWeekSeed : `${isoWeekSeed}-${source.id}`;
}
