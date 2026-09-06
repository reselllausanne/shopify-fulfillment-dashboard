import { createHash } from "crypto";
import { mkdtempSync, statSync, existsSync, createReadStream } from "fs";
import { unlink, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_IN_DIR,
  GALAXUS_SFTP_OUT_DIR,
  GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS,
  GALAXUS_SUPPLIER_ID,
} from "@/galaxus/edi/config";
import { withSftp, uploadFilePathTempThenRename } from "@/galaxus/edi/sftpClient";
import {
  isMasterSnapshotReady,
  isSpecsSnapshotReady,
  streamMasterCsvFromSnapshot,
  streamSpecsCsvFromSnapshot,
} from "@/galaxus/exports/masterSpecsSnapshot";
import { loadWelCardOmitProviderKeys } from "@/galaxus/exports/welFeedOmit";

export type SnapshotUploadInput = {
  runId: string;
  auditId: string | null;
  masterFilename: string;
  specsFilename: string;
  triggerSource?: string | null;
};

export type SnapshotUploadResult = {
  ok: boolean;
  status: number;
  runId: string;
  uploaded: Array<{ name: string; path: string; size: number }>;
  counts: { master: number; specs: number };
  omittedByFeed: { master: number; specs: number };
  ms: number;
  reason?: string;
  error?: string;
};

