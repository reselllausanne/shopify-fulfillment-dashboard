import { prisma } from "@/app/lib/prisma";
import { parseScraperShops } from "@/app/lib/scraperShops";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { hostSupplierImage } from "@/galaxus/images/imageHosting";

type ImageSyncStatus = "PENDING" | "SYNCED" | "FAILED" | "NO_SOURCE";

type ImageSyncOptions = {
  supplierVariantId?: string;
  /** Explicit variant ids (e.g. newly scraped rows). Takes precedence over supplierKeys. */
  supplierVariantIds?: string[];
  /** Restrict batch sync to these supplier prefixes (stx, ner, the, …). Ignored when supplierVariantId is set. */
  supplierKeys?: string[];
  limit?: number;
  concurrency?: number;
  force?: boolean;
  /** Process batches until the backlog is empty (or a batch returns zero rows). */
  full?: boolean;
};

type ImageSyncBatchResult = {
  processed: number;
  synced: number;
  failed: number;
  skipped: number;
  updatedSource: number;
  items: Array<{
    supplierVariantId: string;
    sourceImageUrl: string | null;
    hostedImageUrl: string | null;
    status: ImageSyncStatus | "SKIPPED";
    error?: string | null;
  }>;
  durationMs: number;
};

type ImageSyncResult = ImageSyncBatchResult & {
  batches?: number;
  complete?: boolean;
};

const DEFAULT_SUPPLIER_KEYS = ["stx", "the"] as const;

/** STX/THE plus any configured SCRAPER_SHOPS keys (e.g. wel). */
export function resolveImageSyncSupplierKeys(extra?: string[]): string[] {
  const keys = new Set<string>([...DEFAULT_SUPPLIER_KEYS]);
  for (const shop of parseScraperShops()) keys.add(shop.key);
  for (const raw of extra ?? []) {
    const k = String(raw).trim().toLowerCase();
    if (k) keys.add(k);
  }
  return [...keys];
}

export function buildImageSyncBacklogWhere(options?: {
  supplierKeys?: string[];
  supplierVariantId?: string;
  supplierVariantIds?: string[];
}) {
  const explicitIds = (options?.supplierVariantIds ?? [])
    .map((id) => String(id).trim())
    .filter(Boolean);
  if (explicitIds.length > 0) {
    return { supplierVariantId: { in: explicitIds } };
  }

  if (options?.supplierVariantId) {
    return { supplierVariantId: options.supplierVariantId };
  }

  const supplierKeys =
    options?.supplierKeys && options.supplierKeys.length > 0
      ? options.supplierKeys
      : [...DEFAULT_SUPPLIER_KEYS];

  return {
    AND: [
      {
        OR: [
          { hostedImageUrl: null },
          { imageSyncStatus: { in: ["PENDING", "FAILED"] } },
          { hostedImageUrl: { endsWith: ".avif" } },
          { hostedImageUrl: { endsWith: ".webp" } },
          { hostedImageUrl: { endsWith: ".gif" } },
        ],
      },
      // Permanently unhostable — exclude NO_SOURCE only. Do NOT use NOT equals:
      // SQL `<> 'NO_SOURCE'` drops NULL status rows (3k+ stuck outside backlog).
      {
        OR: [{ imageSyncStatus: null }, { imageSyncStatus: { not: "NO_SOURCE" } }],
      },
      {
        OR: supplierKeys.flatMap((key) => {
          const normalized = String(key).trim().toLowerCase();
          if (!normalized) return [];
          return [
            { supplierVariantId: { startsWith: `${normalized}:`, mode: "insensitive" as const } },
            { supplierVariantId: { startsWith: `${normalized}_`, mode: "insensitive" as const } },
          ];
        }),
      },
    ],
  };
}

export async function countImageSyncBacklog(options?: {
  supplierKeys?: string[];
  supplierVariantId?: string;
}): Promise<number> {
  return prisma.supplierVariant.count({
    where: buildImageSyncBacklogWhere(options),
  });
}

function pathnameLower(url: string): string {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase().split("?")[0] ?? "";
  }
}

function isJpegHosted(url: string | null | undefined): boolean {
  if (!url) return false;
  const p = pathnameLower(url.trim());
  return p.endsWith(".jpg") || p.endsWith(".jpeg");
}

function hasNonJpegHosted(url: string | null | undefined): boolean {
  if (!url) return false;
  return !isJpegHosted(url);
}

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function urlFromImageEntry(value: unknown): string | null {
  if (typeof value === "string") {
    const t = value.trim();
    return t && isAbsoluteUrl(t) ? t : null;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const k of ["url", "src", "href", "imageUrl", "image"]) {
      const u = o[k];
      if (typeof u === "string" && isAbsoluteUrl(u.trim())) return u.trim();
    }
  }
  return null;
}

/**
 * Normalize `SupplierVariant.images` (Json) into absolute image URLs.
 * Handles: string[], objects with url/src, JSON stored as string, nested single-element arrays.
 */
