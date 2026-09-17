#!/usr/bin/env npx tsx
/**
 * Audit KicksDB → Shopify hero images (Simprosys image_link = featuredMedia).
 *
 * Samples:
 *   - recently synced / backfill candidates
 *   - products with multiple variants
 *   - optional: filter by handle / brand / limit
 *
 * Output columns: shopifyId, sku, currentImage, width, height, expectedKickdbImage,
 * thumbnailDetected, googleReady, status
 *
 * Usage:
 *   npx tsx scripts/audit-kicksdb-shopify-images.ts
 *   npx tsx scripts/audit-kicksdb-shopify-images.ts --limit=50
 *   npx tsx scripts/audit-kicksdb-shopify-images.ts --handle=air-jordan-1-retro-high
 *   npx tsx scripts/audit-kicksdb-shopify-images.ts --out=tmp/kicksdb-image-audit.jsonl
 */
import "dotenv/config";

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { prisma } from "@/app/lib/prisma";
import {
  isKickdbThumbnailUrl,
  resolveCanonicalKickdbImage,
  KICKDB_GOOGLE_MIN_PX,
} from "@/galaxus/kickdb/imageResolver";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import {
  GOOGLE_IMAGE_MIN_PX,
  isGoogleReadyImage,
  type ProductMediaImage,
} from "@/scripts/lib/shopifyImageHeroRepair";

function stringFlag(name: string): string | undefined {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length);
}

function intFlag(name: string, fallback: number): number {
  const raw = stringFlag(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) throw new Error(`Invalid --${name}=${raw}`);
  return value;
}

function toProductGid(id: string): string {
  const trimmed = id.trim();
  if (trimmed.startsWith("gid://")) return trimmed;
  return `gid://shopify/Product/${trimmed}`;
}

type AuditRow = {
  shopifyId: string;
  handle: string | null;
  sku: string | null;
  styleId: string | null;
  kickdbProductId: string;
  currentImage: string | null;
  width: number | null;
  height: number | null;
  expectedKickdbImage: string | null;
  thumbnailDetected: boolean;
  googleReady: boolean;
  status: "ok" | "hero_too_small" | "no_shopify_media" | "no_kickdb_hd" | "shopify_missing";
};

async function fetchShopifyMedia(productGid: string): Promise<{
  handle: string | null;
  sku: string | null;
  media: ProductMediaImage[];
} | null> {
  const result = await shopifyGraphQL<{
    product: {
      handle: string;
      variants: { nodes: Array<{ sku: string | null }> };
      media: { nodes: ProductMediaImage[] };
    } | null;
  }>(
    `query KickdbImageAudit($id: ID!) {
      product(id: $id) {
        handle
        variants(first: 5) { nodes { sku } }
        media(first: 10) {
          nodes {
            ... on MediaImage {
              id
              image { url width height }
            }
          }
        }
      }
    }`,
    { id: productGid },
    { estimatedQueryCost: 15 }
  );
  if (result.errors?.length) {
    throw new Error(result.errors.map((e) => e.message).join("; "));
  }
  const product = result.data?.product;
  if (!product) return null;
  const sku =
    product.variants.nodes.map((n) => n.sku).find((s) => typeof s === "string" && s.trim()) ?? null;
  return { handle: product.handle, sku, media: product.media.nodes };
}

