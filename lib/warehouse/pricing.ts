import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { withTx, type WarehouseConn, type WarehouseDb, type WarehouseTx } from "./db";
import { WarehouseError, conflict, invalid, notFound } from "./errors";
import { assertWritesEnabled, runOperation, type OperationResult } from "./operations";
import type { ActorContext } from "./types";

/**
 * Deposit agreements, administered prices and partner requests.
 *
 * Lot 1 publishes nothing: a price here is an internal, per-unit record that the partner can
 * read. Public price, fees, seller net and margin are stored separately, with the source and
 * basis of any proposal. A price is attached to ONE unit of ONE variant — it never follows a
 * variant correction, an owner change, or a wrong size received by mistake.
 */

const round2 = (v: number) => Math.round((v + Number.EPSILON) * 100) / 100;

function money(value: unknown, label: string, opts: { nullable?: boolean } = {}): number | null {
  if (value === null || value === undefined || value === "") {
    if (opts.nullable) return null;
    throw invalid(`${label} requis.`);
  }
  const n = typeof value === "number" ? value : Number(String(value).replace(",", "."));
  if (!Number.isFinite(n) || n < 0 || n > 1_000_000) throw invalid(`${label} invalide.`);
  return round2(n);
}

function requireAdmin(ctx: ActorContext, what: string): void {
  if (ctx.role !== "admin" && ctx.role !== "system") {
    throw new WarehouseError("FORBIDDEN", `${what} : réservé au gestionnaire.`, 403);
  }
}

// ───────────────────────────── Agreements ─────────────────────────────

export type AgreementRow = {
  id: string;
  partnerId: string;
  version: number;
  status: "DRAFT" | "ACTIVE" | "ENDED";
  saleAllowed: boolean;
  channels: string[];
  pricingMode: "MANUAL" | "STOCKX_BUYNOW_FACTOR";
  pricingFactor: string | null;
  pricingBasisIs: "PUBLIC_PRICE" | "SELLER_NET" | "UNCONFIRMED";
  commissionRate: string | null;
  fixedFee: string | null;
  currency: string;
  validFrom: string | null;
  validTo: string | null;
  notes: string | null;
  createdAt: string;
};

const AGREEMENT_SELECT = Prisma.sql`
  SELECT "id", "partnerId", "version", "status", "saleAllowed", "channels", "pricingMode", "pricingFactor"::text AS "pricingFactor",
         "pricingBasisIs", "commissionRate"::text AS "commissionRate", "fixedFee"::text AS "fixedFee", "currency",
         "validFrom", "validTo", "notes", "createdAt"
  FROM "WarehouseDepositAgreement"`;
const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
const toAgreement = (a: any): AgreementRow => ({ ...a, validFrom: iso(a.validFrom), validTo: iso(a.validTo), createdAt: iso(a.createdAt) });

export async function listAgreements(conn: WarehouseConn, partnerId: string): Promise<AgreementRow[]> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`${AGREEMENT_SELECT} WHERE "partnerId" = ${partnerId} ORDER BY "version" DESC`);
  return rows.map(toAgreement);
}

export async function getActiveAgreement(conn: WarehouseConn, partnerId: string): Promise<AgreementRow | null> {
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`${AGREEMENT_SELECT} WHERE "partnerId" = ${partnerId} AND "status" = 'ACTIVE' LIMIT 1`);
  return rows[0] ? toAgreement(rows[0]) : null;
}

export type AgreementInput = {
  partnerId: string;
  saleAllowed: boolean;
  channels?: string[];
  pricingMode?: "MANUAL" | "STOCKX_BUYNOW_FACTOR";
  pricingFactor?: number | string | null;
  pricingBasisIs?: "PUBLIC_PRICE" | "SELLER_NET" | "UNCONFIRMED";
  /** 0.15 = 15 % of the public price. */
  commissionRate?: number | string | null;
  fixedFee?: number | string | null;
  currency?: string;
  notes?: string | null;
};

