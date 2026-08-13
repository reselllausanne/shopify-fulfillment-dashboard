import type { GoogleAdsRow } from "@/adsanalytics/google/adsClient";

function asString(value: unknown): string {
  if (value == null) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint" || typeof value === "boolean") {
    return String(value);
  }
  return "";
}

function section(row: GoogleAdsRow, name: string): Record<string, unknown> {
  const value = row[name];
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

export type ListingDimension =
  | { kind: "product_brand"; value: string }
  | { kind: "product_item_id"; value: string }
  | { kind: "product_type"; level: string; value: string }
  | { kind: "product_custom_attribute"; index: string; value: string }
  | { kind: "product_condition"; condition: string }
  | { kind: "product_channel"; channel: string }
  | { kind: "product_category"; categoryId: string; level: string }
  | { kind: "everything_else" };

export type ListingFilterNode = {
  id: string;
  resourceName: string;
  parentResourceName: string | null;
  type: string;
  listingSource: string;
  campaignId: string;
  campaignName: string;
  assetGroupId: string;
  assetGroupName: string;
  dimension: ListingDimension;
};

export type OfferAttrs = {
  offerId: string;
  brand: string;
  productType: string;
  customAttr0: string;
  customAttr1: string;
  customAttr2: string;
  customAttr3: string;
  customAttr4: string;
  feedLabel?: string;
  channel?: string;
  condition?: string;
};

function parseCaseValue(filter: Record<string, unknown>): ListingDimension {
  const caseValue =
    filter.caseValue && typeof filter.caseValue === "object"
      ? (filter.caseValue as Record<string, unknown>)
      : {};

  const brand = caseValue.productBrand as Record<string, unknown> | undefined;
  if (brand && asString(brand.value)) {
    return { kind: "product_brand", value: asString(brand.value) };
  }

  const itemId = caseValue.productItemId as Record<string, unknown> | undefined;
  if (itemId && asString(itemId.value)) {
    return { kind: "product_item_id", value: asString(itemId.value) };
  }

  const productType = caseValue.productType as Record<string, unknown> | undefined;
  if (productType && (asString(productType.value) || asString(productType.level))) {
    return {
      kind: "product_type",
      level: asString(productType.level),
      value: asString(productType.value),
    };
  }

  const custom = caseValue.productCustomAttribute as Record<string, unknown> | undefined;
  if (custom && (asString(custom.value) || asString(custom.index))) {
    return {
      kind: "product_custom_attribute",
      index: asString(custom.index),
      value: asString(custom.value),
    };
  }

  const condition = caseValue.productCondition as Record<string, unknown> | undefined;
  if (condition && asString(condition.condition)) {
    return { kind: "product_condition", condition: asString(condition.condition) };
  }

  const channel = caseValue.productChannel as Record<string, unknown> | undefined;
  if (channel && asString(channel.channel)) {
    return { kind: "product_channel", channel: asString(channel.channel) };
  }

  const category = caseValue.productCategory as Record<string, unknown> | undefined;
  if (category && (asString(category.categoryId) || asString(category.level))) {
    return {
      kind: "product_category",
      categoryId: asString(category.categoryId),
      level: asString(category.level),
    };
  }

  return { kind: "everything_else" };
}

export function mapListingFilterRow(row: GoogleAdsRow): ListingFilterNode | null {
  const campaign = section(row, "campaign");
  const assetGroup = section(row, "assetGroup");
  const filter = section(row, "assetGroupListingGroupFilter");
  const id = asString(filter.id);
  if (!id) return null;
  return {
    id,
    resourceName: asString(filter.resourceName),
    parentResourceName: asString(filter.parentListingGroupFilter) || null,
    type: asString(filter.type),
    listingSource: asString(filter.listingSource),
    campaignId: asString(campaign.id),
    campaignName: asString(campaign.name),
    assetGroupId: asString(assetGroup.id),
    assetGroupName: asString(assetGroup.name),
    dimension: parseCaseValue(filter),
  };
}

export function dimensionLabel(dim: ListingDimension): string {
  switch (dim.kind) {
    case "product_brand":
      return `brand=${dim.value}`;
    case "product_item_id":
      return `item_id=${dim.value}`;
    case "product_type":
      return `product_type[${dim.level}]=${dim.value || "(empty)"}`;
    case "product_custom_attribute":
      return `custom_attr[${dim.index}]=${dim.value || "(empty)"}`;
    case "product_condition":
      return `condition=${dim.condition}`;
    case "product_channel":
      return `channel=${dim.channel}`;
    case "product_category":
      return `category[${dim.level}]=${dim.categoryId}`;
    case "everything_else":
      return "EVERYTHING_ELSE";
  }
}

function customAttrForIndex(offer: OfferAttrs, index: string): string {
  const key = index.toUpperCase();
  if (key.includes("0") || key === "INDEX0") return offer.customAttr0;
  if (key.includes("1") || key === "INDEX1") return offer.customAttr1;
  if (key.includes("2") || key === "INDEX2") return offer.customAttr2;
  if (key.includes("3") || key === "INDEX3") return offer.customAttr3;
  if (key.includes("4") || key === "INDEX4") return offer.customAttr4;
  return "";
}

function dimensionMatches(dim: ListingDimension, offer: OfferAttrs): boolean {
  switch (dim.kind) {
    case "everything_else":
      // Sibling "Everything else" is handled at parent level, not as a positive match here.
      return false;
    case "product_brand":
      return offer.brand.trim().toLowerCase() === dim.value.trim().toLowerCase();
    case "product_item_id":
      return offer.offerId.trim().toLowerCase() === dim.value.trim().toLowerCase();
    case "product_type": {
      const needle = dim.value.trim().toLowerCase();
      if (!needle) return false;
      const levels = offer.productType
        .split(">")
        .map((p) => p.trim().toLowerCase());
      const levelRaw = dim.level.trim().toLowerCase();
      const levelIndex = levelRaw.includes("1")
        ? 0
        : levelRaw.includes("2")
          ? 1
          : levelRaw.includes("3")
            ? 2
            : levelRaw.includes("4")
              ? 3
              : levelRaw.includes("5")
                ? 4
                : null;
      if (levelIndex != null && levels[levelIndex] != null) {
        return levels[levelIndex] === needle || levels[levelIndex]!.includes(needle);
      }
      return levels.some((p) => p === needle || p.includes(needle));
    }
    case "product_custom_attribute": {
      const actual = customAttrForIndex(offer, dim.index).trim().toLowerCase();
      return actual === dim.value.trim().toLowerCase();
    }
    case "product_condition":
      return (
        (offer.condition ?? "").trim().toLowerCase() === dim.condition.trim().toLowerCase() ||
        !(offer.condition ?? "").trim()
      );
    case "product_channel":
      return (
        (offer.channel ?? "ONLINE").trim().toUpperCase() === dim.channel.trim().toUpperCase() ||
        dim.channel === ""
      );
    case "product_category":
      return false; // google product category id not on inventory snapshot
  }
}

export type EffectiveListingRules = {
  campaignId: string;
  campaignName: string;
  assetGroupId: string;
  assetGroupName: string;
  listingSource: string;
  includedPaths: string[];
  excludedPaths: string[];
  subdivisionCount: number;
  unitIncludedCount: number;
  unitExcludedCount: number;
  hasExplicitBrandFilter: boolean;
  brandIncludes: string[];
  brandExcludes: string[];
  customAttrIncludes: Array<{ index: string; value: string }>;
  customAttrExcludes: Array<{ index: string; value: string }>;
  isAllProductsStyle: boolean;
};

function pathForNode(
  node: ListingFilterNode,
  byResource: Map<string, ListingFilterNode>
): ListingFilterNode[] {
  const path: ListingFilterNode[] = [];
  let cur: ListingFilterNode | undefined = node;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.resourceName)) {
    seen.add(cur.resourceName);
    path.unshift(cur);
    if (!cur.parentResourceName) break;
    cur = byResource.get(cur.parentResourceName);
  }
  return path;
}

