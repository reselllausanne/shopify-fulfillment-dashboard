const DEFAULT_CATEGORY = "Textile et chaussures/chaussant/chaussures";

const CATEGORY_RULES: Array<{ category: string; keywords: string[] }> = [
  {
    category: "Textile et chaussures/chaussures techniques/chaussures à crampons",
    keywords: ["crampon", "cleat", "football", "soccer", "foot"],
  },
  {
    category: "Textile et chaussures/chaussant/bottes",
    keywords: ["botte", "bottes", "boot", "boots", "ankle boot", "chelsea"],
  },
  {
    category: "Textile et chaussures/chaussant/chaussons",
    keywords: ["chausson", "slipper", "pantoufle", "mule"],
  },
  {
    category: "Textile et chaussures/accessoires vêtement/bonnet",
    keywords: ["bonnet", "beanie"],
  },
  {
    category: "Textile et chaussures/accessoires vêtement/Ceinture",
    keywords: ["ceinture", "belt"],
  },
  {
    category: "Textile et chaussures/vêtement - haut/veste",
    keywords: ["veste", "jacket", "coat"],
  },
  {
    category: "Textile et chaussures/vêtement - haut/t-shirt",
    keywords: ["t-shirt", "tshirt", "tee", "t shirt"],
  },
  {
    category: "Textile et chaussures/vêtement - haut/pull sweat polaire",
    keywords: ["sweat", "hoodie", "pull", "sweatshirt"],
  },
  {
    category: "Textile et chaussures/vêtement - haut/débardeur",
    keywords: ["débardeur", "tank", "singlet"],
  },
  {
    category: "Textile et chaussures/vêtement - haut/chemise",
    keywords: ["chemise", "shirt"],
  },
  {
    category: "Textile et chaussures/ensemble vêtement/survêtement",
    keywords: ["survêtement", "tracksuit"],
  },
];

function normalize(value?: string | null) {
  return value ? value.toString().toLowerCase() : "";
}

export function resolveDecathlonCategory(input: {
  name?: string | null;
  description?: string | null;
  brand?: string | null;
}): string {
  const haystack = [input.name, input.description, input.brand].map(normalize).join(" ");
  for (const rule of CATEGORY_RULES) {
    if (rule.keywords.some((keyword) => haystack.includes(keyword))) {
      return rule.category;
    }
  }
  return DEFAULT_CATEGORY;
}