/**
 * Agreements are versioned and never edited in place: saving creates version n+1 and ends the
 * previous active one, so the terms attached to past units and sales stay readable (B43).
 */
export async function saveAgreement(db: WarehouseDb, input: AgreementInput, ctx: ActorContext): Promise<AgreementRow> {
  assertWritesEnabled();
  requireAdmin(ctx, "Accord de dépôt");
  const factor = input.pricingFactor === null || input.pricingFactor === undefined || input.pricingFactor === "" ? null : Number(String(input.pricingFactor).replace(",", "."));
  if (factor !== null && (!Number.isFinite(factor) || factor <= 0 || factor > 2)) throw invalid("Coefficient attendu entre 0 et 2 (ex. 0,70).");
  const commission = input.commissionRate === null || input.commissionRate === undefined || input.commissionRate === "" ? null : Number(String(input.commissionRate).replace(",", "."));
  if (commission !== null && (!Number.isFinite(commission) || commission < 0 || commission >= 1)) throw invalid("Commission attendue entre 0 et 1 (ex. 0,15 pour 15 %).");
  const fixedFee = money(input.fixedFee, "Frais fixes", { nullable: true });
  const mode = input.pricingMode ?? "MANUAL";
  if (!["MANUAL", "STOCKX_BUYNOW_FACTOR"].includes(mode)) throw invalid("Mode de prix invalide.");
  if (mode === "STOCKX_BUYNOW_FACTOR" && factor === null) throw invalid("Coefficient requis pour le mode Buy Now × coefficient.");
  const basisIs = input.pricingBasisIs ?? "UNCONFIRMED";
  if (!["PUBLIC_PRICE", "SELLER_NET", "UNCONFIRMED"].includes(basisIs)) throw invalid("Interprétation de la base invalide.");
  const channels = [...new Set((input.channels ?? []).map((c) => String(c).trim().toUpperCase()).filter(Boolean))].slice(0, 20);
  const currency = String(input.currency ?? "CHF").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw invalid("Devise : code ISO à 3 lettres.");

  const id = await withTx(db, async (tx) => {
    const partner = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "Partner" WHERE "id" = ${input.partnerId} FOR SHARE`);
    if (!partner[0]) throw notFound("Partenaire");
    const max = await tx.$queryRaw<{ v: number }[]>(Prisma.sql`
      SELECT coalesce(max("version"), 0)::int AS v FROM "WarehouseDepositAgreement" WHERE "partnerId" = ${input.partnerId}`);
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseDepositAgreement" SET "status" = 'ENDED', "validTo" = now(), "updatedAt" = now()
      WHERE "partnerId" = ${input.partnerId} AND "status" = 'ACTIVE'`);
    const newId = randomUUID();
    await tx.$executeRaw(Prisma.sql`
      INSERT INTO "WarehouseDepositAgreement"
        ("id", "partnerId", "version", "status", "saleAllowed", "channels", "pricingMode", "pricingFactor", "pricingBasisIs",
         "commissionRate", "fixedFee", "currency", "validFrom", "notes")
      VALUES
        (${newId}, ${input.partnerId}, ${max[0].v + 1}, 'ACTIVE', ${Boolean(input.saleAllowed)}, ${channels}::text[], ${mode},
         ${factor}::numeric, ${basisIs}, ${commission}::numeric, ${fixedFee}::numeric, ${currency}, now(), ${input.notes?.trim().slice(0, 2000) || null})`);
    return newId;
  });
  const rows = await db.$queryRaw<any[]>(Prisma.sql`${AGREEMENT_SELECT} WHERE "id" = ${id}`);
  return toAgreement(rows[0]);
}

// ───────────────────────────── Price computation ─────────────────────────────

export type PriceBreakdown = {
  publicPrice: number | null;
  fees: number | null;
  sellerNet: number | null;
  /** Resell Lausanne margin on a deposit = the fees kept. */
  margin: number | null;
};

