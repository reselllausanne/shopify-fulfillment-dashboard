#!/usr/bin/env npx tsx
/**
 * SFTP pre-dumped master+specs CSVs (from dump-galaxus-master-specs-snapshot-csv.sh).
 * Avoids the Node Prisma snapshot→CSV stream which OOMs/hangs on ~7M specs rows.
 */
import { statSync } from "fs";
import { join } from "path";
import { prisma } from "@/app/lib/prisma";
import {
  GALAXUS_SFTP_FEEDS_DIR,
  GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS,
  GALAXUS_SFTP_HOST,
  GALAXUS_SFTP_PASSWORD,
  GALAXUS_SFTP_PORT,
  GALAXUS_SFTP_USER,
} from "@/galaxus/edi/config";
import { uploadLocalFileTempThenRename, withSftp } from "@/galaxus/edi/sftpClient";

const DIR = String(process.env.GALAXUS_MASTER_SPECS_PREBUILT_DIR ?? "").trim();
const masterName = "ProductData_resell_lausanne.csv";
const specsName = "SpecificationData_resell_lausanne.csv";

async function main() {
  if (!DIR) {
    throw new Error("GALAXUS_MASTER_SPECS_PREBUILT_DIR required");
  }
  const masterPath = join(DIR, masterName);
  const specsPath = join(DIR, specsName);
  const masterSize = statSync(masterPath).size;
  const specsSize = statSync(specsPath).size;
  const meta = await (prisma as any).galaxusFeedSnapshotMeta.findUnique({
    where: { id: "default" },
    select: { masterRowCount: true, specsRowCount: true, masterRebuiltAt: true },
  });
  const masterRows = Number(meta?.masterRowCount ?? 0);
  const specsRows = Number(meta?.specsRowCount ?? 0);
  if (masterRows <= 0 || specsRows <= 0) {
    throw new Error(`snapshot meta empty master=${masterRows} specs=${specsRows}`);
  }

  const runId = `copy-push-${Date.now()}`;
  console.info("[sftp-master-specs-csv] start", {
    masterSize,
    specsSize,
    masterRows,
    specsRows,
    rebuiltAt: meta?.masterRebuiltAt ?? null,
    host: GALAXUS_SFTP_HOST,
    dir: GALAXUS_SFTP_FEEDS_DIR,
    timeoutMs: GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS,
  });

  await (prisma as any).galaxusFeedRun.create({
    data: {
      id: runId,
      runId,
      scope: "master-specs",
      triggerSource: "manual",
      startedAt: new Date(),
      success: false,
      manifestIds: [],
    },
  });

  const uploaded: Array<{ name: string; path: string; size: number }> = [];
  await withSftp(
    {
      host: GALAXUS_SFTP_HOST,
      port: GALAXUS_SFTP_PORT,
      username: GALAXUS_SFTP_USER,
      password: GALAXUS_SFTP_PASSWORD,
    },
    async (client) => {
      const t0 = Date.now();
      await uploadLocalFileTempThenRename(
        client,
        GALAXUS_SFTP_FEEDS_DIR,
        masterName,
        masterPath
      );
      uploaded.push({
        name: masterName,
        path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${masterName}`,
        size: masterSize,
      });
      console.info("[sftp-master-specs-csv] sftp master done", {
        bytes: masterSize,
        ms: Date.now() - t0,
      });
      const t1 = Date.now();
      await uploadLocalFileTempThenRename(
        client,
        GALAXUS_SFTP_FEEDS_DIR,
        specsName,
        specsPath
      );
      uploaded.push({
        name: specsName,
        path: `${GALAXUS_SFTP_FEEDS_DIR.replace(/\/$/, "")}/${specsName}`,
        size: specsSize,
      });
      console.info("[sftp-master-specs-csv] sftp specs done", {
        bytes: specsSize,
        ms: Date.now() - t1,
      });
    },
    { timeoutMs: GALAXUS_SFTP_FEED_UPLOAD_TIMEOUT_MS }
  );

  const destination = `sftp://${GALAXUS_SFTP_HOST}:${GALAXUS_SFTP_PORT}${GALAXUS_SFTP_FEEDS_DIR}`;
  await (prisma as any).galaxusExportManifest.create({
    data: {
      runId,
      exportType: "master",
      supplierKeys: [],
      productCount: masterRows,
      checksum: `copy-${masterSize}`,
      storagePointer: uploaded[0]?.path ?? null,
      destination,
      uploadStatus: "uploaded",
      responseJson: { filename: masterName, size: masterSize, source: "snapshot-copy" },
    },
  });
  await (prisma as any).galaxusExportManifest.create({
    data: {
      runId,
      exportType: "specs",
      supplierKeys: [],
      productCount: specsRows,
      checksum: `copy-${specsSize}`,
      storagePointer: uploaded[1]?.path ?? null,
      destination,
      uploadStatus: "uploaded",
      responseJson: { filename: specsName, size: specsSize, source: "snapshot-copy" },
    },
  });

  await (prisma as any).galaxusFeedRun.update({
    where: { id: runId },
    data: {
      finishedAt: new Date(),
      success: true,
      countsJson: { master: masterRows, specs: specsRows, source: "snapshot-copy" },
      manifestIds: uploaded.map((u) => u.path),
    },
  });

  console.info("[sftp-master-specs-csv] done", { runId, uploaded });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error("[sftp-master-specs-csv] failed", err);
  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
