import type { AdsConfig } from "@/adsanalytics/config";
import { mutateResource } from "@/adsanalytics/google/adsClient";
import {
  CUSTOM_LABEL_3_INDEX,
  EXPLORER_ACTIVE_LABEL,
  ROUTED_LABELS,
} from "@/adsanalytics/explorer/labels";
import {
  leafPath,
  offerMatchesListingRules,
  resolveIncludedLeafNodesForOffer,
  type ListingDimension,
  type ListingFilterNode,
  type OfferAttrs,
} from "@/adsanalytics/listingGroup";

export {
  EXPLORER_ACTIVE_LABEL,
  LONG_TAIL_ALL_LABEL,
  ROUTED_LABELS,
} from "@/adsanalytics/explorer/labels";

export function assetGroupListingGroupFilterResourceName(
  customerId: string,
  assetGroupId: string,
  filterId: number | string
): string {
  return `customers/${customerId}/assetGroupListingGroupFilters/${assetGroupId}~${filterId}`;
}

export function assetGroupResourceName(customerId: string, assetGroupId: string): string {
  return `customers/${customerId}/assetGroups/${assetGroupId}`;
}

function customLabel3Dimension(value?: string): Record<string, unknown> {
  const attr: Record<string, unknown> = { index: CUSTOM_LABEL_3_INDEX };
  if (value != null && value.length > 0) attr.value = value;
  return { productCustomAttribute: attr };
}

/** Serialize a parsed dimension back to Ads API case_value (sibling slot under parent). */
export function dimensionToCaseValue(dim: ListingDimension): Record<string, unknown> {
  switch (dim.kind) {
    case "product_brand":
      return { productBrand: { value: dim.value } };
    case "product_item_id":
      return { productItemId: { value: dim.value } };
    case "product_type": {
      const pt: Record<string, unknown> = {};
      if (dim.level) pt.level = dim.level;
      if (dim.value) pt.value = dim.value;
      return { productType: pt };
    }
    case "product_custom_attribute": {
      const attr: Record<string, unknown> = { index: dim.index };
      if (dim.value) attr.value = dim.value;
      return { productCustomAttribute: attr };
    }
    case "product_condition":
      return { productCondition: { condition: dim.condition } };
    case "product_channel":
      return { productChannel: { channel: dim.channel } };
    case "product_category": {
      const cat: Record<string, unknown> = {};
      if (dim.level) cat.level = dim.level;
      if (dim.categoryId) cat.categoryId = dim.categoryId;
      return { productCategory: cat };
    }
    case "everything_else":
      // "Others" sibling: omit concrete value; parent dimension implied by siblings.
      return {};
  }
}

export type ListingGroupMutateOp = {
  remove?: string;
  create?: Record<string, unknown>;
};

/**
 * Replace one UNIT_INCLUDED leaf with a custom_label_3 subdivision:
 * every routed label -> UNIT_EXCLUDED, everything else -> UNIT_INCLUDED.
 *
 * The replacement SUBDIVISION keeps the leaf's case_value (same sibling dimension).
 * Children introduce INDEX3 — must not reuse an ancestor dimension.
 */
export function buildLeafSubdivisionOps(
  config: AdsConfig,
  leaf: ListingFilterNode,
  tempIds: { next: () => number },
  excludedLabels: readonly string[] = ROUTED_LABELS
): ListingGroupMutateOp[] {
  if (leaf.type !== "UNIT_INCLUDED") {
    throw new Error(`Leaf ${leaf.id} is ${leaf.type}, expected UNIT_INCLUDED`);
  }
  if (!leaf.parentResourceName) {
    throw new Error(`Leaf ${leaf.id} has no parent; cannot subdivide`);
  }
  if (
    leaf.dimension.kind === "product_custom_attribute" &&
    leaf.dimension.index === CUSTOM_LABEL_3_INDEX
  ) {
    throw new Error(
      `Leaf ${leaf.id} already uses ${CUSTOM_LABEL_3_INDEX}; cannot subdivide by same dimension`
    );
  }

  const labels = [...new Set(excludedLabels.filter((l) => l.trim().length > 0))];
  if (labels.length === 0) {
    throw new Error("buildLeafSubdivisionOps requires at least one excluded label");
  }

  const subdivisionId = tempIds.next();
  const assetGroupRn = assetGroupResourceName(config.customerId, leaf.assetGroupId);
  const subdivisionRn = assetGroupListingGroupFilterResourceName(
    config.customerId,
    leaf.assetGroupId,
    subdivisionId
  );
  const listingSource = leaf.listingSource || "SHOPPING";
  const leafCaseValue = dimensionToCaseValue(leaf.dimension);

  const excludedOps: ListingGroupMutateOp[] = labels.map((label) => ({
    create: {
      resourceName: assetGroupListingGroupFilterResourceName(
        config.customerId,
        leaf.assetGroupId,
        tempIds.next()
      ),
      assetGroup: assetGroupRn,
      parentListingGroupFilter: subdivisionRn,
      type: "UNIT_EXCLUDED",
      listingSource,
      caseValue: customLabel3Dimension(label),
    },
  }));

  return [
    { remove: leaf.resourceName },
    {
      create: {
        resourceName: subdivisionRn,
        assetGroup: assetGroupRn,
        parentListingGroupFilter: leaf.parentResourceName,
        type: "SUBDIVISION",
        listingSource,
        caseValue: leafCaseValue,
      },
    },
    ...excludedOps,
    {
      create: {
        resourceName: assetGroupListingGroupFilterResourceName(
          config.customerId,
          leaf.assetGroupId,
          tempIds.next()
        ),
        assetGroup: assetGroupRn,
        parentListingGroupFilter: subdivisionRn,
        type: "UNIT_INCLUDED",
        listingSource,
        caseValue: customLabel3Dimension(),
      },
    },
  ];
}