/** Public price → fees, seller net, margin under an agreement. Missing terms give nulls, never invented amounts. */
export function computeBreakdown(
  publicPrice: number | null,
  terms: { commissionRate: number | null; fixedFee: number | null } | null,
  explicitSellerNet?: number | null
): PriceBreakdown {
  if (publicPrice === null) {
    return { publicPrice: null, fees: null, sellerNet: explicitSellerNet ?? null, margin: null };
  }
  if (explicitSellerNet !== null && explicitSellerNet !== undefined) {
    const fees = round2(publicPrice - explicitSellerNet);
    return { publicPrice, fees, sellerNet: explicitSellerNet, margin: fees };
  }
  if (!terms || (terms.commissionRate === null && terms.fixedFee === null)) {
    return { publicPrice, fees: null, sellerNet: null, margin: null };
  }
  const fees = round2(publicPrice * (terms.commissionRate ?? 0) + (terms.fixedFee ?? 0));
  return { publicPrice, fees, sellerNet: round2(Math.max(0, publicPrice - fees)), margin: fees };
}

/**
 * StockX Buy Now × factor (pilot: 0.70 → CHF 200 gives CHF 140). The result is read as a PUBLIC
 * price unless the agreement says the intention is a seller net.
 */
export function computeStockxProposal(input: {
  basisAmount: number;
  factor: number;
  basisIs: "PUBLIC_PRICE" | "SELLER_NET" | "UNCONFIRMED";
  terms: { commissionRate: number | null; fixedFee: number | null } | null;
}): PriceBreakdown & { interpretedAs: "PUBLIC_PRICE" | "SELLER_NET" } {
  const derived = round2(input.basisAmount * input.factor);
  if (input.basisIs === "SELLER_NET") {
    return { publicPrice: null, fees: null, sellerNet: derived, margin: null, interpretedAs: "SELLER_NET" };
  }
  return { ...computeBreakdown(derived, input.terms), interpretedAs: "PUBLIC_PRICE" };
}

type PricedUnit = { id: string; itemId: string; ownerKind: string; ownerPartnerId: string | null; presence: string };

async function agreementTermsTx(tx: WarehouseTx, partnerId: string | null) {
  if (!partnerId) return null;
  const rows = await tx.$queryRaw<{ id: string; commissionRate: string | null; fixedFee: string | null; currency: string; pricingBasisIs: any; pricingFactor: string | null }[]>(
    Prisma.sql`SELECT "id", "commissionRate"::text AS "commissionRate", "fixedFee"::text AS "fixedFee", "currency", "pricingBasisIs", "pricingFactor"::text AS "pricingFactor"
               FROM "WarehouseDepositAgreement" WHERE "partnerId" = ${partnerId} AND "status" = 'ACTIVE' LIMIT 1`
  );
  const a = rows[0];
  if (!a) return null;
  return {
    id: a.id,
    currency: a.currency,
    pricingBasisIs: a.pricingBasisIs as "PUBLIC_PRICE" | "SELLER_NET" | "UNCONFIRMED",
    pricingFactor: a.pricingFactor === null ? null : Number(a.pricingFactor),
    commissionRate: a.commissionRate === null ? null : Number(a.commissionRate),
    fixedFee: a.fixedFee === null ? null : Number(a.fixedFee),
  };
}

