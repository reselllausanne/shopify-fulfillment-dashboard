/**
 * Compare Galaxus category + size-spec classification before/after KickDB breadcrumb wiring.
 * Usage: npx tsx scripts/analyze-galaxus-category-impact.ts
 */
import { loadMasterAndSpecsExportCandidates } from "@/galaxus/exports/feedMappingLoader";
import {
  classifyGalaxusProductKind,
  classifyFromBreadcrumbAliases,
  resolveGalaxusProductCategoryPath,
  requiresGalaxusSizeSpec,
} from "@/galaxus/exports/productClassification";
import { extractKickdbClassificationSignals } from "@/galaxus/kickdb/classificationSignals";
import { buildGalaxusSizeSpecRow } from "@/galaxus/exports/sizeSpecifications";

const SUPPLIERS = ["ner", "stx", "wel"] as const;

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function oldClassify(input: {
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  sizeRaw?: string | null;
}) {
  return classifyGalaxusProductKind({
    title: input.title,
    description: input.description,
    brand: input.brand,
    // no breadcrumbAliases / productType — simulates pre-fix export
  });
}

function oldCategoryPath(input: {
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  breadcrumbs?: string[] | null;
}) {
  const breadcrumbs = (input.breadcrumbs ?? []).filter(Boolean);
  if (breadcrumbs.length > 0) return breadcrumbs.join(" > ").slice(0, 200);
  const kind = oldClassify(input);
  const paths: Record<string, string> = {
    sneakers: "Mode > Alles in Mode > Schuhe > Sneakers",
    shorts: "Mode > Alles in Mode > Bekleidung > Shorts",
    apparel: "Mode > Alles in Mode > Bekleidung",
    unknown: "Mode > Alles in Mode > Schuhe > Sneakers",
    trousers: "Mode > Alles in Mode > Bekleidung > Hosen",
    tumbler: "Sport + Toys > Wasserflaschen + Thermosflaschen",
    camera: "IT + Multimedia > Foto + Video > Kameras",
    watch: "Mode > Alles in Mode > Uhren",
    lego: "Sport + Toys > LEGO",
    backpack: "Mode > Taschen + Gepäck > Rucksack",
    phone: "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Weiteres Smartphone Zubehör",
  };
  return paths[kind] ?? paths.unknown;
}

function newClassify(input: {
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  rawJson?: unknown;
  sizeRaw?: string | null;
}) {
  const signals = extractKickdbClassificationSignals(input.rawJson);
  return classifyGalaxusProductKind({
    title: input.title,
    description: input.description,
    brand: input.brand,
    breadcrumbAliases: signals.breadcrumbAliases,
    productType: signals.productType,
    sizeRaw: input.sizeRaw,
  });
}

function newCategoryPath(input: {
  title?: string | null;
  description?: string | null;
  brand?: string | null;
  rawJson?: unknown;
  sizeRaw?: string | null;
}) {
  const signals = extractKickdbClassificationSignals(input.rawJson);
  return resolveGalaxusProductCategoryPath({
    title: input.title,
    description: input.description,
    brand: input.brand,
    breadcrumbAliases: signals.breadcrumbAliases,
    productType: signals.productType,
    sizeRaw: input.sizeRaw,
  });
}

