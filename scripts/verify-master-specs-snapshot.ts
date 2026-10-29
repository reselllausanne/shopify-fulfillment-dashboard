#!/usr/bin/env tsx
/**
 * Diff snapshot output vs legacy build. Ships nothing — read-only.
 *
 * Usage (from repo root or VPS):
 *   npx tsx scripts/verify-master-specs-snapshot.ts
 *
 * Compares:
 *   - Row count (master + specs)
 *   - Set of ProviderKeys (must be identical after filters)
 *   - Per-ProviderKey row content (byte-identical after sort)
 *
 * Prints a summary and exits 0 on parity, 1 on any drift.
 */

import { openCsvWriter, type CsvRow } from "@/galaxus/exports/csvStream";
import { toCsv } from "@/galaxus/exports/csv";
import { buildMasterSpecsFeedExport } from "@/galaxus/exports/masterSpecsFeed";
import { collectCriticalGtinProviderKeys } from "@/galaxus/exports/feedValidation";
import { loadWelCardOmitProviderKeys } from "@/galaxus/exports/welFeedOmit";
import {
  MASTER_CSV_HEADERS,
  SPECS_CSV_HEADERS,
  streamMasterCsvFromSnapshot,
  streamSpecsCsvFromSnapshot,
  getMasterSpecsSnapshotMeta,
} from "@/galaxus/exports/masterSpecsSnapshot";
import { readFileSync, mkdtempSync, existsSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

type CsvKind = "master" | "specs";

function parseCsv(csv: string): { headers: string[]; rows: CsvRow[] } {
  const lines = csv.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };
  const headers = parseCsvLine(lines[0]);
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i += 1) {
    const cells = parseCsvLine(lines[i]);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j += 1) row[headers[j]] = cells[j] ?? "";
    rows.push(row);
  }
  return { headers, rows };
}