function pathLabel(path: ListingFilterNode[]): string {
  return path
    .filter((n) => n.type !== "SUBDIVISION" || n.dimension.kind !== "everything_else")
    .map((n) => `${n.type}:${dimensionLabel(n.dimension)}`)
    .join(" > ");
}

export function reconstructEffectiveRules(nodes: ListingFilterNode[]): EffectiveListingRules[] {
  const byAssetGroup = new Map<string, ListingFilterNode[]>();
  for (const n of nodes) {
    const key = `${n.campaignId}|${n.assetGroupId}`;
    const list = byAssetGroup.get(key) ?? [];
    list.push(n);
    byAssetGroup.set(key, list);
  }

  const out: EffectiveListingRules[] = [];
  for (const groupNodes of byAssetGroup.values()) {
    const byResource = new Map(groupNodes.map((n) => [n.resourceName, n]));
    const first = groupNodes[0]!;
    const includedPaths: string[] = [];
    const excludedPaths: string[] = [];
    const brandIncludes: string[] = [];
    const brandExcludes: string[] = [];
    const customAttrIncludes: Array<{ index: string; value: string }> = [];
    const customAttrExcludes: Array<{ index: string; value: string }> = [];

    let subdivisionCount = 0;
    let unitIncludedCount = 0;
    let unitExcludedCount = 0;

    for (const n of groupNodes) {
      if (n.type === "SUBDIVISION") subdivisionCount += 1;
      if (n.type === "UNIT_INCLUDED") {
        unitIncludedCount += 1;
        const path = pathForNode(n, byResource);
        includedPaths.push(pathLabel(path));
        for (const p of path) {
          if (p.dimension.kind === "product_brand") brandIncludes.push(p.dimension.value);
          if (p.dimension.kind === "product_custom_attribute") {
            customAttrIncludes.push({ index: p.dimension.index, value: p.dimension.value });
          }
        }
      }
      if (n.type === "UNIT_EXCLUDED") {
        unitExcludedCount += 1;
        const path = pathForNode(n, byResource);
        excludedPaths.push(pathLabel(path));
        for (const p of path) {
          if (p.dimension.kind === "product_brand") brandExcludes.push(p.dimension.value);
          if (p.dimension.kind === "product_custom_attribute") {
            customAttrExcludes.push({ index: p.dimension.index, value: p.dimension.value });
          }
        }
      }
    }

    const hasExplicitBrandFilter = brandIncludes.length > 0 || brandExcludes.length > 0;
    const isAllProductsStyle =
      unitIncludedCount <= 1 &&
      unitExcludedCount === 0 &&
      !hasExplicitBrandFilter &&
      customAttrIncludes.length === 0;

    out.push({
      campaignId: first.campaignId,
      campaignName: first.campaignName,
      assetGroupId: first.assetGroupId,
      assetGroupName: first.assetGroupName,
      listingSource: first.listingSource,
      includedPaths: [...new Set(includedPaths)],
      excludedPaths: [...new Set(excludedPaths)],
      subdivisionCount,
      unitIncludedCount,
      unitExcludedCount,
      hasExplicitBrandFilter,
      brandIncludes: [...new Set(brandIncludes)],
      brandExcludes: [...new Set(brandExcludes)],
      customAttrIncludes,
      customAttrExcludes,
      isAllProductsStyle,
    });
  }
  return out.sort((a, b) => a.campaignName.localeCompare(b.campaignName));
}

