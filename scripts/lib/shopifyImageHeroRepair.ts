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
 * Preserve gallery contents. Promote a Google-ready gallery image only when the
 * real Shopify featuredMedia (by id) is too small or a placeholder.
 *
 * Never assume media[0] is the hero — pass featuredMediaId explicitly.
 */
export function chooseHeroRepair(
  media: ProductMediaImage[],
  featuredMediaId: string | null | undefined,
  minimumPx = GOOGLE_IMAGE_MIN_PX
): HeroRepairDecision {
  const images = media.filter((item) => item.id && item.image?.url);
  if (images.length === 0) return { action: "skip", reason: "no_images" };

  const hero =
    (featuredMediaId ? images.find((item) => item.id === featuredMediaId) : undefined) ?? null;
  if (!hero) {
    // Featured id missing or not in nodes — do not invent a hero from media[0].
    const replacement = images.find((item) => isGoogleReadyImage(item, minimumPx));
    if (!replacement) return { action: "skip", reason: "no_valid_replacement" };
    // Without a known old hero, still allow promoting a valid gallery image.
    return {
      action: "reorder",
      oldHero: images[0]!,
      newHero: replacement,
    };
  }

  if (isGoogleReadyImage(hero, minimumPx)) {
    return { action: "skip", reason: "hero_valid" };
  }

  const replacement = images.find(
    (item) => item.id !== hero.id && isGoogleReadyImage(item, minimumPx)
  );
  if (!replacement) {
    return { action: "skip", reason: "no_valid_replacement" };
  }
  return { action: "reorder", oldHero: hero, newHero: replacement };
}