async function insertPriceTx(
  tx: WarehouseTx,
  p: {
    unit: PricedUnit;
    agreementId: string | null;
    currency: string;
    breakdown: PriceBreakdown;
    source: "MANUAL" | "STOCKX_BUYNOW_FACTOR";
    status: "PROPOSED" | "VALIDATED";
    basisAmount?: number | null;
    basisCurrency?: string | null;
    basisRef?: string | null;
    basisIncludesFees?: boolean | null;
    basisObservedAt?: Date | null;
    factor?: number | null;
    note?: string | null;
  },
  ctx: ActorContext
): Promise<string> {
  // A new proposal replaces older pending proposals; a validated price replaces the previous validated one.
  await tx.$executeRaw(Prisma.sql`
    UPDATE "WarehouseUnitPrice" SET "status" = 'SUPERSEDED', "updatedAt" = now()
    WHERE "unitId" = ${p.unit.id} AND "status" IN (${p.status === "VALIDATED" ? Prisma.sql`'PROPOSED', 'VALIDATED'` : Prisma.sql`'PROPOSED'`})`);
  const id = randomUUID();
  await tx.$executeRaw(Prisma.sql`
    INSERT INTO "WarehouseUnitPrice"
      ("id", "unitId", "itemId", "agreementId", "currency", "publicPrice", "sellerNet", "fees", "margin", "source", "basisAmount",
       "basisCurrency", "basisRef", "basisIncludesFees", "basisObservedAt", "factor", "status", "note", "setByRole", "setByOperatorId", "validatedAt")
    VALUES
      (${id}, ${p.unit.id}, ${p.unit.itemId}, ${p.agreementId}, ${p.currency}, ${p.breakdown.publicPrice}::numeric, ${p.breakdown.sellerNet}::numeric,
       ${p.breakdown.fees}::numeric, ${p.breakdown.margin}::numeric, ${p.source}, ${p.basisAmount ?? null}::numeric, ${p.basisCurrency ?? null},
       ${p.basisRef ?? null}, ${p.basisIncludesFees ?? null}, ${p.basisObservedAt ?? null}, ${p.factor ?? null}::numeric, ${p.status},
       ${p.note?.trim().slice(0, 500) || null}, ${ctx.role}, ${ctx.operatorId ?? null}, ${p.status === "VALIDATED" ? new Date() : null})`);
  return id;
}

async function lockPricedUnitTx(tx: WarehouseTx, unitId: string): Promise<PricedUnit> {
  const rows = await tx.$queryRaw<PricedUnit[]>(Prisma.sql`
    SELECT "id", "itemId", "ownerKind", "ownerPartnerId", "presence" FROM "WarehouseUnit" WHERE "id" = ${unitId} FOR UPDATE`);
  if (!rows[0]) throw notFound("Paire");
  if (rows[0].presence === "OUT") throw conflict("UNIT_STATE_CONFLICT", "Paire sortie du stock : plus de prix à fixer.");
  return rows[0];
}

/** Admin sets the price of one pair by hand (validated immediately). The price can be absent: it never blocks a putaway. */
export async function setUnitPrice(
  db: WarehouseDb,
  input: { opKey: string; unitId: string; publicPrice: number | string; sellerNet?: number | string | null; currency?: string; note?: string | null },
  ctx: ActorContext
): Promise<OperationResult<{ priceId: string; unitId: string } & PriceBreakdown>> {
  requireAdmin(ctx, "Fixer un prix");
  const publicPrice = money(input.publicPrice, "Prix public") as number;
  const explicitNet = money(input.sellerNet, "Net vendeur", { nullable: true });
  if (explicitNet !== null && explicitNet > publicPrice) throw invalid("Le net vendeur ne peut pas dépasser le prix public.");
  return runOperation(db, { opKey: input.opKey, kind: "PRICE_SET", request: input, ctx }, async (tx) => {
    const unit = await lockPricedUnitTx(tx, input.unitId);
    const terms = await agreementTermsTx(tx, unit.ownerPartnerId);
    const breakdown = computeBreakdown(publicPrice, terms, explicitNet);
    const priceId = await insertPriceTx(
      tx,
      { unit, agreementId: terms?.id ?? null, currency: (input.currency ?? terms?.currency ?? "CHF").toUpperCase(), breakdown, source: "MANUAL", status: "VALIDATED", note: input.note },
      ctx
    );
    return { priceId, unitId: unit.id, ...breakdown };
  });
}