async function analyzeSupplier(supplier: string) {
  const loaded = await loadMasterAndSpecsExportCandidates({ supplier, all: true });
  const candidates = loaded.specsExportCandidates;

  let withRawJson = 0;
  let withBreadcrumbs = 0;
  let kindChanged = 0;
  let pathChanged = 0;
  let sizeSpecGained = 0;
  let sizeSpecLost = 0;
  const pathCounts: Record<string, number> = {};
  const kindCounts: Record<string, number> = {};
  const signalSource: Record<string, number> = {
    breadcrumb: 0,
    product_type: 0,
    title_regex: 0,
    size_raw: 0,
    brand_shortlist: 0,
    unknown_default: 0,
  };
  const kindChanges: Array<{ providerKey: string; title: string; oldKind: string; newKind: string; aliases: string }> = [];
  const pathChanges: Array<{ providerKey: string; title: string; oldPath: string; newPath: string }> = [];
  const sizeSpecLostSamples: Array<{ providerKey: string; title: string; old: boolean; new: boolean }> = [];

  for (const c of candidates) {
    const variant = c.variant as any;
    const product = c.product as any;
    const title = sanitizeText(variant?.supplierProductName ?? product?.name ?? "");
    const brand = variant?.supplierBrand ?? product?.brand ?? null;
    const rawJson = product?.rawJson ?? null;
    const sizeRaw = variant?.sizeRaw ?? null;
    const signals = extractKickdbClassificationSignals(rawJson);

    if (rawJson) withRawJson += 1;
    if (signals.breadcrumbAliases.length > 0) withBreadcrumbs += 1;

    const oldKind = oldClassify({ title, description: product?.description, brand, sizeRaw });
    const newKind = newClassify({ title, description: product?.description, brand, rawJson, sizeRaw });
    const oldPath = oldCategoryPath({
      title,
      description: product?.description,
      brand,
      breadcrumbs: signals.breadcrumbValues,
    });
    const newPath = newCategoryPath({ title, description: product?.description, brand, rawJson, sizeRaw });

    kindCounts[newKind] = (kindCounts[newKind] ?? 0) + 1;
    pathCounts[newPath] = (pathCounts[newPath] ?? 0) + 1;

    // signal source for new kind
    const brandLower = sanitizeText(brand).toLowerCase();
    const brandShortlist = ["stanley", "sprayground", "canon", "swatch", "lego", "pokemon", "pokémon", "topps", "analogue", "new era", "united states mint"];
    if (brandLower && brandShortlist.includes(brandLower)) signalSource.brand_shortlist += 1;
    else if (classifyFromBreadcrumbAliases(signals.breadcrumbAliases)) signalSource.breadcrumb += 1;
    else if (signals.productType && classifyGalaxusProductKind({ productType: signals.productType }) !== "unknown")
      signalSource.product_type += 1;
    else if (newKind === "sneakers" && /^(?:EU\s+)?\d/i.test(String(sizeRaw ?? "")) && oldKind === "unknown")
      signalSource.size_raw += 1;
    else if (newKind !== "unknown") signalSource.title_regex += 1;
    else signalSource.unknown_default += 1;

    if (oldKind !== newKind) {
      kindChanged += 1;
      if (kindChanges.length < 15) {
        kindChanges.push({
          providerKey: c.providerKey,
          title: title.slice(0, 80),
          oldKind,
          newKind,
          aliases: signals.breadcrumbAliases.join(" > ") || signals.productType || "(none)",
        });
      }
    }
    if (oldPath !== newPath) {
      pathChanged += 1;
      if (pathChanges.length < 15) {
        pathChanges.push({
          providerKey: c.providerKey,
          title: title.slice(0, 80),
          oldPath: oldPath.slice(0, 80),
          newPath: newPath.slice(0, 80),
        });
      }
    }

    const oldSizeRow = buildGalaxusSizeSpecRow({
      providerKey: c.providerKey,
      sizeRaw,
      supplierTitle: title,
      supplierSku: variant?.supplierSku,
      kickdbTitle: product?.name,
      kickdbDescription: product?.description,
      brand,
      // no breadcrumbAliases — old behavior approximated by omitting them
    });
    const newSizeRow = buildGalaxusSizeSpecRow({
      providerKey: c.providerKey,
      sizeRaw,
      supplierTitle: title,
      supplierSku: variant?.supplierSku,
      kickdbTitle: product?.name,
      kickdbDescription: product?.description,
      brand,
      breadcrumbAliases: signals.breadcrumbAliases,
      productType: signals.productType,
    });

    const oldHas = !!oldSizeRow;
    const newHas = !!newSizeRow;
    if (!oldHas && newHas) sizeSpecGained += 1;
    if (oldHas && !newHas) {
      sizeSpecLost += 1;
      if (sizeSpecLostSamples.length < 10) {
        sizeSpecLostSamples.push({ providerKey: c.providerKey, title: title.slice(0, 80), old: oldHas, new: newHas });
      }
    }
  }

  return {
    supplier: supplier.toUpperCase(),
    total: candidates.length,
    withRawJson,
    withBreadcrumbs,
    pctWithBreadcrumbs: candidates.length ? Math.round((withBreadcrumbs / candidates.length) * 100) : 0,
    kindChanged,
    pathChanged,
    sizeSpecGained,
    sizeSpecLost,
    kindCounts,
    pathCounts,
    signalSource,
    kindChanges,
    pathChanges,
    sizeSpecLostSamples,
  };
}

async function main() {
  const results = [];
  for (const s of SUPPLIERS) {
    console.error(`Analyzing ${s.toUpperCase()}...`);
    results.push(await analyzeSupplier(s));
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => process.exit(0));
