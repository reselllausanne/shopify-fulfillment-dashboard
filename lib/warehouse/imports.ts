import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { addBatchLinesTx } from "./batches";
import { normalizeGtin, stripScannerTransport } from "./codes";
import { withTx, type WarehouseConn, type WarehouseDb } from "./db";
import { WarehouseError, conflict, invalid, isWarehouseError, notFound } from "./errors";
import { createLevelTx } from "./locations";
import { assertWritesEnabled } from "./operations";

/**
 * Assisted CSV imports (A07, A11, C28): locations and expected batch lines.
 *
 *  1. PREVIEW  — the file gets an identity (sha256) and every line a number, a status and its
 *                error. Nothing is created. Re-uploading the same file returns the same import.
 *  2. APPLY    — pending lines are applied one by one, each in its own transaction, in order.
 *                An interruption leaves applied lines applied and the rest pending: calling
 *                apply again resumes exactly where it stopped, with the same identities.
 *
 * Values are read as TEXT: a GTIN keeps its leading zeros, and a value mangled by a spreadsheet
 * (1.98481E+11) is rejected with the raw text shown — digits are never guessed.
 * An import never creates physical units: units are born from a scanned box.
 */

export type ImportKind = "LOCATIONS" | "BATCH_LINES";

/** Minimal RFC-4180 parser; accepts `,` or `;` (auto-detected on the header) and a UTF-8 BOM. */
export function parseCsv(text: string): { header: string[]; rows: string[][] } {
  const src = String(text ?? "").replace(/^\uFEFF/, "");
  const firstLine = src.split(/\r?\n/, 1)[0] ?? "";
  const delimiter = (firstLine.match(/;/g)?.length ?? 0) > (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && src[i + 1] === "\n") i += 1;
      row.push(cell);
      cell = "";
      if (row.some((c) => c.trim() !== "")) out.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== "")) out.push(row);
  const [header = [], ...rows] = out;
  return { header: header.map((h) => h.trim().toLowerCase()), rows };
}

const HEADER_ALIASES: Record<string, string> = {
  secteur: "sector",
  sector: "sector",
  rangee: "row",
  "rangée": "row",
  row: "row",
  rack: "rack",
  travee: "rack",
  "travée": "rack",
  niveau: "level",
  level: "level",
  capacite: "capacity",
  "capacité": "capacity",
  capacity: "capacity",
  profil: "sizeprofile",
  sizeprofile: "sizeprofile",
  gtin: "gtin",
  ean: "gtin",
  description: "description",
  modele: "description",
  "modèle": "description",
  pointure: "size",
  taille: "size",
  size: "size",
  quantite: "qty",
  "quantité": "qty",
  qty: "qty",
  quantity: "qty",
  reference: "ref",
  "référence": "ref",
  ref: "ref",
};

type ParsedRow = { raw: Record<string, string>; error: string | null };

function intCell(value: string | undefined, label: string, min: number, max: number): number {
  const v = String(value ?? "").trim();
  if (!/^[0-9]+$/.test(v)) throw new Error(`${label} : nombre entier attendu (reçu « ${v || "vide"} »).`);
  const n = Number.parseInt(v, 10);
  if (n < min || n > max) throw new Error(`${label} : attendu entre ${min} et ${max}.`);
  return n;
}

function validateRow(kind: ImportKind, raw: Record<string, string>): string | null {
  try {
    if (kind === "LOCATIONS") {
      if (!/^[A-Za-z0-9]{1,4}$/.test(String(raw.sector ?? "").trim())) throw new Error("Secteur : 1 à 4 lettres/chiffres.");
      intCell(raw.row, "Rangée", 1, 99);
      intCell(raw.rack, "Rack", 1, 99);
      intCell(raw.level, "Niveau", 1, 20);
      intCell(raw.capacity, "Capacité", 0, 10_000);
    } else {
      const g = stripScannerTransport(raw.gtin ?? "");
      if (g) {
        if (/[eE][+-]?[0-9]+$/.test(g) || /[.,]/.test(g)) {
          throw new Error(`GTIN abîmé par un tableur (« ${g} ») : réexporter la colonne au format texte.`);
        }
        if (!normalizeGtin(g)) throw new Error(`GTIN invalide (« ${g} ») : 8 à 14 chiffres attendus.`);
      } else if (!String(raw.description ?? "").trim()) {
        throw new Error("GTIN ou description requis.");
      }
      if (String(raw.qty ?? "").trim() !== "") intCell(raw.qty, "Quantité", 0, 100_000);
    }
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}

export type ImportView = {
  id: string;
  kind: ImportKind;
  filename: string;
  sha256: string;
  targetId: string | null;
  status: "PREVIEW" | "APPLYING" | "APPLIED" | "PARTIAL";
  totalRows: number;
  appliedRows: number;
  errorRows: number;
  pendingRows: number;
  alreadyImported: boolean;
  rows: { rowNumber: number; raw: Record<string, string>; status: string; error: string | null; resultRef: string | null }[];
};

export async function getImport(conn: WarehouseConn, importId: string, alreadyImported = false): Promise<ImportView> {
  const imp = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT "id", "kind", "filename", "sha256", "targetId", "status", "totalRows", "appliedRows", "errorRows" FROM "WarehouseImport" WHERE "id" = ${importId}`);
  if (!imp[0]) throw notFound("Import");
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT "rowNumber", "raw", "status", "error", "resultRef" FROM "WarehouseImportRow" WHERE "importId" = ${importId} ORDER BY "rowNumber" LIMIT 5000`);
  return { ...imp[0], pendingRows: rows.filter((r) => r.status === "PENDING").length, alreadyImported, rows };
}

