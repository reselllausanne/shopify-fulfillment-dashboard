import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { containedUnitGtin, gtinLookupVariants, isPackagingGtin, isValidGtinChecksum, normalizeGtin } from "./codes";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { conflict, invalid, notFound } from "./errors";
import { assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import type { ActorContext, CatalogCandidate, ItemSummary } from "./types";

/**
 * Warehouse items = stable snapshot of a catalog variant (model + size).
 *
 * A GTIN identifies a variant, never a box. Resolution order:
 *   1. warehouse alias registry (WarehouseItemAlias, unique per namespace+value);
 *   2. existing catalog, READ-ONLY (KickDBVariant / KickDBProduct, SupplierVariant) → candidates
 *      the operator confirms. Nothing is written to catalog tables.
 * Unknown or ambiguous → assisted search or exception, never a silent guess.
 */

const ITEM_COLUMNS = Prisma.sql`
  i."id", i."gtin", i."brand", i."name", i."styleCode", i."colorway", i."sizeSystem", i."sizeLabel",
  i."sizeEu", i."sizeUs", i."imageUrl", i."status", i."catalogSource"`;

export async function getItem(conn: WarehouseConn, itemId: string): Promise<ItemSummary> {
  const rows = await conn.$queryRaw<ItemSummary[]>(Prisma.sql`
    SELECT ${ITEM_COLUMNS} FROM "WarehouseItem" i WHERE i."id" = ${itemId}`);
  if (!rows[0]) throw notFound("Article", { itemId });
  return rows[0];
}

/** Items already known to the warehouse for this GTIN (through the alias registry). */
export async function findItemsByGtin(conn: WarehouseConn, gtin: string): Promise<ItemSummary[]> {
  const variants = gtinLookupVariants(gtin);
  if (variants.length === 0) return [];
  return conn.$queryRaw<ItemSummary[]>(Prisma.sql`
    SELECT DISTINCT ${ITEM_COLUMNS}
    FROM "WarehouseItemAlias" a JOIN "WarehouseItem" i ON i."id" = a."itemId"
    WHERE a."namespace" = 'GTIN' AND a."value" IN (${Prisma.join(variants)}) AND i."status" <> 'MERGED'`);
}

function firstImage(images: unknown): string | null {
  if (Array.isArray(images)) {
    for (const entry of images) {
      if (typeof entry === "string" && entry) return entry;
      if (entry && typeof entry === "object") {
        const url = (entry as any).url ?? (entry as any).src;
        if (typeof url === "string" && url) return url;
      }
    }
  }
  return null;
}

/** Read-only lookup of the existing catalog for a GTIN. */
export async function findCatalogCandidatesByGtin(conn: WarehouseConn, gtin: string): Promise<CatalogCandidate[]> {
  const variants = gtinLookupVariants(gtin);
  if (variants.length === 0) return [];
  const out: CatalogCandidate[] = [];

  const kick = await conn.$queryRaw<
    {
      id: string;
      gtin: string | null;
      ean: string | null;
      sizeUs: string | null;
      sizeEu: string | null;
      name: string | null;
      brand: string | null;
      styleId: string | null;
      colorway: string | null;
      imageUrl: string | null;
    }[]
  >(Prisma.sql`
    SELECT v."id", v."gtin", v."ean", v."sizeUs", v."sizeEu", p."name", p."brand", p."styleId", p."colorway", p."imageUrl"
    FROM "KickDBVariant" v JOIN "KickDBProduct" p ON p."id" = v."productId"
    WHERE (v."gtin" IN (${Prisma.join(variants)}) OR v."ean" IN (${Prisma.join(variants)})) AND v."notFound" = false
    LIMIT 20`);
  for (const k of kick) {
    out.push({
      source: "KICKDB",
      gtin,
      brand: k.brand,
      name: k.name ?? k.styleId ?? "Article sans nom",
      styleCode: k.styleId,
      colorway: k.colorway,
      sizeSystem: k.sizeUs ? "US" : k.sizeEu ? "EU" : null,
      sizeLabel: k.sizeUs ? `US ${k.sizeUs}` : k.sizeEu ? `EU ${k.sizeEu}` : null,
      sizeEu: k.sizeEu,
      sizeUs: k.sizeUs,
      imageUrl: k.imageUrl,
      kickdbVariantId: k.id,
      supplierVariantId: null,
    });
  }

  const supplier = await conn.$queryRaw<
    {
      supplierVariantId: string;
      supplierSku: string;
      supplierBrand: string | null;
      supplierProductName: string | null;
      supplierColorway: string | null;
      sizeRaw: string | null;
      sizeNormalized: string | null;
      hostedImageUrl: string | null;
      sourceImageUrl: string | null;
      images: unknown;
    }[]
  >(Prisma.sql`
    SELECT "supplierVariantId", "supplierSku", "supplierBrand", "supplierProductName", "supplierColorway",
           "sizeRaw", "sizeNormalized", "hostedImageUrl", "sourceImageUrl", "images"
    FROM "SupplierVariant" WHERE "gtin" IN (${Prisma.join(variants)}) LIMIT 20`);
  for (const s of supplier) {
    out.push({
      source: "SUPPLIER_VARIANT",
      gtin,
      brand: s.supplierBrand,
      name: s.supplierProductName ?? s.supplierSku,
      styleCode: s.supplierSku || null,
      colorway: s.supplierColorway,
      // Size kept exactly as the source gives it — no blind US/UK/EU conversion (A13).
      sizeSystem: null,
      sizeLabel: s.sizeRaw ?? s.sizeNormalized,
      sizeEu: null,
      sizeUs: null,
      imageUrl: s.hostedImageUrl ?? s.sourceImageUrl ?? firstImage(s.images),
      kickdbVariantId: null,
      supplierVariantId: s.supplierVariantId,
    });
  }
  return out;
}

const norm = (v: string | null | undefined) => String(v ?? "").trim().toLowerCase().replace(/[^a-z0-9.]+/g, "");

/**
 * Candidates "agree" when they describe the same style and the same size. Different styles or
 * sizes behind one GTIN = two variants disputing a code (A12): the operator must arbitrate.
 */
export function candidatesAgree(candidates: CatalogCandidate[]): boolean {
  if (candidates.length <= 1) return true;
  const styles = new Set(candidates.map((c) => norm(c.styleCode)).filter(Boolean));
  const sizes = new Set(
    candidates
      .map((c) => norm(c.sizeUs ? `us${c.sizeUs}` : c.sizeEu ? `eu${c.sizeEu}` : c.sizeLabel))
      .filter(Boolean)
  );
  // KickDB (US/EU) and supplier rows (raw label) describe sizes differently: compare within a source only.
  const kickSizes = new Set(candidates.filter((c) => c.source === "KICKDB").map((c) => norm(c.sizeUs ?? c.sizeEu)));
  return styles.size <= 1 && (sizes.size <= 1 || kickSizes.size <= 1) && kickSizes.size <= 1;
}

export type GtinResolution =
  | { status: "ITEM"; gtin: string; checksumValid: boolean; item: ItemSummary }
  | { status: "AMBIGUOUS_ITEMS"; gtin: string; checksumValid: boolean; items: ItemSummary[] }
  | { status: "CANDIDATES"; gtin: string; checksumValid: boolean; candidates: CatalogCandidate[]; agree: boolean }
  /** Carton / inner-pack code: ask for the box barcode. `containedGtin` is shown as a hint only (A15). */
  | { status: "PACKAGING"; gtin: string; checksumValid: boolean; containedGtin: string | null; message: string }
  | { status: "UNKNOWN"; gtin: string; checksumValid: boolean };

export const PACKAGING_GTIN_MESSAGE = "Code de carton (emballage collectif) : scanner le code-barres de la boîte, ou chercher le modèle.";

/** Read-only: what does this GTIN designate? Never creates anything. */
export async function resolveGtin(conn: WarehouseConn, rawGtin: string): Promise<GtinResolution> {
  const gtin = normalizeGtin(rawGtin);
  if (!gtin) throw invalid("GTIN attendu : 8 à 14 chiffres, lus comme du texte (zéros initiaux conservés).");
  const checksumValid = isValidGtinChecksum(gtin);
  const items = await findItemsByGtin(conn, gtin);
  if (items.length === 1) return { status: "ITEM", gtin, checksumValid, item: items[0] };
  if (items.length > 1) return { status: "AMBIGUOUS_ITEMS", gtin, checksumValid, items };
  // A carton code never identifies one box — unless someone registered it deliberately as an alias (handled above).
  if (isPackagingGtin(gtin)) return { status: "PACKAGING", gtin, checksumValid, containedGtin: containedUnitGtin(gtin), message: PACKAGING_GTIN_MESSAGE };
  const candidates = await findCatalogCandidatesByGtin(conn, gtin);
  if (candidates.length === 0) return { status: "UNKNOWN", gtin, checksumValid };
  return { status: "CANDIDATES", gtin, checksumValid, candidates, agree: candidatesAgree(candidates) };
}

export type CreateItemInput = {
  gtin?: string | null;
  brand?: string | null;
  name: string;
  styleCode?: string | null;
  colorway?: string | null;
  sizeSystem?: string | null;
  sizeLabel?: string | null;
  sizeEu?: string | null;
  sizeUs?: string | null;
  imageUrl?: string | null;
  kickdbVariantId?: string | null;
  supplierVariantId?: string | null;
  catalogSource?: "KICKDB" | "SUPPLIER_VARIANT" | "MANUAL";
  /** No GTIN / unconfirmed identification: stays PROVISIONAL and blocks sale until confirmed (A10). */
  provisional?: boolean;
};

function buildSearchText(i: CreateItemInput): string {
  return [i.brand, i.name, i.styleCode, i.colorway, i.sizeLabel, i.sizeEu ? `eu ${i.sizeEu}` : "", i.sizeUs ? `us ${i.sizeUs}` : "", i.gtin]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export async function createItemTx(tx: WarehouseTx, input: CreateItemInput): Promise<{ item: ItemSummary; created: boolean }> {
  const name = String(input.name ?? "").trim();
  if (!name) throw invalid("Nom de l'article requis.");
  const gtin = input.gtin ? normalizeGtin(input.gtin) : null;
  if (input.gtin && !gtin) throw invalid("GTIN invalide : 8 à 14 chiffres.");
  if (gtin && isPackagingGtin(gtin)) throw invalid(PACKAGING_GTIN_MESSAGE, { gtin, containedGtin: containedUnitGtin(gtin) });

  if (gtin) {
    const existing = await findItemsByGtin(tx, gtin);
    if (existing.length === 1) return { item: existing[0], created: false };
    if (existing.length > 1) {
      throw conflict("AMBIGUOUS_GTIN", "Ce GTIN désigne déjà plusieurs articles : arbitrage requis.", {
        itemIds: existing.map((e) => e.id),
      });
    }
  }

  const id = randomUUID();
  const status = input.provisional || !gtin ? "PROVISIONAL" : "ACTIVE";
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseItem"
      ("id", "gtin", "brand", "name", "styleCode", "colorway", "sizeSystem", "sizeLabel", "sizeEu", "sizeUs", "imageUrl",
       "kickdbVariantId", "supplierVariantId", "catalogSource", "status", "searchText")
    VALUES
      (${id}, ${gtin}, ${input.brand?.trim() || null}, ${name}, ${input.styleCode?.trim() || null},
       ${input.colorway?.trim() || null}, ${input.sizeSystem?.trim() || null}, ${input.sizeLabel?.trim() || null},
       ${input.sizeEu?.trim() || null}, ${input.sizeUs?.trim() || null}, ${input.imageUrl?.trim() || null},
       ${input.kickdbVariantId ?? null}, ${input.supplierVariantId ?? null}, ${input.catalogSource ?? "MANUAL"},
       ${status}, ${buildSearchText({ ...input, name, gtin })})`);

  const aliases: [string, string | null | undefined][] = [
    ["GTIN", gtin],
    ["KICKDB_VARIANT", input.kickdbVariantId],
    ["SUPPLIER_VARIANT", input.supplierVariantId],
  ];
  for (const [namespace, value] of aliases) {
    if (!value) continue;
    // An alias already owned by another item is left alone (first owner wins; an admin arbitrates).
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseItemAlias" ("id", "itemId", "namespace", "value")
      VALUES (${randomUUID()}, ${id}, ${namespace}, ${value})
      ON CONFLICT ("namespace", "value") DO NOTHING`);
  }
  return { item: await getItem(tx, id), created: true };
}