/** RFC 4180 minimal parser — matches our own escape. */
function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuote = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuote) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else if (ch === '"') {
        inQuote = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur === "") {
      inQuote = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function rowKey(kind: CsvKind, row: CsvRow): string {
  if (kind === "master") return String(row.ProviderKey ?? "");
  return `${String(row.ProviderKey ?? "")}|${String(row.SpecificationKey ?? "")}`;
}

function diffRows(
  kind: CsvKind,
  legacy: CsvRow[],
  snapshot: CsvRow[]
): {
  onlyInLegacy: string[];
  onlyInSnapshot: string[];
  contentMismatches: Array<{ key: string; legacy: string; snapshot: string }>;
} {
  const legacyByKey = new Map<string, CsvRow>();
  for (const row of legacy) legacyByKey.set(rowKey(kind, row), row);
  const snapshotByKey = new Map<string, CsvRow>();
  for (const row of snapshot) snapshotByKey.set(rowKey(kind, row), row);

  const onlyInLegacy: string[] = [];
  const onlyInSnapshot: string[] = [];
  const contentMismatches: Array<{ key: string; legacy: string; snapshot: string }> = [];

  for (const [key, row] of legacyByKey) {
    if (!snapshotByKey.has(key)) {
      onlyInLegacy.push(key);
      continue;
    }
    const other = snapshotByKey.get(key)!;
    const a = JSON.stringify(row);
    const b = JSON.stringify(other);
    if (a !== b) contentMismatches.push({ key, legacy: a, snapshot: b });
  }
  for (const key of snapshotByKey.keys()) {
    if (!legacyByKey.has(key)) onlyInSnapshot.push(key);
  }

  return { onlyInLegacy, onlyInSnapshot, contentMismatches };
}

async function writeCsv(
  path: string,
  headers: readonly string[],
  rows: CsvRow[]
): Promise<void> {
  const writer = await openCsvWriter(path, headers);
  await writer.writeMany(rows);
  await writer.close();
}

async function main() {
  const started = Date.now();
  const workDir = mkdtempSync(join(tmpdir(), "verify-master-specs-"));
  const cleanup = () => {
    if (existsSync(workDir)) rmSync(workDir, { recursive: true, force: true });
  };
  process.on("exit", cleanup);

  try {
    console.info("[VERIFY] snapshot meta:");
    const meta = await getMasterSpecsSnapshotMeta();
    console.info(meta);
    if (!meta || !meta.masterRebuiltAt) {
      console.error(
        "[VERIFY] snapshot is empty — rebuild first: POST /api/galaxus/ops/run {action: rebuild-master-specs-snapshot}"
      );
      process.exit(2);
    }

    console.info("[VERIFY] building legacy CSV in-memory (this uses the current pipeline)…");
    const built = await buildMasterSpecsFeedExport({ supplier: null });
    const criticalGtinKeys = collectCriticalGtinProviderKeys(built.report ?? {});
    const welPokemonKeys = await loadWelCardOmitProviderKeys();
    const blocked = new Set<string>([
      ...Array.from(criticalGtinKeys),
      ...Array.from(welPokemonKeys),
    ]);
    const legacyMaster = built.masterRows.filter(
      (r) => !blocked.has(String(r.ProviderKey ?? ""))
    );
    const legacySpecs = built.specsRows.filter(
      (r) => !blocked.has(String(r.ProviderKey ?? ""))
    );

    console.info("[VERIFY] streaming snapshot CSV…");
    const snapMasterPath = join(workDir, "master.snapshot.csv");
    const snapSpecsPath = join(workDir, "specs.snapshot.csv");
    await streamMasterCsvFromSnapshot(snapMasterPath);
    await streamSpecsCsvFromSnapshot(snapSpecsPath);

    // Legacy → tmp file so we compare via the same parser.
    const legacyMasterPath = join(workDir, "master.legacy.csv");
    const legacySpecsPath = join(workDir, "specs.legacy.csv");
    await writeCsv(legacyMasterPath, [...MASTER_CSV_HEADERS], legacyMaster);
    await writeCsv(legacySpecsPath, [...SPECS_CSV_HEADERS], legacySpecs);

    const legacyMasterParsed = parseCsv(readFileSync(legacyMasterPath, "utf8"));
    const snapMasterParsed = parseCsv(readFileSync(snapMasterPath, "utf8"));
    const legacySpecsParsed = parseCsv(readFileSync(legacySpecsPath, "utf8"));
    const snapSpecsParsed = parseCsv(readFileSync(snapSpecsPath, "utf8"));

    console.info("[VERIFY] rows", {
      legacyMaster: legacyMasterParsed.rows.length,
      snapshotMaster: snapMasterParsed.rows.length,
      legacySpecs: legacySpecsParsed.rows.length,
      snapshotSpecs: snapSpecsParsed.rows.length,
    });

    const masterDiff = diffRows(
      "master",
      legacyMasterParsed.rows,
      snapMasterParsed.rows
    );
    const specsDiff = diffRows(
      "specs",
      legacySpecsParsed.rows,
      snapSpecsParsed.rows
    );

    const anyDrift =
      masterDiff.onlyInLegacy.length ||
      masterDiff.onlyInSnapshot.length ||
      masterDiff.contentMismatches.length ||
      specsDiff.onlyInLegacy.length ||
      specsDiff.onlyInSnapshot.length ||
      specsDiff.contentMismatches.length;

    console.info("[VERIFY] master diff", {
      onlyInLegacy: masterDiff.onlyInLegacy.length,
      onlyInSnapshot: masterDiff.onlyInSnapshot.length,
      contentMismatches: masterDiff.contentMismatches.length,
      sampleOnlyInLegacy: masterDiff.onlyInLegacy.slice(0, 5),
      sampleOnlyInSnapshot: masterDiff.onlyInSnapshot.slice(0, 5),
      sampleContentMismatches: masterDiff.contentMismatches.slice(0, 3),
    });
    console.info("[VERIFY] specs diff", {
      onlyInLegacy: specsDiff.onlyInLegacy.length,
      onlyInSnapshot: specsDiff.onlyInSnapshot.length,
      contentMismatches: specsDiff.contentMismatches.length,
      sampleOnlyInLegacy: specsDiff.onlyInLegacy.slice(0, 5),
      sampleOnlyInSnapshot: specsDiff.onlyInSnapshot.slice(0, 5),
      sampleContentMismatches: specsDiff.contentMismatches.slice(0, 3),
    });

    console.info("[VERIFY] wall", { ms: Date.now() - started });
    if (anyDrift) {
      console.error("[VERIFY] DRIFT — do not enable snapshot upload yet");
      process.exit(1);
    }
    console.info("[VERIFY] PARITY OK — snapshot output equals legacy filtered output");
    process.exit(0);
  } finally {
    cleanup();
  }
}

main().catch((err) => {
  console.error("[VERIFY] fatal", err);
  process.exit(1);
});

// Silence unused import ESLint until this script is invoked by the shell.
void toCsv;
