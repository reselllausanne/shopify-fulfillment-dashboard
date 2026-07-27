import { writeFileSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { classifyReicheltGalaxusKind } from "@/app/lib/reicheltGalaxusCategories";
import { GALAXUS_CATEGORY_PATHS } from "@/galaxus/exports/galaxusCategoryPaths";
import { extractReicheltCategorySlug, toReicheltChFrCategoryUrl } from "@/app/lib/reicheltClient";

const sitemapDir = process.argv[2] || "/tmp/rei-cat-sitemaps";

const mapped: Array<{ slug: string; label: string; kind: string; galaxusPath: string; url: string }> = [];
const unmapped: Array<{ slug: string; label: string; url: string }> = [];

for (const file of readdirSync(sitemapDir).filter((f) => f.endsWith(".xml")).sort()) {
  const xml = readFileSync(join(sitemapDir, file), "utf8");
  if (xml.length < 200) continue;
  for (const match of xml.matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const ch = toReicheltChFrCategoryUrl(match[1].trim());
    if (!ch) continue;
    const slug = extractReicheltCategorySlug(ch);
    if (!slug) continue;
    const kind = classifyReicheltGalaxusKind({ title: slug, supplierProductType: slug });
    const slugRaw = decodeURIComponent(ch).split("/").pop() ?? slug;
    if (kind) {
      mapped.push({
        slug: slugRaw,
        label: slug,
        kind,
        galaxusPath: GALAXUS_CATEGORY_PATHS[kind] ?? kind,
        url: ch,
      });
    } else {
      unmapped.push({ slug: slugRaw, label: slug, url: ch });
    }
  }
}

function csvEscape(value: string) {
  return `"${value.replace(/"/g, '""')}"`;
}

writeFileSync(
  "artifacts/reichelt-unmapped-categories.csv",
  ["label,slug,url", ...unmapped.sort((a, b) => a.label.localeCompare(b.label)).map((u) => `${csvEscape(u.label)},${csvEscape(u.slug)},${csvEscape(u.url)}`)].join("\n")
);
writeFileSync(
  "artifacts/reichelt-mapped-categories.csv",
  [
    "label,slug,kind,galaxus_path,url",
    ...mapped
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((m) => `${csvEscape(m.label)},${csvEscape(m.slug)},${m.kind},${csvEscape(m.galaxusPath)},${csvEscape(m.url)}`),
  ].join("\n")
);

console.log(
  JSON.stringify(
    {
      totalCategories: mapped.length + unmapped.length,
      mapped: mapped.length,
      unmapped: unmapped.length,
      unmappedList: unmapped.sort((a, b) => a.label.localeCompare(b.label)),
    },
    null,
    2
  )
);
