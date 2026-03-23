import { prisma } from "@/app/lib/prisma";
import { toCsv } from "@/galaxus/exports/csv";
import { getStorageAdapter } from "@/galaxus/storage/storage";
import { randomUUID, createHash } from "crypto";
import { buildOfferCsv } from "./offerCsv";
import { buildProductCsv } from "./productCsv";
import { createDecathlonExclusionSummary, loadDecathlonCandidates } from "./mapping";

export type DecathlonExportRunResult = {
  ok: boolean;
  runId: string;
  counts: Record<string, number>;
  exclusions: ReturnType<typeof createDecathlonExclusionSummary>;
  files: Array<{
    fileType: string;
    rowCount: number;
    checksum: string;
    storageUrl: string | null;
    publicUrl: string | null;
    sizeBytes: number;
  }>;
};

export async function generateDecathlonExport(params?: {
  limit?: number | null;
}): Promise<DecathlonExportRunResult> {
  const prismaAny = prisma as any;
  const runId = randomUUID();
  const startedAt = new Date();
  const limit = params?.limit ?? null;

  await prismaAny.decathlonExportRun.create({
    data: {
      runId,
      startedAt,
      finishedAt: null,
      success: false,
      errorMessage: null,
      countsJson: null,
      exclusionsJson: null,
    },
  });

  const summary = createDecathlonExclusionSummary();
  try {
    const { candidates, scanned } = await loadDecathlonCandidates(summary);
    const slicedCandidates =
      limit && Number.isFinite(limit) && limit > 0 ? candidates.slice(0, limit) : candidates;
    const productFile = buildProductCsv(slicedCandidates, summary);
    const offerFile = buildOfferCsv(slicedCandidates, summary);
    const files = [productFile, offerFile];
    const filenameByType: Record<string, string> = {
      products: "products-fr_CH.csv",
      offers: "offers-fr_CH.csv",
    };

    const storage = getStorageAdapter();
    const storedFiles: DecathlonExportRunResult["files"] = [];

    for (const file of files) {
      const csv = toCsv(file.headers, file.rows);
      const buffer = Buffer.from(csv, "utf8");
      const checksum = createHash("sha256").update(buffer).digest("hex");
      const filename = filenameByType[file.type] ?? `${file.type}.csv`;
      const key = `decathlon/exports/${runId}/${filename}`;
      const stored = storage.uploadBinary
        ? await storage.uploadBinary(key, buffer, "text/csv")
        : await storage.uploadPdf(key, buffer);
      const rowCount = file.rows.length;
      const sizeBytes = buffer.length;

      await prismaAny.decathlonExportFile.create({
        data: {
          runId,
          fileType: file.type,
          rowCount,
          checksum,
          storageUrl: stored.storageUrl ?? null,
          publicUrl: stored.publicUrl ?? null,
          sizeBytes,
        },
      });

      storedFiles.push({
        fileType: file.type,
        rowCount,
        checksum,
        storageUrl: stored.storageUrl ?? null,
        publicUrl: stored.publicUrl ?? null,
        sizeBytes,
      });
    }

    const counts: Record<string, number> = {
      scannedCandidates: scanned,
      exportableCandidates: slicedCandidates.length,
      products: productFile.rows.length,
      offers: offerFile.rows.length,
    };
    if (limit && Number.isFinite(limit) && limit > 0) {
      counts.limitApplied = Math.floor(limit);
    }

    await prismaAny.decathlonExportRun.update({
      where: { runId },
      data: {
        finishedAt: new Date(),
        success: true,
        countsJson: counts,
        exclusionsJson: summary,
      },
    });

    return { ok: true, runId, counts, exclusions: summary, files: storedFiles };
  } catch (error: any) {
    await prismaAny.decathlonExportRun.update({
      where: { runId },
      data: {
        finishedAt: new Date(),
        success: false,
        errorMessage: error?.message ?? "Decathlon export failed",
        exclusionsJson: summary,
      },
    });
    throw error;
  }
}