/**
 * Step 1. `targetId` = site id (LOCATIONS) or batch id (BATCH_LINES). The same file for the same
 * target is the same import: no duplicate lines after a double upload.
 */
export async function previewImport(db: WarehouseDb, input: { kind: ImportKind; targetId: string; filename: string; csv: string }): Promise<ImportView> {
  assertWritesEnabled();
  if (!["LOCATIONS", "BATCH_LINES"].includes(input.kind)) throw invalid("Type d'import invalide.");
  if (!input.targetId) throw invalid(input.kind === "LOCATIONS" ? "Site requis." : "Lot requis.");
  const csv = String(input.csv ?? "");
  if (csv.length > 5_000_000) throw invalid("Fichier trop volumineux (5 Mo max).");
  const { header, rows } = parseCsv(csv);
  const columns = header.map((h) => HEADER_ALIASES[h.normalize("NFC")] ?? null);
  const required = input.kind === "LOCATIONS" ? ["sector", "row", "rack", "level", "capacity"] : [];
  const missing = required.filter((c) => !columns.includes(c));
  if (missing.length) {
    throw invalid(`Colonnes manquantes : ${missing.join(", ")}. Attendu : secteur, rangée, rack, niveau, capacité[, profil].`);
  }
  if (input.kind === "BATCH_LINES" && !columns.includes("gtin") && !columns.includes("description")) {
    throw invalid("Colonnes attendues : gtin et/ou description, pointure, quantité, référence.");
  }
  if (rows.length === 0) throw invalid("Fichier sans ligne de données.");
  if (rows.length > 5000) throw invalid("5000 lignes au maximum par fichier.");
  const sha256 = createHash("sha256").update(csv).digest("hex");

  const parsed: ParsedRow[] = rows.map((cells) => {
    const raw: Record<string, string> = {};
    columns.forEach((col, i) => {
      if (col) raw[col] = String(cells[i] ?? "").trim();
    });
    return { raw, error: validateRow(input.kind, raw) };
  });

  const result = await withTx(db, async (tx) => {
    const existing = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseImport" WHERE "kind" = ${input.kind} AND "sha256" = ${sha256} AND "targetId" = ${input.targetId}`);
    if (existing[0]) return { id: existing[0].id, already: true };
    const id = randomUUID();
    const errors = parsed.filter((p) => p.error).length;
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseImport" ("id", "kind", "filename", "sha256", "targetId", "totalRows", "errorRows")
      VALUES (${id}, ${input.kind}, ${String(input.filename || "import.csv").slice(0, 200)}, ${sha256}, ${input.targetId}, ${parsed.length}, ${errors})`);
    for (let i = 0; i < parsed.length; i += 1) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseImportRow" ("id", "importId", "rowNumber", "raw", "status", "error")
        VALUES (${randomUUID()}, ${id}, ${i + 2}, ${JSON.stringify(parsed[i].raw)}::jsonb, ${parsed[i].error ? "ERROR" : "PENDING"}, ${parsed[i].error})`);
    }
    return { id, already: false };
  }, { timeoutMs: 120_000 });
  return getImport(db, result.id, result.already);
}

/**
 * Step 2. Apply pending lines in order; each line commits on its own. `maxRows` lets a caller
 * apply in slices; calling again resumes. A line that fails is marked ERROR with its message and
 * the import continues (status PARTIAL at the end).
 */