function extractAbsoluteImages(images: unknown): string[] {
  let current: unknown = images;
  if (typeof current === "string") {
    const s = current.trim();
    if (!s) return [];
    try {
      current = JSON.parse(s);
    } catch {
      return isAbsoluteUrl(s) ? [s] : [];
    }
  }
  if (!Array.isArray(current)) return [];
  const out: string[] = [];
  for (const el of current) {
    const direct = urlFromImageEntry(el);
    if (direct) {
      out.push(direct);
      continue;
    }
    if (Array.isArray(el) && el.length > 0) {
      const nested = urlFromImageEntry(el[0]);
      if (nested) out.push(nested);
    }
  }
  return out;
}

function resolveSourceImageUrl(row: any): string | null {
  const images = extractAbsoluteImages(row?.images);
  if (images.length > 0) return images[0];
  const existing = typeof row?.sourceImageUrl === "string" ? row.sourceImageUrl.trim() : "";
  return existing && isAbsoluteUrl(existing) ? existing : null;
}

async function updateVariantImageState(
  supplierVariantId: string,
  payload: Partial<{
    sourceImageUrl: string | null;
    hostedImageUrl: string | null;
    imageSyncStatus: ImageSyncStatus | null;
    imageVersion: number;
    imageLastSyncedAt: Date | null;
    imageSyncError: string | null;
  }>
) {
  await prisma.supplierVariant.update({
    where: { supplierVariantId },
    data: payload,
  });
}

export async function runImageSync(options: ImageSyncOptions = {}): Promise<ImageSyncResult> {
  if (options.full && !options.supplierVariantId) {
    return runImageSyncFull(options);
  }
  return runImageSyncBatch(options);
}

async function markPermanentNoSourceRows(supplierKeys?: string[]): Promise<number> {
  const keys =
    supplierKeys && supplierKeys.length > 0 ? supplierKeys : [...DEFAULT_SUPPLIER_KEYS];
  const orIds = keys.flatMap((key) => {
    const normalized = String(key).trim().toLowerCase();
    if (!normalized) return [];
    return [
      { supplierVariantId: { startsWith: `${normalized}:`, mode: "insensitive" as const } },
      { supplierVariantId: { startsWith: `${normalized}_`, mode: "insensitive" as const } },
    ];
  });
  if (orIds.length === 0) return 0;
  const result = await prisma.supplierVariant.updateMany({
    where: {
      AND: [
        { OR: orIds },
        { imageSyncStatus: "FAILED" },
        { imageSyncError: { contains: "No source image URL", mode: "insensitive" } },
      ],
    },
    data: {
      imageSyncStatus: "NO_SOURCE",
    },
  });
  return result.count;
}

async function runImageSyncFull(options: ImageSyncOptions): Promise<ImageSyncResult> {
  const startedAt = Date.now();
  const batchSize = Math.max(1, options.limit ?? 2000);
  const concurrency = Math.max(1, options.concurrency ?? 8);
  const supplierKeys = options.supplierKeys;
  const force = Boolean(options.force);

  const markedNoSource = await markPermanentNoSourceRows(supplierKeys);
  if (markedNoSource > 0) {
    console.info("[galaxus][image-sync][full] marked permanent NO_SOURCE", { markedNoSource });
  }

  const initialBacklog = await countImageSyncBacklog({ supplierKeys });
  console.info("[galaxus][image-sync][full] starting", {
    initialBacklog,
    batchSize,
    concurrency,
    supplierKeys: supplierKeys ?? DEFAULT_SUPPLIER_KEYS,
  });

  let batches = 0;
  let lastProcessed = batchSize;
  const totals: ImageSyncBatchResult = {
    processed: 0,
    synced: 0,
    failed: 0,
    skipped: 0,
    updatedSource: 0,
    items: [],
    durationMs: 0,
  };

  while (lastProcessed > 0) {
    const batch = await runImageSyncBatch({
      supplierKeys,
      limit: batchSize,
      concurrency,
      force,
    });
    batches += 1;
    lastProcessed = batch.processed;
    totals.processed += batch.processed;
    totals.synced += batch.synced;
    totals.failed += batch.failed;
    totals.skipped += batch.skipped;
    totals.updatedSource += batch.updatedSource;
    if (batch.items.length > 0 && totals.items.length < 50) {
      totals.items.push(...batch.items.slice(0, Math.max(0, 50 - totals.items.length)));
    }

    // Counting every batch doubles read load during full runs.
    // Sample periodically and always on tail batches.
    const shouldCountRemaining = batch.processed < batchSize || batches % 5 === 0;
    const remaining = shouldCountRemaining ? await countImageSyncBacklog({ supplierKeys }) : null;
    console.info("[galaxus][image-sync][full] batch", {
      batch: batches,
      processed: batch.processed,
      synced: batch.synced,
      failed: batch.failed,
      skipped: batch.skipped,
      ...(remaining === null ? {} : { remaining }),
    });

    // No progress (all failed / no-source) → stop; otherwise infinite loop on same 18 rows.
    if (batch.processed > 0 && batch.synced === 0 && batch.skipped === 0) {
      console.warn("[galaxus][image-sync][full] stopping — no progress this batch", {
        failed: batch.failed,
        remaining,
      });
      break;
    }
    if (remaining === 0) break;
  }

  const remaining = await countImageSyncBacklog({ supplierKeys });
  totals.durationMs = Date.now() - startedAt;
  return {
    ...totals,
    batches,
    complete: remaining === 0,
  };
}