/** Streaming checksum of a file on disk (never loads whole file into RAM). */
async function hashFilePath(path: string): Promise<string> {
  return await new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(path);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

/**
 * Upload master + specs feeds from the DB-side snapshot straight through disk
 * to SFTP. Peak Node heap during upload = one row + streaming buffers.
 *
 * Returns null if the snapshot is not ready — caller should fall back to the
 * legacy in-memory build path.
 */
export async function tryUploadMasterSpecsFromSnapshot(
  input: SnapshotUploadInput
): Promise<SnapshotUploadResult | null> {
  const [masterReady, specsReady] = await Promise.all([
    isMasterSnapshotReady(),
    isSpecsSnapshotReady(),
  ]);
  if (!masterReady || !specsReady) {
    return null;
  }

  const startedAt = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), `galaxus-master-specs-${input.runId}-`));
  const masterPath = join(workDir, input.masterFilename);
  const specsPath = join(workDir, input.specsFilename);

  try {
    // Streaming block list (wel-pokemon omissions + any future critical GTIN filters).
    // The heavy validation pass is skipped here because snapshot rows are already
    // validated at write time; only omit rows explicitly listed by the wel filter.
    const welPokemonOmitKeys = await loadWelCardOmitProviderKeys();
    const skipSet = welPokemonOmitKeys.size > 0 ? welPokemonOmitKeys : undefined;

    const [masterOut, specsOut] = await Promise.all([
      streamMasterCsvFromSnapshot(masterPath, { skipProviderKeys: skipSet }),
      streamSpecsCsvFromSnapshot(specsPath, { skipProviderKeys: skipSet }),
    ]);

    if (masterOut.rowCount <= 0 || specsOut.rowCount <= 0) {
      return {
        ok: false,
        status: 409,
        runId: input.runId,
        uploaded: [],
        counts: { master: masterOut.rowCount, specs: specsOut.rowCount },
        omittedByFeed: { master: masterOut.skipped, specs: specsOut.skipped },
        ms: Date.now() - startedAt,
        error: `Refusing upload: empty feed(s) from snapshot (master=${masterOut.rowCount}, specs=${specsOut.rowCount})`,
      };
    }

    const uploads: Array<{ name: string; path: string; size: number }> = [];

    await withSftp(
      {
        host: GALAXUS_SFTP_HOST,
        port: GALAXUS_SFTP_PORT,
        username: GALAXUS_SFTP_USER,
        password: GALAXUS_SFTP_PASSWORD,
      },
      async (client) => {
        const sftpStart = Date.now();
        await uploadFilePathTempThenRename(
          client,
          GALAXUS_SFTP_FEEDS_DIR,
          input.masterFilename,
          masterPath
        );
        const masterSize = statSync(masterPath).size;
        uploads.push({
          name: input.masterFilename,
          path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${input.masterFilename}`,
          size: masterSize,
        });
        console.info("[GALAXUS][FEEDS][UPLOAD][SNAPSHOT] sftp master done", {
          bytes: masterSize,
          rows: masterOut.rowCount,
          skipped: masterOut.skipped,
          ms: Date.now() - sftpStart,
        });

        const specsStart = Date.now();
        await uploadFilePathTempThenRename(
          client,
          GALAXUS_SFTP_FEEDS_DIR,
          input.specsFilename,
          specsPath
        );
        const specsSize = statSync(specsPath).size;
        uploads.push({
          name: input.specsFilename,
          path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${input.specsFilename}`,
          size: specsSize,
        });
        console.info("[GALAXUS][FEEDS][UPLOAD][SNAPSHOT] sftp specs done", {
          bytes: specsSize,
          rows: specsOut.rowCount,
          skipped: specsOut.skipped,
          ms: Date.now() - specsStart,
        });
      },
      { timeoutMs: GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS }
    );

    const destination = `sftp://${GALAXUS_SFTP_HOST}:${GALAXUS_SFTP_PORT}${GALAXUS_SFTP_FEEDS_DIR}`;
    const masterChecksum = await hashFilePath(masterPath);
    const specsChecksum = await hashFilePath(specsPath);

    await (prisma as any).galaxusExportManifest.create({
      data: {
        runId: input.runId,
        exportType: "master",
        supplierKeys: [],
        productCount: masterOut.rowCount,
        checksum: masterChecksum,
        storagePointer: uploads[0]?.path ?? null,
        destination,
        uploadStatus: "uploaded",
        responseJson: {
          filename: input.masterFilename,
          size: uploads[0]?.size ?? statSync(masterPath).size,
          omittedRows: masterOut.skipped,
          source: "snapshot",
        },
      },
    });
    await (prisma as any).galaxusExportManifest.create({
      data: {
        runId: input.runId,
        exportType: "specs",
        supplierKeys: [],
        productCount: specsOut.rowCount,
        checksum: specsChecksum,
        storagePointer: uploads[1]?.path ?? null,
        destination,
        uploadStatus: "uploaded",
        responseJson: {
          filename: input.specsFilename,
          size: uploads[1]?.size ?? statSync(specsPath).size,
          omittedRows: specsOut.skipped,
          source: "snapshot",
        },
      },
    });

    const totalMs = Date.now() - startedAt;
    const result: SnapshotUploadResult = {
      ok: true,
      status: 200,
      runId: input.runId,
      uploaded: uploads,
      counts: { master: masterOut.rowCount, specs: specsOut.rowCount },
      omittedByFeed: { master: masterOut.skipped, specs: specsOut.skipped },
      ms: totalMs,
      reason: "snapshot",
    };

    if (input.auditId) {
      await (prisma as any).galaxusJobRun.update({
        where: { id: input.auditId },
        data: {
          finishedAt: new Date(),
          success: true,
          resultJson: {
            ...result,
            sftpHost: GALAXUS_SFTP_HOST,
            sftpPort: GALAXUS_SFTP_PORT,
            supplierId: GALAXUS_SUPPLIER_ID,
            inDir: GALAXUS_SFTP_IN_DIR,
            outDir: GALAXUS_SFTP_OUT_DIR,
            feedsDir: GALAXUS_SFTP_FEEDS_DIR,
          },
        },
      });
    }

    console.info("[GALAXUS][FEEDS][UPLOAD][SNAPSHOT] done", {
      runId: input.runId,
      totalMs,
      counts: result.counts,
      omitted: result.omittedByFeed,
    });

    return result;
  } finally {
    // Clean tmp files regardless of success — never leave hundreds of MB on the worker.
    for (const path of [masterPath, specsPath, `${masterPath}.tmp`, `${specsPath}.tmp`]) {
      if (existsSync(path)) await unlink(path).catch(() => undefined);
    }
    await rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
}