export type StockxProposalInput = {
  opKey: string;
  partnerId: string;
  /** The exact variant the Buy Now was read for. Only units of THIS variant get a proposal. */
  itemId: string;
  basisAmount: number | string;
  basisCurrency: string;
  /** Where the amount was read (URL, screenshot ref, listing id). */
  basisRef: string;
  basisIncludesFees: boolean | null;
  basisObservedAt: string | Date;
  factor?: number | string | null;
  note?: string | null;
};

/**
 * Batch proposal for a partner's pairs of one exact variant: Buy Now × factor. Proposals wait
 * for an explicit validation; incomplete basis data (no reference, other currency, unknown fee
 * inclusion) is flagged and cannot be validated as is.
 */
export async function proposeStockxPrices(
  db: WarehouseDb,
  input: StockxProposalInput,
  ctx: ActorContext
): Promise<OperationResult<{ proposed: number; unitIds: string[]; breakdown: PriceBreakdown & { interpretedAs: string }; reliable: boolean; warnings: string[] }>> {
  requireAdmin(ctx, "Proposer des prix");
  const basisAmount = money(input.basisAmount, "Montant Buy Now") as number;
  const observedAt = new Date(input.basisObservedAt);
  if (Number.isNaN(observedAt.getTime())) throw invalid("Date du relevé invalide.");
  const basisCurrency = String(input.basisCurrency ?? "").trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(basisCurrency)) throw invalid("Devise du relevé : code ISO à 3 lettres.");
  return runOperation(db, { opKey: input.opKey, kind: "PRICE_PROPOSE_STOCKX", request: input, ctx }, async (tx) => {
    const terms = await agreementTermsTx(tx, input.partnerId);
    const factor = input.factor === null || input.factor === undefined || input.factor === "" ? terms?.pricingFactor ?? 0.7 : Number(String(input.factor).replace(",", "."));
    if (!Number.isFinite(factor) || factor <= 0 || factor > 2) throw invalid("Coefficient attendu entre 0 et 2.");
    const currency = terms?.currency ?? "CHF";
    const warnings: string[] = [];
    if (!terms) warnings.push("Aucun accord de dépôt actif : frais et net vendeur non calculés.");
    if (terms?.pricingBasisIs === "UNCONFIRMED") warnings.push("Interprétation à confirmer : le résultat est lu comme prix public (et non net vendeur).");
    if (!String(input.basisRef ?? "").trim()) warnings.push("Référence du relevé manquante.");
    if (basisCurrency !== currency) warnings.push(`Relevé en ${basisCurrency}, accord en ${currency} : pas de conversion automatique.`);
    if (input.basisIncludesFees === null || input.basisIncludesFees === undefined) warnings.push("Frais inclus ou non dans le relevé : à préciser.");
    const reliable = Boolean(String(input.basisRef ?? "").trim()) && basisCurrency === currency && input.basisIncludesFees !== null && input.basisIncludesFees !== undefined;
    const breakdown = computeStockxProposal({ basisAmount, factor, basisIs: terms?.pricingBasisIs ?? "UNCONFIRMED", terms });

    const units = await tx.$queryRaw<PricedUnit[]>(Prisma.sql`
      SELECT "id", "itemId", "ownerKind", "ownerPartnerId", "presence" FROM "WarehouseUnit"
      WHERE "ownerPartnerId" = ${input.partnerId} AND "ownerKind" = 'PARTNER' AND "itemId" = ${input.itemId} AND "presence" <> 'OUT'
      ORDER BY "id" LIMIT 2000 FOR UPDATE`);
    for (const unit of units) {
      await insertPriceTx(
        tx,
        {
          unit,
          agreementId: terms?.id ?? null,
          currency,
          breakdown,
          source: "STOCKX_BUYNOW_FACTOR",
          status: "PROPOSED",
          basisAmount,
          basisCurrency,
          basisRef: String(input.basisRef ?? "").trim().slice(0, 500) || null,
          basisIncludesFees: input.basisIncludesFees ?? null,
          basisObservedAt: observedAt,
          factor,
          note: [input.note?.trim(), reliable ? null : "Données de base incomplètes : à compléter avant validation."].filter(Boolean).join(" · ") || null,
        },
        ctx
      );
    }
    return { proposed: units.length, unitIds: units.map((u) => u.id), breakdown, reliable, warnings };
  });
}