async function runImageSyncBatch(options: ImageSyncOptions = {}): Promise<ImageSyncBatchResult> {
  const startedAt = Date.now();
  const limit = Math.max(1, options.limit ?? 50);
  const concurrency = Math.max(1, options.concurrency ?? 5);
  const force = Boolean(options.force);

  const where = buildImageSyncBacklogWhere({
    supplierVariantId: options.supplierVariantId,
    supplierVariantIds: options.supplierVariantIds,
    supplierKeys: options.supplierKeys,
  });

  const rows = await prisma.supplierVariant.findMany({
    where,
    orderBy: [{ stock: "desc" }, { updatedAt: "desc" }],
    take: options.supplierVariantId
      ? 1
      : options.supplierVariantIds?.length
        ? Math.min(limit, options.supplierVariantIds.length)
        : limit,
    select: {
      supplierVariantId: true,
      images: true,
      sourceImageUrl: true,
      hostedImageUrl: true,
      imageSyncStatus: true,
      imageVersion: true,
    },
  });

  let processed = 0;
  let synced = 0;
  let failed = 0;
  let skipped = 0;
  let updatedSource = 0;
  const items: ImageSyncResult["items"] = [];
  const limiter = createLimiter(concurrency);

  await Promise.all(
    rows.map((row) =>
      limiter(async () => {
        processed += 1;
        const supplierVariantId = row.supplierVariantId;
        const source = resolveSourceImageUrl(row);
        if (!source) {
          failed += 1;
          await updateVariantImageState(supplierVariantId, {
            imageSyncStatus: "NO_SOURCE",
            imageSyncError: "No source image URL available",
            imageLastSyncedAt: new Date(),
          });
          items.push({
            supplierVariantId,
            sourceImageUrl: row.sourceImageUrl ?? null,
            hostedImageUrl: row.hostedImageUrl ?? null,
            status: "FAILED",
            error: "No source image URL available",
          });
          return;
        }

        const currentSource = typeof row.sourceImageUrl === "string" ? row.sourceImageUrl.trim() : "";
        const sourceChanged = currentSource && currentSource !== source;
        const nonJpegHosted = hasNonJpegHosted(row.hostedImageUrl);
        let version = Number.isFinite(row.imageVersion) ? Number(row.imageVersion) : 1;

        if (!currentSource || sourceChanged || nonJpegHosted) {
          if ((sourceChanged || nonJpegHosted) && row.hostedImageUrl) {
            version += 1;
          }
          await updateVariantImageState(supplierVariantId, {
            sourceImageUrl: source,
            hostedImageUrl: sourceChanged || nonJpegHosted ? null : row.hostedImageUrl ?? null,
            imageVersion: version,
            imageSyncStatus: "PENDING",
            imageSyncError: null,
          });
          updatedSource += 1;
        } else if (!row.hostedImageUrl && row.imageSyncStatus !== "PENDING") {
          await updateVariantImageState(supplierVariantId, {
            imageSyncStatus: "PENDING",
            imageSyncError: null,
          });
        }

        if (!force && row.hostedImageUrl && !sourceChanged && !nonJpegHosted && row.imageSyncStatus === "SYNCED") {
          skipped += 1;
          items.push({
            supplierVariantId,
            sourceImageUrl: source,
            hostedImageUrl: row.hostedImageUrl ?? null,
            status: "SKIPPED",
          });
          return;
        }

        try {
          const hosted = await hostSupplierImage({
            supplierVariantId,
            sourceImageUrl: source,
            imageVersion: version,
          });
          await updateVariantImageState(supplierVariantId, {
            hostedImageUrl: hosted.publicUrl,
            imageSyncStatus: "SYNCED",
            imageSyncError: null,
            imageLastSyncedAt: new Date(),
          });
          synced += 1;
          items.push({
            supplierVariantId,
            sourceImageUrl: source,
            hostedImageUrl: hosted.publicUrl,
            status: "SYNCED",
          });
        } catch (error: any) {
          failed += 1;
          await updateVariantImageState(supplierVariantId, {
            imageSyncStatus: "FAILED",
            imageSyncError: error?.message ?? "Image sync failed",
            imageLastSyncedAt: new Date(),
          });
          items.push({
            supplierVariantId,
            sourceImageUrl: source,
            hostedImageUrl: row.hostedImageUrl ?? null,
            status: "FAILED",
            error: error?.message ?? "Image sync failed",
          });
        }
      })
    )
  );

  return {
    processed,
    synced,
    failed,
    skipped,
    updatedSource,
    items,
    durationMs: Date.now() - startedAt,
  };
}