export async function createItem(db: WarehouseDb, input: CreateItemInput): Promise<{ item: ItemSummary; created: boolean }> {
  assertWritesEnabled();
  return withTx(db, (tx) => createItemTx(tx, input));
}

/**
 * A10 — a box without a usable GTIN is received under a PROVISIONAL article, which blocks its
 * sale. Once somebody identified the model for certain, this confirms the article: optional
 * corrections, optional GTIN (attached as an alias — refused when it already designates another
 * article), then ACTIVE. The pairs keep their UUID and QR; the sale right is NOT granted here.
 */
export async function confirmItem(
  db: WarehouseDb,
  input: {
    opKey: string;
    itemId: string;
    gtin?: string | null;
    brand?: string | null;
    name?: string | null;
    styleCode?: string | null;
    colorway?: string | null;
    sizeLabel?: string | null;
    sizeEu?: string | null;
    sizeUs?: string | null;
    note: string;
  },
  ctx: ActorContext
): Promise<OperationResult<{ item: ItemSummary; confirmed: boolean; pairs: number; note: string }>> {
  const note = String(input.note ?? "").trim();
  if (note.length < 3) throw invalid("Indiquer comment l'article a été identifié (étiquette intérieure, facture, fiche modèle…).");
  // The operation ledger keeps who confirmed, when and on which proof (request + actor).
  return runOperation(db, { opKey: input.opKey, kind: "ITEM_CONFIRM", request: input, ctx }, async (tx) => {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT "id", "gtin", "brand", "name", "styleCode", "colorway", "sizeSystem", "sizeLabel", "sizeEu", "sizeUs", "status"
      FROM "WarehouseItem" WHERE "id" = ${input.itemId} FOR UPDATE`);
    const cur = rows[0];
    if (!cur || cur.status === "MERGED") throw notFound("Article");
    const pairs = async () =>
      (await tx.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehouseUnit" WHERE "itemId" = ${cur.id} AND "presence" <> 'OUT'`))[0].n;
    if (cur.status === "ACTIVE") return { item: await getItem(tx, cur.id), confirmed: false, pairs: await pairs(), note };

    const gtin = input.gtin ? normalizeGtin(input.gtin) : cur.gtin;
    if (input.gtin && !gtin) throw invalid("GTIN invalide : 8 à 14 chiffres.");
    if (gtin && isPackagingGtin(gtin)) throw invalid(PACKAGING_GTIN_MESSAGE, { gtin });
    if (gtin) {
      const owners = (await findItemsByGtin(tx, gtin)).filter((i) => i.id !== cur.id);
      if (owners.length) {
        throw conflict("AMBIGUOUS_GTIN", "Ce GTIN désigne déjà un autre article : corriger la variante des paires vers cet article au lieu de confirmer celui-ci.", {
          itemIds: owners.map((o) => o.id),
        });
      }
    }
    const pick = (next: string | null | undefined, prev: string | null) => (next === undefined || next === null ? prev : next.trim() || null);
    const merged = {
      gtin,
      brand: pick(input.brand, cur.brand),
      name: pick(input.name, cur.name) ?? cur.name,
      styleCode: pick(input.styleCode, cur.styleCode),
      colorway: pick(input.colorway, cur.colorway),
      sizeLabel: pick(input.sizeLabel, cur.sizeLabel),
      sizeEu: pick(input.sizeEu, cur.sizeEu),
      sizeUs: pick(input.sizeUs, cur.sizeUs),
    };
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseItem"
      SET "gtin" = ${merged.gtin}, "brand" = ${merged.brand}, "name" = ${merged.name}, "styleCode" = ${merged.styleCode},
          "colorway" = ${merged.colorway}, "sizeLabel" = ${merged.sizeLabel}, "sizeEu" = ${merged.sizeEu}, "sizeUs" = ${merged.sizeUs},
          "status" = 'ACTIVE', "searchText" = ${buildSearchText(merged)}, "updatedAt" = now()
      WHERE "id" = ${cur.id}`);
    if (merged.gtin) {
      await tx.$executeRaw(Prisma.sql`
        INSERT INTO "WarehouseItemAlias" ("id", "itemId", "namespace", "value")
        VALUES (${randomUUID()}, ${cur.id}, 'GTIN', ${merged.gtin}) ON CONFLICT ("namespace", "value") DO NOTHING`);
    }
    return { item: await getItem(tx, cur.id), confirmed: true, pairs: await pairs(), note };
  });
}

/** Create (or reuse) the warehouse item for a confirmed catalog candidate. */
export async function createItemFromCandidate(
  db: WarehouseDb,
  candidate: CatalogCandidate
): Promise<{ item: ItemSummary; created: boolean }> {
  return createItem(db, {
    gtin: candidate.gtin,
    brand: candidate.brand,
    name: candidate.name,
    styleCode: candidate.styleCode,
    colorway: candidate.colorway,
    sizeSystem: candidate.sizeSystem,
    sizeLabel: candidate.sizeLabel,
    sizeEu: candidate.sizeEu,
    sizeUs: candidate.sizeUs,
    imageUrl: candidate.imageUrl,
    kickdbVariantId: candidate.kickdbVariantId,
    supplierVariantId: candidate.supplierVariantId,
    catalogSource: candidate.source,
  });
}

/** Attach another identifier to an item. A value already owned elsewhere is a conflict, never moved silently. */
export async function addItemAlias(
  db: WarehouseDb,
  input: { itemId: string; namespace: string; value: string }
): Promise<{ added: boolean }> {
  assertWritesEnabled();
  const namespace = String(input.namespace ?? "").trim().toUpperCase();
  const allowed = ["GTIN", "SKU", "MPN", "STOCKX_VARIANT", "KICKDB_VARIANT", "SUPPLIER_VARIANT", "EXTERNAL"];
  if (!allowed.includes(namespace)) throw invalid(`Espace d'alias attendu : ${allowed.join(", ")}.`);
  let value = String(input.value ?? "").trim();
  if (namespace === "GTIN") {
    const gtin = normalizeGtin(value);
    if (!gtin) throw invalid("GTIN invalide : 8 à 14 chiffres.");
    value = gtin;
  }
  if (!value) throw invalid("Valeur d'alias requise.");
  await getItem(db, input.itemId);
  const owner = await db.$queryRaw<{ itemId: string }[]>(Prisma.sql`
    SELECT "itemId" FROM "WarehouseItemAlias" WHERE "namespace" = ${namespace} AND "value" = ${value}`);
  if (owner[0]) {
    if (owner[0].itemId === input.itemId) return { added: false };
    throw conflict("AMBIGUOUS_GTIN", "Cet identifiant désigne déjà un autre article : arbitrage requis.", {
      itemId: owner[0].itemId,
    });
  }
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseItemAlias" ("id", "itemId", "namespace", "value")
    VALUES (${randomUUID()}, ${input.itemId}, ${namespace}, ${value})`);
  return { added: true };
}

/** Server-side search of warehouse items (brand, model, style, size, GTIN). */
export async function searchItems(conn: WarehouseConn, query: string, limit = 25): Promise<ItemSummary[]> {
  const q = String(query ?? "").trim().toLowerCase().replace(/[%_\\]/g, "");
  if (q.length < 2) return [];
  const terms = q.split(/\s+/).filter(Boolean).slice(0, 6);
  const conds = terms.map((t) => Prisma.sql`i."searchText" LIKE ${`%${t}%`}`);
  return conn.$queryRaw<ItemSummary[]>(Prisma.sql`
    SELECT ${ITEM_COLUMNS} FROM "WarehouseItem" i
    WHERE i."status" <> 'MERGED' AND ${Prisma.join(conds, " AND ")}
    ORDER BY i."name", i."sizeLabel" LIMIT ${Math.min(100, Math.max(1, limit))}`);
}

/**
 * Assisted search in the existing catalog when the GTIN is absent or unknown (A10).
 * Read-only on KickDBProduct / KickDBVariant; returns per-size candidates to confirm.
 */
export async function searchCatalog(conn: WarehouseConn, query: string, limit = 40): Promise<CatalogCandidate[]> {
  const q = String(query ?? "").trim().replace(/[%_\\]/g, "");
  if (q.length < 3) return [];
  const like = `%${q}%`;
  const rows = await conn.$queryRaw<
    {
      id: string;
      gtin: string | null;
      ean: string | null;
      sizeUs: string | null;
      sizeEu: string | null;
      name: string | null;
      brand: string | null;
      styleId: string | null;
      colorway: string | null;
      imageUrl: string | null;
    }[]
  >(Prisma.sql`
    SELECT v."id", v."gtin", v."ean", v."sizeUs", v."sizeEu", p."name", p."brand", p."styleId", p."colorway", p."imageUrl"
    FROM "KickDBProduct" p JOIN "KickDBVariant" v ON v."productId" = p."id"
    WHERE p."id" IN (
      SELECT "id" FROM "KickDBProduct"
      WHERE "styleId" ILIKE ${like} OR "name" ILIKE ${like} OR "urlKey" ILIKE ${like}
      ORDER BY "name" LIMIT 8)
      AND v."notFound" = false
    ORDER BY p."name", v."sizeUs" LIMIT ${Math.min(200, Math.max(1, limit))}`);
  return rows.map((k) => ({
    source: "KICKDB" as const,
    gtin: k.gtin ?? k.ean ?? "",
    brand: k.brand,
    name: k.name ?? k.styleId ?? "Article sans nom",
    styleCode: k.styleId,
    colorway: k.colorway,
    sizeSystem: k.sizeUs ? "US" : k.sizeEu ? "EU" : null,
    sizeLabel: k.sizeUs ? `US ${k.sizeUs}` : k.sizeEu ? `EU ${k.sizeEu}` : null,
    sizeEu: k.sizeEu,
    sizeUs: k.sizeUs,
    imageUrl: k.imageUrl,
    kickdbVariantId: k.id,
    supplierVariantId: null,
  }));
}