/**
 * Additive follow-up for leaves already subdivided by custom_label_3: attach one more
 * UNIT_EXCLUDED sibling. Used to exclude long_tail_all from a core campaign that was
 * only excluding explorer_active, without rebuilding the subdivision.
 */
export function buildAdditionalLabelExclusionOps(
  config: AdsConfig,
  subdivision: ListingFilterNode,
  label: string,
  tempIds: { next: () => number }
): ListingGroupMutateOp[] {
  if (subdivision.type !== "SUBDIVISION") {
    throw new Error(`Node ${subdivision.id} is ${subdivision.type}, expected SUBDIVISION`);
  }
  if (label.trim().length === 0) throw new Error("Missing label to exclude");
  return [
    {
      create: {
        resourceName: assetGroupListingGroupFilterResourceName(
          config.customerId,
          subdivision.assetGroupId,
          tempIds.next()
        ),
        assetGroup: assetGroupResourceName(config.customerId, subdivision.assetGroupId),
        parentListingGroupFilter: subdivision.resourceName,
        type: "UNIT_EXCLUDED",
        listingSource: subdivision.listingSource || "SHOPPING",
        caseValue: customLabel3Dimension(label),
      },
    },
  ];
}

/**
 * Locate the custom_label_3 subdivisions of a campaign that do not yet exclude `label`.
 * These are exactly the nodes `buildAdditionalLabelExclusionOps` must be applied to.
 */
export function findSubdivisionsMissingLabelExclusion(
  listingNodes: ListingFilterNode[],
  campaignId: string,
  label: string
): ListingFilterNode[] {
  const nodes = listingNodes.filter((n) => n.campaignId === campaignId);
  const byParent = new Map<string, ListingFilterNode[]>();
  for (const n of nodes) {
    if (!n.parentResourceName) continue;
    const list = byParent.get(n.parentResourceName) ?? [];
    list.push(n);
    byParent.set(n.parentResourceName, list);
  }
  return nodes.filter((n) => {
    if (n.type !== "SUBDIVISION") return false;
    const children = byParent.get(n.resourceName) ?? [];
    const label3Children = children.filter(
      (c) =>
        c.dimension.kind === "product_custom_attribute" &&
        c.dimension.index === CUSTOM_LABEL_3_INDEX
    );
    if (label3Children.length === 0) return false;
    return !label3Children.some(
      (c) =>
        c.type === "UNIT_EXCLUDED" &&
        c.dimension.kind === "product_custom_attribute" &&
        c.dimension.value === label
    );
  });
}