/**
 * Evaluate whether an offer is included by listing-group rules of one asset group.
 * Logic: match UNIT_INCLUDED paths; if any UNIT_EXCLUDED path matches more specifically, exclude.
 * If campaign has only all-products style include, include everything.
 */
export function offerMatchesListingRules(
  offer: OfferAttrs,
  nodes: ListingFilterNode[]
): { included: boolean; matchedPath: string | null; reason: string } {
  if (nodes.length === 0) {
    return { included: false, matchedPath: null, reason: "no_listing_group_nodes" };
  }
  const byResource = new Map(nodes.map((n) => [n.resourceName, n]));
  const included = nodes.filter((n) => n.type === "UNIT_INCLUDED");
  const excluded = nodes.filter((n) => n.type === "UNIT_EXCLUDED");

  const pathMatches = (path: ListingFilterNode[]): boolean => {
    // Require every concrete dimension (non everything_else) on the path to match.
    const dims = path.map((n) => n.dimension).filter((d) => d.kind !== "everything_else");
    if (dims.length === 0) {
      // pure everything-else / all-products unit
      return true;
    }
    return dims.every((d) => dimensionMatches(d, offer));
  };

  let bestInclude: { path: ListingFilterNode[]; label: string } | null = null;
  for (const leaf of included) {
    const path = pathForNode(leaf, byResource);
    if (!pathMatches(path)) continue;
    const label = pathLabel(path);
    if (!bestInclude || path.length > bestInclude.path.length) {
      bestInclude = { path, label };
    }
  }

  if (!bestInclude) {
    // Check all-products style: single UNIT_INCLUDED with everything_else only
    const allProducts = included.some((n) => {
      const path = pathForNode(n, byResource);
      return path.every(
        (p) => p.dimension.kind === "everything_else" || p.type === "SUBDIVISION"
      );
    });
    if (allProducts && excluded.length === 0) {
      return { included: true, matchedPath: "ALL_PRODUCTS", reason: "all_products_unit_included" };
    }
    return { included: false, matchedPath: null, reason: "no_matching_include_path" };
  }

  for (const leaf of excluded) {
    const path = pathForNode(leaf, byResource);
    if (pathMatches(path) && path.length >= bestInclude.path.length) {
      return {
        included: false,
        matchedPath: pathLabel(path),
        reason: "matched_exclude_path",
      };
    }
  }

  return {
    included: true,
    matchedPath: bestInclude.label,
    reason: "matched_include_path",
  };
}

