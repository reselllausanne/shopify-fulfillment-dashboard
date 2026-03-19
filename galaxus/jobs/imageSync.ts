import { prisma } from "@/app/lib/prisma";
import { createLimiter } from "@/galaxus/jobs/bulkSql";
import { hostSupplierImage } from "@/galaxus/images/imageHosting";

type ImageSyncStatus = "PENDING" | "SYNCED" | "FAILED";

type ImageSyncOptions = {
  supplierVariantId?: string;
  limit?: number;
  concurrency?: number;
  force?: boolean;
};

type ImageSyncResult = {
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

function isAbsoluteUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function extractAbsoluteImages(images: unknown): string[] {
  if (!Array.isArray(images)) return [];
  return images
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0 && isAbsoluteUrl(value));
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
  const startedAt = Date.now();
  const limit = Math.max(1, options.limit ?? 50);
  const concurrency = Math.max(1, options.concurrency ?? 3);
  const force = Boolean(options.force);

  const where = options.supplierVariantId
    ? { supplierVariantId: options.supplierVariantId }
    : {
        OR: [
          { hostedImageUrl: null },
          { imageSyncStatus: { in: ["PENDING", "FAILED"] } },
        ],
      };

  const rows = await prisma.supplierVariant.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    take: options.supplierVariantId ? 1 : limit,
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
            imageSyncStatus: "FAILED",
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
        let version = Number.isFinite(row.imageVersion) ? Number(row.imageVersion) : 1;

        if (!currentSource || sourceChanged) {
          if (sourceChanged && row.hostedImageUrl) {
            version += 1;
          }
          await updateVariantImageState(supplierVariantId, {
            sourceImageUrl: source,
            hostedImageUrl: sourceChanged ? null : row.hostedImageUrl ?? null,
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

        if (!force && row.hostedImageUrl && !sourceChanged && row.imageSyncStatus === "SYNCED") {
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