export async function applyAdditionalLabelExclusions(
  config: AdsConfig,
  subdivisions: ListingFilterNode[],
  label: string,
  options: { validateOnlyFirst?: boolean; validateOnly?: boolean } = {}
): Promise<CoreExclusionApplyResult> {
  const byAssetGroup = new Map<string, ListingFilterNode[]>();
  for (const node of subdivisions) {
    const list = byAssetGroup.get(node.assetGroupId) ?? [];
    list.push(node);
    byAssetGroup.set(node.assetGroupId, list);
  }

  const perAssetGroup: CoreExclusionApplyResult["perAssetGroup"] = [];
  let operationsApplied = 0;
  let leavesMutated = 0;

  for (const [assetGroupId, nodes] of byAssetGroup.entries()) {
    const tempIds = { n: -1, next() { this.n -= 1; return this.n; } };
    const operations: ListingGroupMutateOp[] = [];
    for (const node of nodes) {
      operations.push(...buildAdditionalLabelExclusionOps(config, node, label, tempIds));
    }

    let validateOnlyOk = true;
    let applied = false;
    let resultCount = 0;
    let error: string | undefined;

    try {
      if (options.validateOnlyFirst !== false) {
        const dry = await mutateResource(config, "assetGroupListingGroupFilters", operations, {
          validateOnly: true,
        });
        resultCount = dry.results.length;
        if (dry.partialFailureError) {
          validateOnlyOk = false;
          error = JSON.stringify(dry.partialFailureError).slice(0, 500);
        }
      }
      if (validateOnlyOk && options.validateOnly !== true) {
        const live = await mutateResource(config, "assetGroupListingGroupFilters", operations, {
          validateOnly: false,
        });
        resultCount = live.results.length;
        applied = true;
        operationsApplied += operations.length;
        leavesMutated += nodes.length;
        if (live.partialFailureError) {
          error = JSON.stringify(live.partialFailureError).slice(0, 500);
        }
      }
    } catch (err) {
      validateOnlyOk = false;
      error = err instanceof Error ? err.message : String(err);
    }

    perAssetGroup.push({
      assetGroupId,
      campaignId: nodes[0]?.campaignId ?? "",
      leafCount: nodes.length,
      operationCount: operations.length,
      validateOnlyOk,
      applied,
      resultCount,
      error,
    });
  }

  return {
    assetGroupsMutated: perAssetGroup.filter((g) => g.applied).length,
    leavesMutated,
    operationsApplied,
    validateOnlyPasses: perAssetGroup.every((g) => g.validateOnlyOk),
    perAssetGroup,
  };
}

export type CoreExclusionApplyResult = {
  assetGroupsMutated: number;
  leavesMutated: number;
  operationsApplied: number;
  validateOnlyPasses: boolean;
  perAssetGroup: Array<{
    assetGroupId: string;
    campaignId: string;
    leafCount: number;
    operationCount: number;
    validateOnlyOk: boolean;
    applied: boolean;
    resultCount: number;
    error?: string;
  }>;
};

export async function applyCoreExclusionMutations(
  config: AdsConfig,
  listingNodes: ListingFilterNode[],
  touchedLeafIds: string[],
  options: { validateOnlyFirst?: boolean } = {}
): Promise<CoreExclusionApplyResult> {
  const touchedSet = new Set(touchedLeafIds);
  const leaves = listingNodes.filter((n) => touchedSet.has(n.id));
  if (leaves.length !== touchedLeafIds.length) {
    const found = new Set(leaves.map((l) => l.id));
    const missing = touchedLeafIds.filter((id) => !found.has(id));
    throw new Error(`Touched leaves not found in listing tree: ${missing.join(", ")}`);
  }
  for (const leaf of leaves) {
    if (leaf.type !== "UNIT_INCLUDED") {
      throw new Error(`Touched leaf ${leaf.id} is ${leaf.type}, expected UNIT_INCLUDED`);
    }
  }

  const byAssetGroup = new Map<string, ListingFilterNode[]>();
  for (const leaf of leaves) {
    const list = byAssetGroup.get(leaf.assetGroupId) ?? [];
    list.push(leaf);
    byAssetGroup.set(leaf.assetGroupId, list);
  }

  const perAssetGroup: CoreExclusionApplyResult["perAssetGroup"] = [];
  let operationsApplied = 0;
  let leavesMutated = 0;

  for (const [assetGroupId, groupLeaves] of byAssetGroup.entries()) {
    const tempIds = { n: -1, next() { this.n -= 1; return this.n; } };
    const operations: ListingGroupMutateOp[] = [];
    for (const leaf of groupLeaves) {
      operations.push(...buildLeafSubdivisionOps(config, leaf, tempIds));
    }

    let validateOnlyOk = true;
    let applied = false;
    let resultCount = 0;
    let error: string | undefined;

    try {
      if (options.validateOnlyFirst !== false) {
        const dry = await mutateResource(config, "assetGroupListingGroupFilters", operations, {
          validateOnly: true,
        });
        resultCount = dry.results.length;
        if (dry.partialFailureError) {
          validateOnlyOk = false;
          error = JSON.stringify(dry.partialFailureError).slice(0, 500);
        }
      }
      if (validateOnlyOk) {
        const live = await mutateResource(config, "assetGroupListingGroupFilters", operations, {
          validateOnly: false,
        });
        resultCount = live.results.length;
        applied = true;
        operationsApplied += operations.length;
        leavesMutated += groupLeaves.length;
        if (live.partialFailureError) {
          error = JSON.stringify(live.partialFailureError).slice(0, 500);
        }
      }
    } catch (err) {
      validateOnlyOk = false;
      error = err instanceof Error ? err.message : String(err);
    }

    perAssetGroup.push({
      assetGroupId,
      campaignId: groupLeaves[0]?.campaignId ?? "",
      leafCount: groupLeaves.length,
      operationCount: operations.length,
      validateOnlyOk,
      applied,
      resultCount,
      error,
    });
  }

  const allOk = perAssetGroup.every((g) => g.applied && !g.error);
  return {
    assetGroupsMutated: perAssetGroup.filter((g) => g.applied).length,
    leavesMutated,
    operationsApplied,
    validateOnlyPasses: perAssetGroup.every((g) => g.validateOnlyOk),
    perAssetGroup,
    ...(allOk ? {} : {}),
  };
}

