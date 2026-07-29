import type { GalaxusProductKind } from "@/galaxus/exports/galaxusCategoryPaths";

const NSO_LABEL_TO_KIND: Array<{ pattern: RegExp; kind: GalaxusProductKind }> = [
  { pattern: /yeezy slide|slide|clog|crocs|tazz|disquette|tasman|neumel|lowmel|ugg/i, kind: "slippers" },
  { pattern: /sandal|flip.?flop/i, kind: "sandals" },
  { pattern: /boot/i, kind: "hiking_boots" },
  { pattern: /running|vomero|pegasus|hoka|on running|\bon\b/i, kind: "running_shoes" },
  { pattern: /sneaker|dunk|jordan|air force|air max|new balance|adidas|asics|puma|vans|converse|yeezy|nb /i, kind: "sneakers" },
];

export function classifyNewsoleGalaxusKind(input: {
  title?: string | null;
  categories?: string[];
  brand?: string | null;
}): GalaxusProductKind | null {
  const hay = [input.title, input.brand, ...(input.categories ?? [])].filter(Boolean).join(" ");
  if (!hay.trim()) return null;
  for (const rule of NSO_LABEL_TO_KIND) {
    if (rule.pattern.test(hay)) return rule.kind;
  }
  return "sneakers";
}