/** Validate or reject a pending proposal. An unreliable basis cannot be validated: fix it or set the price by hand. */
export async function decidePrice(
  db: WarehouseDb,
  input: { priceId: string; decision: "VALIDATE" | "REJECT"; note?: string | null },
  ctx: ActorContext
): Promise<{ priceId: string; status: string }> {
  assertWritesEnabled();
  requireAdmin(ctx, "Valider un prix");
  return withTx(db, async (tx) => {
    const rows = await tx.$queryRaw<any[]>(Prisma.sql`
      SELECT p."id", p."unitId", p."itemId", p."status", p."source", p."publicPrice", p."basisRef", p."basisCurrency", p."currency",
             p."basisIncludesFees", u."itemId" AS "unitItemId"
      FROM "WarehouseUnitPrice" p JOIN "WarehouseUnit" u ON u."id" = p."unitId" WHERE p."id" = ${input.priceId} FOR UPDATE OF p, u`);
    const p = rows[0];
    if (!p) throw notFound("Prix");
    const target = input.decision === "VALIDATE" ? "VALIDATED" : "REJECTED";
    if (p.status === target) return { priceId: p.id, status: p.status };
    if (p.status !== "PROPOSED") throw conflict("CONFLICT", `Proposition déjà ${p.status}.`);
    if (input.decision === "VALIDATE") {
      if (p.unitItemId !== p.itemId) throw conflict("CONFLICT", "La variante de la paire a changé depuis la proposition : refaire la proposition.");
      if (p.publicPrice === null) throw conflict("CONFLICT", "Proposition lue comme net vendeur : fixer le prix public avant validation.");
      if (p.source === "STOCKX_BUYNOW_FACTOR" && (!p.basisRef || p.basisCurrency !== p.currency || p.basisIncludesFees === null)) {
        throw conflict("CONFLICT", "Données de base incomplètes (référence, devise ou frais inclus) : la ligne reste en validation.");
      }
      await tx.$executeRaw(Prisma.sql`
        UPDATE "WarehouseUnitPrice" SET "status" = 'SUPERSEDED', "updatedAt" = now() WHERE "unitId" = ${p.unitId} AND "status" = 'VALIDATED'`);
    }
    await tx.$executeRaw(Prisma.sql`
      UPDATE "WarehouseUnitPrice" SET "status" = ${target}, "validatedAt" = ${input.decision === "VALIDATE" ? new Date() : null},
        "note" = coalesce(${input.note?.trim().slice(0, 500) || null}, "note"), "setByOperatorId" = coalesce(${ctx.operatorId ?? null}, "setByOperatorId"),
        "updatedAt" = now()
      WHERE "id" = ${p.id}`);
    return { priceId: p.id, status: target };
  });
}

export type PartnerPriceRow = {
  unitId: string;
  labelCode: string;
  itemId: string;
  itemName: string;
  itemBrand: string | null;
  itemSizeLabel: string | null;
  itemStyleCode: string | null;
  presence: string;
  qcState: string;
  saleState: string;
  currency: string | null;
  publicPrice: string | null;
  sellerNet: string | null;
  fees: string | null;
  priceSource: string | null;
  proposalId: string | null;
  proposalPublicPrice: string | null;
  proposalSellerNet: string | null;
  proposalBasisAmount: string | null;
  proposalNote: string | null;
};