async function main() {
  const limit = intFlag("limit", 40);
  const handleFilter = stringFlag("handle")?.trim() || null;
  const brandFilter = stringFlag("brand")?.trim() || null;
  const outPath = path.resolve(stringFlag("out") ?? "tmp/kicksdb-image-audit.jsonl");

  const rows = await prisma.$queryRaw<
    Array<{
      kickdbProductId: string;
      shopifyProductId: string | null;
      shopifyHandle: string | null;
      styleId: string | null;
      imageUrl: string | null;
      rawJson: unknown;
      variantCount: number;
    }>
  >`
    SELECT
      p."kickdbProductId",
      s."shopifyProductId",
      s."shopifyHandle",
      p."styleId",
      p."imageUrl",
      p."rawJson",
      (
        SELECT COUNT(*)::int
        FROM "public"."KickDBVariant" kv
        WHERE kv."productId" = p."id"
      ) AS "variantCount"
    FROM "public"."ShopifySyncState" s
    INNER JOIN "public"."KickDBProduct" p
      ON p."kickdbProductId" = s."kickdbProductId"
    WHERE s."syncStatus" = 'synced'
      AND s."shopifyProductId" IS NOT NULL
      AND BTRIM(s."shopifyProductId") <> ''
      AND p."notFound" = false
      AND (${handleFilter}::text IS NULL OR s."shopifyHandle" = ${handleFilter})
      AND (${brandFilter}::text IS NULL OR p."brand" ILIKE ${brandFilter})
    ORDER BY
      CASE WHEN (
        SELECT COUNT(*) FROM "public"."KickDBVariant" kv WHERE kv."productId" = p."id"
      ) > 1 THEN 0 ELSE 1 END,
      s."shopifySyncedAt" DESC NULLS LAST,
      s."updatedAt" DESC
    LIMIT ${limit}
  `;

  const auditRows: AuditRow[] = [];
  for (const row of rows) {
    const resolved = resolveCanonicalKickdbImage(row.rawJson ?? { image: row.imageUrl }, {
      logContext: { kickdbProductId: row.kickdbProductId, mode: "audit" },
    });
    const expected = resolved.url ?? row.imageUrl;
    const thumbnailDetected =
      resolved.thumbnailDetected ||
      (typeof row.imageUrl === "string" && isKickdbThumbnailUrl(row.imageUrl)) ||
      resolved.candidates.some((u) => isKickdbThumbnailUrl(u));

    if (!row.shopifyProductId) {
      auditRows.push({
        shopifyId: "",
        handle: row.shopifyHandle,
        sku: null,
        styleId: row.styleId,
        kickdbProductId: row.kickdbProductId,
        currentImage: null,
        width: null,
        height: null,
        expectedKickdbImage: expected,
        thumbnailDetected,
        googleReady: false,
        status: "shopify_missing",
      });
      continue;
    }

    const gid = toProductGid(row.shopifyProductId);
    let shopify: Awaited<ReturnType<typeof fetchShopifyMedia>>;
    try {
      shopify = await fetchShopifyMedia(gid);
    } catch (error) {
      console.error(JSON.stringify({ event: "audit.shopify_error", gid, error: String(error) }));
      continue;
    }
    if (!shopify) {
      auditRows.push({
        shopifyId: gid,
        handle: row.shopifyHandle,
        sku: null,
        styleId: row.styleId,
        kickdbProductId: row.kickdbProductId,
        currentImage: null,
        width: null,
        height: null,
        expectedKickdbImage: expected,
        thumbnailDetected,
        googleReady: false,
        status: "shopify_missing",
      });
      continue;
    }

    const hero = shopify.media.find((m) => m.image?.url) ?? null;
    if (!hero?.image) {
      auditRows.push({
        shopifyId: gid,
        handle: shopify.handle,
        sku: shopify.sku,
        styleId: row.styleId,
        kickdbProductId: row.kickdbProductId,
        currentImage: null,
        width: null,
        height: null,
        expectedKickdbImage: expected,
        thumbnailDetected,
        googleReady: false,
        status: "no_shopify_media",
      });
      continue;
    }

    const googleReady = isGoogleReadyImage(hero, GOOGLE_IMAGE_MIN_PX);
    auditRows.push({
      shopifyId: gid,
      handle: shopify.handle,
      sku: shopify.sku,
      styleId: row.styleId,
      kickdbProductId: row.kickdbProductId,
      currentImage: hero.image.url,
      width: hero.image.width,
      height: hero.image.height,
      expectedKickdbImage: expected,
      thumbnailDetected,
      googleReady,
      status: googleReady ? "ok" : expected ? "hero_too_small" : "no_kickdb_hd",
    });
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, auditRows.map((r) => JSON.stringify(r)).join("\n") + (auditRows.length ? "\n" : ""));

  const summary = {
    scanned: auditRows.length,
    ok: auditRows.filter((r) => r.status === "ok").length,
    hero_too_small: auditRows.filter((r) => r.status === "hero_too_small").length,
    no_shopify_media: auditRows.filter((r) => r.status === "no_shopify_media").length,
    no_kickdb_hd: auditRows.filter((r) => r.status === "no_kickdb_hd").length,
    shopify_missing: auditRows.filter((r) => r.status === "shopify_missing").length,
    thumbnailDetected: auditRows.filter((r) => r.thumbnailDetected).length,
    minPx: KICKDB_GOOGLE_MIN_PX,
    outPath,
  };
  console.info(JSON.stringify({ event: "summary", ...summary }));
  for (const row of auditRows.slice(0, 20)) {
    console.info(
      [
        row.status,
        row.shopifyId,
        row.sku ?? row.styleId ?? "",
        `${row.width ?? "?"}x${row.height ?? "?"}`,
        row.thumbnailDetected ? "thumb=yes" : "thumb=no",
        row.currentImage ?? "",
      ].join("\t")
    );
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
