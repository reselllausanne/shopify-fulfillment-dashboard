/**
 * Post-write verification for KicksDB → Shopify featured media mutations.
 * Pure helpers so unit tests can cover the upload URL-match gate.
 */

import {
  GOOGLE_IMAGE_MIN_PX,
  isGoogleReadyImage,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";

export type PostWriteView = {
  featuredMediaId: string | null;
  featuredUrl: string | null;
  featuredWidth: number | null;
  featuredHeight: number | null;
  media: ProductMediaImage[];
};

export type PostWriteVerifyParams = {
  expectedMediaId: string;
  /** Source URL uploaded (StockX/KicksDB). Null/undefined for gallery reorder. */
  expectedSourceUrl: string | null;
  /** upload_reorder requires source↔Shopify CDN match; reorder only checks id+dims. */
  mode: "upload_reorder" | "reorder";
  minimumPx?: number;
};

export type PostWriteVerifyResult =
  | { ok: true; reason: "verified" }
  | {
      ok: false;
      reason: string;
      expectedSourceUrl: string | null;
      actualFeaturedUrl: string | null;
      expectedMediaId: string;
      actualFeaturedMediaId: string | null;
      width: number | null;
      height: number | null;
    };

export function urlMatchLoose(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  try {
    const pa = new URL(a);
    const pb = new URL(b);
    const ta = pa.pathname.split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
    const tb = pb.pathname.split("/").pop()?.split("?")[0]?.toLowerCase() ?? "";
    if (ta && tb && ta === tb) return true;
    const sa = ta.replace(/\.[a-z0-9]+$/, "");
    const sb = tb.replace(/\.[a-z0-9]+$/, "");
    return Boolean(sa && sb && (sa.includes(sb) || sb.includes(sa)));
  } catch {
    return false;
  }
}

function fail(
  reason: string,
  params: PostWriteVerifyParams,
  view: PostWriteView,
  featured: ProductMediaImage | null
): PostWriteVerifyResult {
  return {
    ok: false,
    reason,
    expectedSourceUrl: params.expectedSourceUrl,
    actualFeaturedUrl: featured?.image?.url ?? view.featuredUrl,
    expectedMediaId: params.expectedMediaId,
    actualFeaturedMediaId: view.featuredMediaId,
    width: featured?.image?.width ?? view.featuredWidth,
    height: featured?.image?.height ?? view.featuredHeight,
  };
}

/**
 * Prove featuredMedia is the expected media, both dims ≥ min, and (for uploads)
 * the Shopify CDN asset corresponds to the expected source URL.
 */
export function evaluatePostWriteVerification(
  view: PostWriteView,
  params: PostWriteVerifyParams
): PostWriteVerifyResult {
  const minimumPx = params.minimumPx ?? GOOGLE_IMAGE_MIN_PX;
  if (view.featuredMediaId !== params.expectedMediaId) {
    return fail("featured_media_not_promoted", params, view, null);
  }
  const featured = view.media.find((m) => m.id === params.expectedMediaId) ?? null;
  if (!featured?.image?.url) {
    return fail("featured_media_missing_image", params, view, featured);
  }
  const width = Number(featured.image.width ?? 0);
  const height = Number(featured.image.height ?? 0);
  if (width < minimumPx || height < minimumPx || !isGoogleReadyImage(featured, minimumPx)) {
    return fail("featured_below_500_after_write", params, view, featured);
  }

  if (params.mode === "upload_reorder") {
    if (!params.expectedSourceUrl) {
      return fail("missing_expected_source_url", params, view, featured);
    }
    // BUGFIX: previously `!urlMatchLoose(...) && !view.media.some(id===expected)`
    // was unreachable once featuredMediaId === expectedMediaId (media always contains it).
    // Upload path MUST require a reliable match to the candidate source.
    if (!urlMatchLoose(featured.image.url, params.expectedSourceUrl)) {
      return fail("featured_url_mismatch", params, view, featured);
    }
  }
  // reorder: id + dimensions only (Shopify CDN URL is already the source of truth)
  return { ok: true, reason: "verified" };
}
