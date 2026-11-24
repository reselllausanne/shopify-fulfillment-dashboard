import type { ProductFromData } from "@/shopify/restock/createProductFromData";

/**
 * Shopify listing fields identical in shape to a normal (StockX-pipeline) sneaker product:
 * tags ["New"], productType "Sneakers", taxonomy category, French description,
 * SEO title/description, option "Taille", SKU `<STYLE>-<EU>`, custom.* metafields.
 */

const GID_SNEAKERS = "gid://shopify/TaxonomyCategory/aa-8-8";
const GID_KIDS_SNEAKERS = "gid://shopify/TaxonomyCategory/aa-8-11-5";

export function dedupeColor(color: string | null | undefined): string {
  const parts = String(color ?? "")
    .split("/")
    .map((s) => s.trim())
    .filter(Boolean);
  return Array.from(new Set(parts)).join("/");
}

export function isKidsProduct(data: ProductFromData & { genders?: string[] }): boolean {
  const g = (data.genders ?? []).map((x) => x.toUpperCase());
  const hasC = data.sizes.some((s) => /C$/i.test(s.size));
  const sub = `${data.name} ${data.subtitle ?? ""}`.toLowerCase();
  return hasC || /\b(kleinkind|baby|babys|toddler|enfant|kids?)\b/.test(sub) || (g.length > 0 && g.every((x) => x === "GIRLS" || x === "BOYS"));
}

function genderLabel(data: ProductFromData & { genders?: string[] }): string {
  const g = (data.genders ?? []).map((x) => x.toUpperCase());
  if (g.includes("MEN") && g.includes("WOMEN")) return "Unisexe";
  if (g.includes("MEN")) return "Homme";
  if (g.includes("WOMEN")) return "Femme";
  if (g.length) return "Enfant";
  return "Unisexe";
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export type ShopifyListing = {
  title: string;
  handle: string;
  productType: string;
  tags: string[];
  category: string;
  descriptionHtml: string;
  seoTitle: string;
  seoDescription: string;
  option: string;
  productMetafields: Array<{ namespace: string; key: string; type: string; value: string }>;
  variantSku: (size: string) => string;
};

export function slugify(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildShopifyListing(
  data: ProductFromData & { subtitle?: string | null; genders?: string[] }
): ShopifyListing {
  const brand = data.brand.trim();
  const name = data.name.trim();
  const baseName = name.toLowerCase().startsWith(brand.toLowerCase()) ? name : `${brand} ${name}`;
  const color = dedupeColor(data.color);
  const title = color ? `${baseName} ${color}` : baseName;
  const gender = genderLabel(data);
  const kids = isKidsProduct(data);
  const style = data.sku.trim();

  const lines = [
    color ? `<strong>Coloris :</strong> ${esc(color)}` : null,
    `<strong>Code style :</strong> ${esc(style)}`,
    `<strong>Genre :</strong> ${esc(gender)}`,
    `<strong>Catégorie :</strong> ${kids ? "Chaussures enfant" : "Chaussures"} &gt; Sneakers`,
    `<strong>SKU :</strong> ${esc(style)}`,
  ].filter(Boolean);

  const descriptionHtml =
    `<p>Découvrez ${esc(baseName)} de ${esc(brand)}${color ? `, coloris ${esc(color)}` : ""} — ${esc(gender)}. ` +
    `Disponible chez Resell Lausanne, chaque article est authentifié et vérifié manuellement avant expédition. ` +
    `Livraison en Suisse et en Europe.</p>\n<p>${lines.join("<br>")}</p>\n` +
    `<p>Produit 100% authentique. Resell Lausanne sélectionne uniquement des articles en parfait état.</p>`;

  const seoTitle = `${title} | Resell Lausanne Suisse`;
  const seoDescription = `${title} authentique en Suisse. ${brand} 100% vérifié, livraison rapide. Achetez chez Resell Lausanne.`;

  return {
    title,
    handle: slugify(title),
    productType: "Sneakers",
    tags: ["New"],
    category: kids ? GID_KIDS_SNEAKERS : GID_SNEAKERS,
    descriptionHtml,
    seoTitle: seoTitle.slice(0, 70),
    seoDescription: seoDescription.slice(0, 320),
    option: "Taille",
    productMetafields: [
      { namespace: "custom", key: "model", type: "single_line_text_field", value: baseName },
      ...(color ? [{ namespace: "custom", key: "colorway", type: "single_line_text_field", value: color }] : []),
      { namespace: "custom", key: "style_code", type: "single_line_text_field", value: style },
      { namespace: "categories", key: "product_category", type: "single_line_text_field", value: "sneakers" },
      { namespace: "global", key: "title_tag", type: "string", value: seoTitle.slice(0, 70) },
      { namespace: "global", key: "description_tag", type: "string", value: seoDescription.slice(0, 320) },
    ],
    variantSku: (size: string) => `${style}-${size.trim()}`,
  };
}