const VERIFICATION_BRANDS = [
  "asics",
  "new balance",
  "on",
  "salomon",
  "hoka one one",
  "saucony",
] as const;

export type CoreExclusionVerification = {
  brand: string;
  batchExplorerOffers: Array<{ offerId: string; included: boolean; reason: string }>;
  neighborNonExplorer: Array<{ offerId: string; included: boolean; reason: string }>;
  pass: boolean;
};

export function verifyCoreExclusionSample(
  listingNodes: ListingFilterNode[],
  batchOffers: Array<OfferAttrs & { shopifyProductId: string }>,
  neighborOffers: OfferAttrs[],
  campaignId: string
): { brands: CoreExclusionVerification[]; allPass: boolean } {
  const nodes = listingNodes.filter((n) => n.campaignId === campaignId);
  const brands: CoreExclusionVerification[] = [];

  for (const brand of VERIFICATION_BRANDS) {
    const batchForBrand = batchOffers.filter(
      (o) => o.brand.trim().toLowerCase() === brand && o.customAttr3 === EXPLORER_ACTIVE_LABEL
    );
    const neighbors = neighborOffers.filter((o) => o.brand.trim().toLowerCase() === brand);

    const batchExplorerOffers = batchForBrand.slice(0, 3).map((o) => {
      const match = offerMatchesListingRules(o, nodes);
      return { offerId: o.offerId, included: match.included, reason: match.reason };
    });
    const neighborNonExplorer = neighbors.slice(0, 3).map((o) => {
      const match = offerMatchesListingRules(o, nodes);
      return { offerId: o.offerId, included: match.included, reason: match.reason };
    });

    const batchOk = batchExplorerOffers.every((o) => !o.included);
    const neighborOk =
      neighborNonExplorer.length === 0 || neighborNonExplorer.every((o) => o.included);
    brands.push({
      brand,
      batchExplorerOffers,
      neighborNonExplorer,
      pass: batchOk && neighborOk,
    });
  }

  return { brands, allPass: brands.every((b) => b.pass) };
}

export function summarizeTouchedLeafPaths(
  listingNodes: ListingFilterNode[],
  touchedLeafIds: string[]
): string[] {
  const byCampaign = new Map<string, ListingFilterNode[]>();
  for (const n of listingNodes) {
    const list = byCampaign.get(n.campaignId) ?? [];
    list.push(n);
    byCampaign.set(n.campaignId, list);
  }
  return touchedLeafIds
    .map((id) => {
      const leaf = listingNodes.find((n) => n.id === id);
      if (!leaf) return null;
      const nodes = byCampaign.get(leaf.campaignId) ?? [];
      return leafPath(nodes, leaf);
    })
    .filter((p): p is string => p != null)
    .sort();
}

/** Post-apply check: explorer-labeled batch offers resolve to excluded paths. */
export function verifyBatchExplorerOffersExcluded(
  listingNodes: ListingFilterNode[],
  batchOffers: Array<OfferAttrs & { shopifyProductId: string }>,
  campaignId: string
): { checked: number; excluded: number; failures: string[] } {
  const nodes = listingNodes.filter((n) => n.campaignId === campaignId);
  const explorerOffers = batchOffers.filter((o) => o.customAttr3 === EXPLORER_ACTIVE_LABEL);
  const failures: string[] = [];
  let excluded = 0;
  for (const offer of explorerOffers) {
    const resolved = resolveIncludedLeafNodesForOffer(offer, nodes);
    if (resolved.included) {
      failures.push(`${offer.offerId}: still included (${resolved.reason})`);
    } else {
      excluded += 1;
    }
  }
  return { checked: explorerOffers.length, excluded, failures };
}
