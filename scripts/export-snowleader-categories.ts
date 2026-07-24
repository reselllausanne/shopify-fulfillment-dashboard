/**
 * Export full Snowleader category tree for manual Galaxus mapping.
 * Run: npx tsx scripts/export-snowleader-categories.ts
 */
import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import {
  classifySnowleaderCategoryLabel,
  SNOWLEADER_GALAXUS_CATEGORY_IDS,
} from "@/app/lib/snowleaderGalaxusCategories";
import { GALAXUS_CATEGORY_PATHS, type GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

const GRAPHQL_URL = "https://api.snowleader.com/graphql/";
const STORE = "Store_View_CH_DE";

type CatNode = {
  id?: number | string | null;
  name?: string | null;
  url_path?: string | null;
  level?: number | null;
  product_count?: number | null;
  children?: CatNode[] | null;
};

type FlatCat = {
  id: string;
  name: string;
  urlPath: string;
  level: number;
  productCount: number;
  parentId: string;
  parentName: string;
};

const SCRAPE_IDS = new Set(SNOWLEADER_GALAXUS_CATEGORY_IDS);

function buildDeepQuery(depth: number): string {
  const leaf = "id name url_path level product_count";
  let nested = leaf;
  for (let i = 0; i < depth; i++) {
    nested = `${leaf} children { ${nested} }`;
  }
  return `query SnowleaderCategories { categories { items { ${nested} } } }`;
}

async function fetchCategories(depth: number): Promise<CatNode[]> {
  const res = await fetch(GRAPHQL_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      Store: STORE,
      Origin: "https://www.snowleader.ch",
      Referer: "https://www.snowleader.ch/",
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ query: buildDeepQuery(depth) }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const json = (await res.json()) as {
    data?: { categories?: { items?: CatNode[] } };
    errors?: Array<{ message?: string }>;
  };
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).filter(Boolean).join("; "));
  }
  return json.data?.categories?.items ?? [];
}

function flattenTree(nodes: CatNode[], parent: FlatCat | null, out: FlatCat[]) {
  for (const node of nodes) {
    const id = String(node.id ?? "").trim();
    if (!id) continue;
    const row: FlatCat = {
      id,
      name: String(node.name ?? "").trim(),
      urlPath: String(node.url_path ?? "").trim(),
      level: Number(node.level ?? 0),
      productCount: Number(node.product_count ?? 0),
      parentId: parent?.id ?? "",
      parentName: parent?.name ?? "",
    };
    out.push(row);
    const children = Array.isArray(node.children) ? node.children : [];
    if (children.length) flattenTree(children, row, out);
  }
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function galaxusPathForKind(kind: GalaxusProductKind | null): string {
  if (!kind || kind === "unknown") return "";
  return GALAXUS_CATEGORY_PATHS[kind] ?? "";
}

async function main() {
  const items = await fetchCategories(7);
  const flat: FlatCat[] = [];
  flattenTree(items, null, flat);

  const header = [
    "snowleader_category_id",
    "name",
    "url_path",
    "level",
    "product_count",
    "parent_id",
    "parent_name",
    "in_scrape_list",
    "auto_galaxus_kind",
    "auto_galaxus_path",
    "your_galaxus_produkttyp",
    "notes",
  ];

  const lines = [header.join(",")];
  for (const row of flat.sort((a, b) => a.level - b.level || a.name.localeCompare(b.name))) {
    const autoKind = classifySnowleaderCategoryLabel(row.name);
    lines.push(
      [
        row.id,
        csvEscape(row.name),
        csvEscape(row.urlPath),
        String(row.level),
        String(row.productCount),
        row.parentId,
        csvEscape(row.parentName),
        SCRAPE_IDS.has(row.id) ? "yes" : "no",
        autoKind ?? "",
        csvEscape(galaxusPathForKind(autoKind)),
        "",
        "",
      ].join(",")
    );
  }

  const outDir = join(process.cwd(), "artifacts");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, "snowleader-categories-for-galaxus-mapping.csv");
  writeFileSync(outPath, lines.join("\n") + "\n", "utf8");

  const inScrape = flat.filter((r) => SCRAPE_IDS.has(r.id));
  const notInScrape = flat.filter((r) => !SCRAPE_IDS.has(r.id) && r.productCount > 0);
  const unmappedWithProducts = notInScrape.filter((r) => !classifySnowleaderCategoryLabel(r.name));
  const mappedNotScraped = notInScrape.filter((r) => classifySnowleaderCategoryLabel(r.name));

  console.log(JSON.stringify({
    totalCategories: flat.length,
    withProducts: flat.filter((r) => r.productCount > 0).length,
    inScrapeList: inScrape.length,
    inScrapeProductSum: inScrape.reduce((s, r) => s + r.productCount, 0),
    notInScrapeWithProducts: notInScrape.length,
    notInScrapeProductSum: notInScrape.reduce((s, r) => s + r.productCount, 0),
    autoKindButNotScraped: mappedNotScraped.length,
    noAutoKindNotScraped: unmappedWithProducts.length,
    output: outPath,
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
