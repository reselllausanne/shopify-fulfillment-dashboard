export const GOOGLE_IMAGE_MIN_PX = 500;

export type ProductMediaImage = {
  id: string;
  image: {
    url: string;
    width: number | null;
    height: number | null;
  } | null;
};

export type HeroRepairDecision =
  | { action: "skip"; reason: "no_images" | "hero_valid" | "no_valid_replacement" }
  | {
      action: "reorder";
      oldHero: ProductMediaImage;
      newHero: ProductMediaImage;
    };

export function isPlaceholderImage(url: string): boolean {
  const value = url.toLowerCase();
  return (
    value.includes("product-placeholder") ||
    value.includes("placeholder-default") ||
    value.includes("/placeholder.")
  );
}

export function isGoogleReadyImage(
  media: ProductMediaImage,
  minimumPx = GOOGLE_IMAGE_MIN_PX
): boolean {
  const image = media.image;
  return Boolean(
    image &&
      !isPlaceholderImage(image.url) &&
      Number(image.width ?? 0) >= minimumPx &&
      Number(image.height ?? 0) >= minimumPx
  );
}

/**
 * Preserve gallery contents. Promote the first already-attached Google-ready
 * image only when the current Shopify hero is too small or a placeholder.
 */
export function chooseHeroRepair(
  media: ProductMediaImage[],
  minimumPx = GOOGLE_IMAGE_MIN_PX
): HeroRepairDecision {
  const images = media.filter((item) => item.id && item.image?.url);
  if (images.length === 0) return { action: "skip", reason: "no_images" };

  const hero = images[0]!;
  if (isGoogleReadyImage(hero, minimumPx)) {
    return { action: "skip", reason: "hero_valid" };
  }

  const replacement = images.slice(1).find((item) => isGoogleReadyImage(item, minimumPx));
  if (!replacement) {
    return { action: "skip", reason: "no_valid_replacement" };
  }
  return { action: "reorder", oldHero: hero, newHero: replacement };
}