export function resolveIncludedLeafNodesForOffer(
  offer: OfferAttrs,
  nodes: ListingFilterNode[]
): { included: boolean; matchedIncludedLeafs: ListingFilterNode[]; reason: string } {
  if (nodes.length === 0) return { included: false, matchedIncludedLeafs: [], reason: "no_listing_group_nodes" };
  const byResource = new Map(nodes.map((n) => [n.resourceName, n]));
  const included = nodes.filter((n) => n.type === "UNIT_INCLUDED");
  const excluded = nodes.filter((n) => n.type === "UNIT_EXCLUDED");
  const pathMatches = (path: ListingFilterNode[]): boolean => {
    const dims = path.map((n) => n.dimension).filter((d) => d.kind !== "everything_else");
    if (dims.length === 0) return true;
    return dims.every((d) => dimensionMatches(d, offer));
  };

  const matchedCandidates = included
    .map((leaf) => ({ leaf, path: pathForNode(leaf, byResource) }))
    .filter(({ path }) => pathMatches(path));
  if (matchedCandidates.length === 0) {
    return { included: false, matchedIncludedLeafs: [], reason: "no_matching_include_path" };
  }

  // Keep deepest include paths only (more specific).
  // Keep all non-excluded include leaves. Multi-leaf within same campaign/asset-group can be valid.
  const surviving: ListingFilterNode[] = [];
  for (const candidate of matchedCandidates) {
    const excludedMatch = excluded.some((leaf) => {
      const path = pathForNode(leaf, byResource);
      return pathMatches(path) && path.length >= candidate.path.length;
    });
    if (!excludedMatch) surviving.push(candidate.leaf);
  }
  if (surviving.length === 0) {
    return { included: false, matchedIncludedLeafs: [], reason: "matched_exclude_path" };
  }
  return { included: true, matchedIncludedLeafs: surviving, reason: "matched_include_leaf" };
}

export function leafPath(nodes: ListingFilterNode[], leaf: ListingFilterNode): string {
  const byResource = new Map(nodes.map((n) => [n.resourceName, n]));
  return pathLabel(pathForNode(leaf, byResource));
}

export function campaignListingNodes(
  all: ListingFilterNode[],
  campaignId: string
): ListingFilterNode[] {
  return all.filter((n) => n.campaignId === campaignId);
}
