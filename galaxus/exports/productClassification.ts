export type GalaxusProductKind =
  | "sneakers"
  | "shorts"
  | "apparel"
  | "phone"
  | "backpack"
  | "bag"
  | "pool_robot"
  | "unknown";

type ClassificationInput = {
  title?: string | null;
  description?: string | null;
  category?: string | null;
  secondaryCategory?: string | null;
  productType?: string | null;
  breadcrumbs?: string[] | null;
};

function sanitizeText(value?: string | null): string {
  if (!value) return "";
  return String(value).replace(/[™®©]/g, "").replace(/\s+/g, " ").trim();
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, " ");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

function normalizeBreadcrumbs(values?: string[] | null): string[] {
  if (!Array.isArray(values)) return [];
  return values.map((item) => sanitizeText(item)).filter(Boolean);
}

function combinedText(input: ClassificationInput): string {
  const breadcrumbText = normalizeBreadcrumbs(input.breadcrumbs).join(" ");
  const parts = [
    sanitizeText(input.title ?? ""),
    sanitizeText(stripHtml(input.description ?? "")),
    sanitizeText(input.category ?? ""),
    sanitizeText(input.secondaryCategory ?? ""),
    sanitizeText(input.productType ?? ""),
    breadcrumbText,
  ];
  return parts.join(" ").toLowerCase();
}

const FOOTWEAR_RE =
  /\b(sneaker|samba|gazelle|campus|superstar|jordan|dunk|air ?max|yeezy|asics|new ?balance|salomon|shoe|shoes|trainer|boot)\b/i;
const SHORTS_RE = /\b(shorts?|sweatshort|sweat short)\b/i;
const APPAREL_RE =
  /\b(hoodie|sweatshirt|crewneck|tee|t-shirt|shirt|pants|jogger|jacket|pullover|sweater|track ?pant|essentials)\b/i;
const BACKPACK_RE = /\b(backpack|rucksack|bookbag|daypack)\b/i;
const BAG_RE = /\b(bag|tote|duffel|duffle|gym ?bag|crossbody|sling ?bag|messenger ?bag|handbag|bum ?bag|fanny ?pack|waist ?bag)\b/i;
const PHONE_RE =
  /\b(phone|smartphone|ios|android|screen ?time|digital detox|nfc|magnet|distraction|app store|google play|the brick|getbrick|phone blocker|unbrick|bricked)\b/i;
const POOL_ROBOT_RE =
  /\b(pool|pool cleaner|pool cleaning|pool robot|poolroboter|poolskimmer|skimmer|robotic pool|swimming pool|piscine|solar ?panel)\b/i;

export function requiresGalaxusSizeSpec(kind: GalaxusProductKind): boolean {
  return kind === "apparel" || kind === "shorts" || kind === "sneakers";
}
export function classifyGalaxusProductKind(input: ClassificationInput): GalaxusProductKind {
  const text = combinedText(input);
  if (!text) return "unknown";
  if (SHORTS_RE.test(text)) return "shorts";
  if (BACKPACK_RE.test(text)) return "backpack";
  if (BAG_RE.test(text)) return "bag";
  if (POOL_ROBOT_RE.test(text)) return "pool_robot";
  if (PHONE_RE.test(text)) return "phone";
  if (FOOTWEAR_RE.test(text)) return "sneakers";
  if (APPAREL_RE.test(text)) return "apparel";
  return "unknown";
}

export function isFootwearKind(kind: GalaxusProductKind): boolean {
  return kind === "sneakers";
}

export function resolveGalaxusProductCategoryPath(input: ClassificationInput): string {
  const breadcrumbs = normalizeBreadcrumbs(input.breadcrumbs);
  if (breadcrumbs.length > 0) return truncate(breadcrumbs.join(" > "), 200);

  const category = sanitizeText(input.category ?? "");
  const secondary = sanitizeText(input.secondaryCategory ?? "");
  const productType = sanitizeText(input.productType ?? "");
  if (category && secondary) return truncate(`${category} > ${secondary}`, 200);
  if (category) return truncate(category, 200);
  if (productType) return truncate(productType, 200);

  const kind = classifyGalaxusProductKind(input);
  if (kind === "shorts") return "Mode > Alles in Mode > Bekleidung > Shorts";
  if (kind === "apparel") return "Mode > Alles in Mode > Bekleidung";
  if (kind === "backpack") return "Mode > Taschen + Gepäck > Rucksack";
  if (kind === "bag") return "Mode > Taschen + Gepäck > Tasche";
  if (kind === "phone") {
    return "IT + Multimedia > Smartphones + Tablets > Smartphone Zubehör > Weiteres Smartphone Zubehör";
  }
  if (kind === "pool_robot") {
    return "Do it + Garden > Pool + Spa > Pool > Poolroboter";
  }
  return "Mode > Alles in Mode > Schuhe > Sneakers";
}

export function resolveGalaxusDescription(input: {
  description?: string | null;
  title?: string | null;
  brand?: string | null;
  category?: string | null;
  secondaryCategory?: string | null;
  productType?: string | null;
  breadcrumbs?: string[] | null;
}): string {
  const existing = sanitizeText(stripHtml(input.description ?? ""));
  if (existing) return truncate(existing, 4000);

  const title = sanitizeText(input.title ?? "");
  const brand = sanitizeText(input.brand ?? "");
  const kind = classifyGalaxusProductKind({
    title,
    category: input.category,
    secondaryCategory: input.secondaryCategory,
    productType: input.productType,
    breadcrumbs: input.breadcrumbs,
  });
  const subject = title || "Product";
  const prefix = brand ? `${subject} by ${brand}` : subject;

  if (kind === "shorts") {
    return `${prefix}. Everyday shorts with comfortable fit and versatile styling.`;
  }
  if (kind === "apparel") {
    return `${prefix}. Casual apparel piece designed for daily wear and comfort.`;
  }
  if (kind === "backpack") {
    return `${prefix}. Functional backpack with durable construction and organized compartments for everyday carry.`;
  }
  if (kind === "bag") {
    return `${prefix}. Versatile bag designed for everyday use with practical storage and durable materials.`;
  }
  if (kind === "phone") {
    return `${prefix}. Smartphone accessory designed to support focus and reduce distractions.`;
  }
  if (kind === "pool_robot") {
    return `${prefix}. Intelligent robotic pool cleaner designed for autonomous surface cleaning with app control and high-capacity debris collection.`;
  }
  return `${prefix}. Lifestyle sneakers with durable construction and all-day comfort.`;
}