export async function applyImport(db: WarehouseDb, input: { importId: string; maxRows?: number }): Promise<ImportView> {
  assertWritesEnabled();
  const imp = await db.$queryRaw<{ id: string; kind: ImportKind; targetId: string | null; status: string }[]>(Prisma.sql`
    SELECT "id", "kind", "targetId", "status" FROM "WarehouseImport" WHERE "id" = ${input.importId}`);
  if (!imp[0]) throw notFound("Import");
  if (!imp[0].targetId) throw conflict("CONFLICT", "Import sans cible.");
  await db.$executeRaw(Prisma.sql`UPDATE "WarehouseImport" SET "status" = 'APPLYING', "updatedAt" = now() WHERE "id" = ${imp[0].id} AND "status" <> 'APPLIED'`);
  const pending = await db.$queryRaw<{ id: string; rowNumber: number; raw: Record<string, string> }[]>(Prisma.sql`
    SELECT "id", "rowNumber", "raw" FROM "WarehouseImportRow" WHERE "importId" = ${imp[0].id} AND "status" = 'PENDING'
    ORDER BY "rowNumber" LIMIT ${Math.min(5000, Math.max(1, input.maxRows ?? 5000))}`);

  for (const row of pending) {
    try {
      await withTx(db, async (tx) => {
        // Re-check under lock: a concurrent apply of the same import must not apply a line twice.
        const locked = await tx.$queryRaw<{ status: string }[]>(Prisma.sql`
          SELECT "status" FROM "WarehouseImportRow" WHERE "id" = ${row.id} FOR UPDATE`);
        if (locked[0]?.status !== "PENDING") return;
        let resultRef: string;
        if (imp[0].kind === "LOCATIONS") {
          const r = await createLevelTx(tx, {
            siteId: imp[0].targetId as string,
            sector: row.raw.sector,
            rowNo: Number.parseInt(row.raw.row, 10),
            rackNo: Number.parseInt(row.raw.rack, 10),
            levelNo: Number.parseInt(row.raw.level, 10),
            capacity: Number.parseInt(row.raw.capacity, 10),
            sizeProfile: row.raw.sizeprofile || undefined,
          });
          resultRef = r.created ? r.code : `${r.code} (existait déjà)`;
        } else {
          const ids = await addBatchLinesTx(tx, imp[0].targetId as string, [
            {
              gtin: row.raw.gtin || null,
              description: row.raw.description || null,
              sizeLabel: row.raw.size || null,
              expectedQty: row.raw.qty ? Number.parseInt(row.raw.qty, 10) : null,
              externalRef: row.raw.ref || null,
              importRowId: row.id,
            },
          ]);
          resultRef = ids[0];
        }
        await tx.$executeRaw(Prisma.sql`
          UPDATE "WarehouseImportRow" SET "status" = 'APPLIED', "resultRef" = ${resultRef}, "error" = NULL, "updatedAt" = now() WHERE "id" = ${row.id}`);
      });
    } catch (err) {
      const message = isWarehouseError(err) ? (err as WarehouseError).message : "Erreur technique : ligne non appliquée, à relancer.";
      // Business errors are final for the line; technical ones leave it PENDING so a re-run retries it.
      if (isWarehouseError(err)) {
        await db.$executeRaw(Prisma.sql`
          UPDATE "WarehouseImportRow" SET "status" = 'ERROR', "error" = ${message.slice(0, 500)}, "updatedAt" = now() WHERE "id" = ${row.id} AND "status" = 'PENDING'`);
      } else {
        await db.$executeRaw(Prisma.sql`
          UPDATE "WarehouseImportRow" SET "error" = ${message}, "updatedAt" = now() WHERE "id" = ${row.id} AND "status" = 'PENDING'`);
      }
    }
  }
  await db.$executeRaw(Prisma.sql`
    UPDATE "WarehouseImport" i SET
      "appliedRows" = c.applied, "errorRows" = c.errors,
      "status" = CASE WHEN c.pending > 0 THEN 'PARTIAL' WHEN c.errors > 0 THEN 'PARTIAL' ELSE 'APPLIED' END,
      "updatedAt" = now()
    FROM (SELECT count(*) FILTER (WHERE "status" = 'APPLIED')::int AS applied,
                 count(*) FILTER (WHERE "status" = 'ERROR')::int AS errors,
                 count(*) FILTER (WHERE "status" = 'PENDING')::int AS pending
          FROM "WarehouseImportRow" WHERE "importId" = ${imp[0].id}) c
    WHERE i."id" = ${imp[0].id}`);
  return getImport(db, imp[0].id);
}
