import { normalizeStxProductSlug } from "@/galaxus/stx/forceImportSlugs";

export function isLegoStxSlug(value: unknown): boolean {
  const slug = normalizeStxProductSlug(value);
  return slug.includes("lego");
}

export function isLegoStxProduct(product: {
  slug?: unknown;
  url_key?: unknown;
  urlKey?: unknown;
  title?: unknown;
  primary_title?: unknown;
  name?: unknown;
} | null | undefined): boolean {
  const slug = normalizeStxProductSlug(
    product?.slug ?? product?.url_key ?? product?.urlKey
  );
  if (isLegoStxSlug(slug)) return true;
  const title = String(product?.title ?? product?.primary_title ?? product?.name ?? "")
    .trim()
    .toLowerCase();
  return title.includes("lego");
}