/** Tarifs screen: a partner's pairs with the validated price and the pending proposal, paginated. */
export async function listPartnerPrices(
  conn: WarehouseConn,
  input: { partnerId: string; itemId?: string; only?: "UNPRICED" | "PROPOSED" | "PRICED"; limit?: number; cursor?: string | null }
): Promise<{ items: PartnerPriceRow[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const where: Prisma.Sql[] = [Prisma.sql`u."ownerPartnerId" = ${input.partnerId}`, Prisma.sql`u."ownerKind" = 'PARTNER'`, Prisma.sql`u."presence" <> 'OUT'`];
  if (input.itemId) where.push(Prisma.sql`u."itemId" = ${input.itemId}`);
  if (input.only === "UNPRICED") where.push(Prisma.sql`v."id" IS NULL`);
  if (input.only === "PRICED") where.push(Prisma.sql`v."id" IS NOT NULL`);
  if (input.only === "PROPOSED") where.push(Prisma.sql`pp."id" IS NOT NULL`);
  if (input.cursor) {
    // The id is the last segment: a model name may itself contain "|".
    const cut = input.cursor.lastIndexOf("|");
    const name = cut < 0 ? "" : input.cursor.slice(0, cut);
    const id = cut < 0 ? "" : input.cursor.slice(cut + 1);
    if (id) where.push(Prisma.sql`(i."name", u."id") > (${name}, ${id})`);
  }
  const rows = await conn.$queryRaw<PartnerPriceRow[]>(Prisma.sql`
    SELECT u."id" AS "unitId", u."labelCode", u."itemId", i."name" AS "itemName", i."brand" AS "itemBrand", i."sizeLabel" AS "itemSizeLabel",
           i."styleCode" AS "itemStyleCode", u."presence", u."qcState", u."saleState",
           v."currency", v."publicPrice"::text AS "publicPrice", v."sellerNet"::text AS "sellerNet", v."fees"::text AS "fees", v."source" AS "priceSource",
           pp."id" AS "proposalId", pp."publicPrice"::text AS "proposalPublicPrice", pp."sellerNet"::text AS "proposalSellerNet",
           pp."basisAmount"::text AS "proposalBasisAmount", pp."note" AS "proposalNote"
    FROM "WarehouseUnit" u
    JOIN "WarehouseItem" i ON i."id" = u."itemId"
    LEFT JOIN "WarehouseUnitPrice" v ON v."unitId" = u."id" AND v."status" = 'VALIDATED'
    LEFT JOIN LATERAL (
      SELECT * FROM "WarehouseUnitPrice" x WHERE x."unitId" = u."id" AND x."status" = 'PROPOSED' ORDER BY x."createdAt" DESC LIMIT 1) pp ON true
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY i."name", u."id" LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return { items: page, nextCursor: rows.length > limit && last ? `${last.itemName}|${last.unitId}` : null };
}

// ───────────────────────────── Partner requests ─────────────────────────────

export type PartnerRequestRow = {
  id: string;
  partnerId: string;
  partnerName: string;
  unitId: string | null;
  unitShortRef: string | null;
  itemName: string | null;
  itemSizeLabel: string | null;
  type: "PRICE_CHANGE" | "DISCREPANCY" | "OTHER";
  message: string;
  requestedPublicPrice: string | null;
  currency: string;
  status: "OPEN" | "ANSWERED" | "CLOSED";
  response: string | null;
  answeredAt: string | null;
  createdAt: string;
};

/**
 * A partner asks for a price change or reports a discrepancy. The unit must be theirs — a
 * foreign or unknown unit id gives the same NOT_FOUND (no existence leak). Nothing is applied
 * automatically: the team answers and acts through the normal audited gestures.
 */
export async function createPartnerRequest(
  db: WarehouseDb,
  input: { partnerId: string; unitId?: string | null; type: "PRICE_CHANGE" | "DISCREPANCY" | "OTHER"; message: string; requestedPublicPrice?: number | string | null }
): Promise<{ id: string }> {
  assertWritesEnabled();
  if (!["PRICE_CHANGE", "DISCREPANCY", "OTHER"].includes(input.type)) throw invalid("Type de demande invalide.");
  const message = String(input.message ?? "").trim();
  if (message.length < 3 || message.length > 2000) throw invalid("Message attendu : 3 à 2000 caractères.");
  const requested = money(input.requestedPublicPrice, "Prix demandé", { nullable: true });
  if (input.type === "PRICE_CHANGE" && requested === null) throw invalid("Indiquer le prix public souhaité.");
  if (input.unitId) {
    const owned = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
      SELECT "id" FROM "WarehouseUnit" WHERE "id" = ${input.unitId} AND "ownerPartnerId" = ${input.partnerId} AND "ownerKind" = 'PARTNER'`);
    if (!owned[0]) throw notFound("Paire");
  }
  const open = await db.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM "WarehousePartnerRequest" WHERE "partnerId" = ${input.partnerId} AND "status" = 'OPEN'`);
  if (open[0].n >= 200) throw conflict("CONFLICT", "Trop de demandes ouvertes : attendre une réponse avant d'en créer d'autres.");
  const id = randomUUID();
  await db.$executeRaw(Prisma.sql`
    INSERT INTO "WarehousePartnerRequest" ("id", "partnerId", "unitId", "type", "message", "requestedPublicPrice")
    VALUES (${id}, ${input.partnerId}, ${input.unitId ?? null}, ${input.type}, ${message}, ${requested}::numeric)`);
  return { id };
}

export async function listPartnerRequests(
  conn: WarehouseConn,
  input: { partnerId?: string; status?: "OPEN" | "ANSWERED" | "CLOSED"; limit?: number }
): Promise<PartnerRequestRow[]> {
  const where: Prisma.Sql[] = [Prisma.sql`TRUE`];
  if (input.partnerId) where.push(Prisma.sql`r."partnerId" = ${input.partnerId}`);
  if (input.status) where.push(Prisma.sql`r."status" = ${input.status}`);
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT r."id", r."partnerId", p."name" AS "partnerName", r."unitId", i."name" AS "itemName", i."sizeLabel" AS "itemSizeLabel",
           r."type", r."message", r."requestedPublicPrice"::text AS "requestedPublicPrice", r."currency", r."status", r."response",
           r."answeredAt", r."createdAt"
    FROM "WarehousePartnerRequest" r
    JOIN "Partner" p ON p."id" = r."partnerId"
    LEFT JOIN "WarehouseUnit" u ON u."id" = r."unitId"
    LEFT JOIN "WarehouseItem" i ON i."id" = u."itemId"
    WHERE ${Prisma.join(where, " AND ")}
    ORDER BY r."createdAt" DESC LIMIT ${Math.min(200, Math.max(1, input.limit ?? 100))}`);
  return rows.map((r) => ({
    ...r,
    unitShortRef: r.unitId ? `${r.unitId.slice(0, 4)}-${r.unitId.slice(4, 8)}`.toUpperCase() : null,
    answeredAt: iso(r.answeredAt),
    createdAt: iso(r.createdAt),
  }));
}

export async function answerPartnerRequest(
  db: WarehouseDb,
  input: { id: string; response: string; status?: "ANSWERED" | "CLOSED" },
  _ctx: ActorContext
): Promise<{ id: string; status: string }> {
  assertWritesEnabled();
  const response = String(input.response ?? "").trim();
  if (response.length < 2 || response.length > 2000) throw invalid("Réponse attendue : 2 à 2000 caractères.");
  const status = input.status ?? "ANSWERED";
  if (!["ANSWERED", "CLOSED"].includes(status)) throw invalid("Statut invalide.");
  const rows = await db.$queryRaw<{ id: string; status: string }[]>(Prisma.sql`
    UPDATE "WarehousePartnerRequest" SET "status" = ${status}, "response" = ${response}, "answeredAt" = now(), "updatedAt" = now()
    WHERE "id" = ${input.id} RETURNING "id", "status"`);
  if (!rows[0]) throw notFound("Demande");
  return rows[0];
}
