import { Prisma } from "@prisma/client";
import { classifyScan, toCsv, unitShortRef } from "./codes";
import type { WarehouseConn } from "./db";
import { notFound } from "./errors";

/**
 * Partner-facing read model ("Accueil", "Mon stock").
 *
 * Isolation is applied HERE, on the server, in every query: `ownerPartnerId = <session partner>`
 * AND `ownerKind = 'PARTNER'`. The partner id always comes from the verified session, never from
 * a request parameter. Lists, detail, counters and exports share the same predicate.
 *
 * Whitelisted fields only. Never exposed: rack address / location code, other owners, operators,
 * stations, internal notes, costs and margin, customer data. The site (code + name) is shown.
 * A foreign unit id and an unknown one give the same NOT_FOUND.
 */

export type PartnerUnitStatus =
  | "IN_CONTROL"
  | "STORED"
  | "SALE_AUTHORIZED"
  | "BLOCKED"
  | "IN_TRANSIT"
  | "CHECKING"
  | "OUT";

const STATUS_LABELS: Record<PartnerUnitStatus, string> = {
  IN_CONTROL: "En contrôle",
  STORED: "En stock — stockage seul",
  SALE_AUTHORIZED: "Autorisée à la vente",
  BLOCKED: "Bloquée — en vérification",
  IN_TRANSIT: "En transfert entre sites",
  CHECKING: "Localisation en vérification",
  OUT: "Sortie du stock",
};

/** One readable status from the independent internal states. "Publiée" does not exist in lot 1. */
export function partnerUnitStatus(u: { presence: string; qcState: string; saleState: string }): PartnerUnitStatus {
  if (u.presence === "OUT") return "OUT";
  if (u.presence === "IN_TRANSIT" || u.presence === "THIRD_PARTY") return "IN_TRANSIT";
  if (u.presence === "MISSING") return "CHECKING";
  if (u.qcState === "QUARANTINE" || u.saleState === "BLOCKED") return "BLOCKED";
  if (u.qcState === "PENDING") return "IN_CONTROL";
  if (u.saleState === "SALE_AUTHORIZED") return "SALE_AUTHORIZED";
  return "STORED";
}

const STATUS_SQL = Prisma.sql`
  CASE
    WHEN u."presence" = 'OUT' THEN 'OUT'
    WHEN u."presence" IN ('IN_TRANSIT', 'THIRD_PARTY') THEN 'IN_TRANSIT'
    WHEN u."presence" = 'MISSING' THEN 'CHECKING'
    WHEN u."qcState" = 'QUARANTINE' OR u."saleState" = 'BLOCKED' THEN 'BLOCKED'
    WHEN u."qcState" = 'PENDING' THEN 'IN_CONTROL'
    WHEN u."saleState" = 'SALE_AUTHORIZED' THEN 'SALE_AUTHORIZED'
    ELSE 'STORED'
  END`;

const owned = (partnerId: string) => Prisma.sql`u."ownerPartnerId" = ${partnerId} AND u."ownerKind" = 'PARTNER'`;

export type PartnerStockSummary = {
  /** Pairs physically held for the partner (present, in control or on the shelf). */
  held: number;
  inControl: number;
  stored: number;
  saleAuthorized: number;
  blocked: number;
  inTransit: number;
  checking: number;
  /** Lot 1 has no channel publication: null + reason instead of an invented number. */
  published: null;
  publishedReason: string;
  pricedUnits: number;
  /** Sum of validated public prices of held pairs, per currency. */
  publicValue: { currency: string; amount: string; units: number }[];
  sites: { siteCode: string; siteName: string; held: number }[];
  openRequests: number;
  lastReceivedAt: string | null;
};

export async function getPartnerStockSummary(conn: WarehouseConn, partnerId: string): Promise<PartnerStockSummary> {
  const counts = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT count(*) FILTER (WHERE u."presence" = 'PRESENT')::int AS "held",
           count(*) FILTER (WHERE s.st = 'IN_CONTROL')::int AS "inControl",
           count(*) FILTER (WHERE s.st = 'STORED')::int AS "stored",
           count(*) FILTER (WHERE s.st = 'SALE_AUTHORIZED')::int AS "saleAuthorized",
           count(*) FILTER (WHERE s.st = 'BLOCKED')::int AS "blocked",
           count(*) FILTER (WHERE s.st = 'IN_TRANSIT')::int AS "inTransit",
           count(*) FILTER (WHERE s.st = 'CHECKING')::int AS "checking",
           max(u."receivedAt") AS "lastReceivedAt"
    FROM "WarehouseUnit" u CROSS JOIN LATERAL (SELECT ${STATUS_SQL} AS st) s
    WHERE ${owned(partnerId)} AND u."presence" <> 'OUT'`);
  const value = await conn.$queryRaw<{ currency: string; amount: string; units: number }[]>(Prisma.sql`
    SELECT v."currency", sum(v."publicPrice")::text AS "amount", count(*)::int AS "units"
    FROM "WarehouseUnit" u JOIN "WarehouseUnitPrice" v ON v."unitId" = u."id" AND v."status" = 'VALIDATED' AND v."publicPrice" IS NOT NULL
    WHERE ${owned(partnerId)} AND u."presence" = 'PRESENT' GROUP BY v."currency" ORDER BY v."currency"`);
  const sites = await conn.$queryRaw<{ siteCode: string; siteName: string; held: number }[]>(Prisma.sql`
    SELECT s."code" AS "siteCode", s."name" AS "siteName", count(*)::int AS "held"
    FROM "WarehouseUnit" u JOIN "WarehouseSite" s ON s."id" = u."currentSiteId"
    WHERE ${owned(partnerId)} AND u."presence" = 'PRESENT' GROUP BY s."code", s."name" ORDER BY s."code"`);
  const requests = await conn.$queryRaw<{ n: number }[]>(Prisma.sql`
    SELECT count(*)::int AS n FROM "WarehousePartnerRequest" WHERE "partnerId" = ${partnerId} AND "status" = 'OPEN'`);
  const c = counts[0];
  return {
    held: c.held,
    inControl: c.inControl,
    stored: c.stored,
    saleAuthorized: c.saleAuthorized,
    blocked: c.blocked,
    inTransit: c.inTransit,
    checking: c.checking,
    published: null,
    publishedReason: "Aucune publication sur un canal de vente n'est active pour le stock en dépôt à ce stade.",
    pricedUnits: value.reduce((n, v) => n + v.units, 0),
    publicValue: value,
    sites,
    openRequests: requests[0].n,
    lastReceivedAt: c.lastReceivedAt ? new Date(c.lastReceivedAt).toISOString() : null,
  };
}

export type PartnerUnitRow = {
  id: string;
  shortRef: string;
  itemId: string;
  itemName: string;
  itemBrand: string | null;
  itemStyleCode: string | null;
  itemSizeLabel: string | null;
  itemImageUrl: string | null;
  itemGtin: string | null;
  condition: string;
  boxCondition: string;
  status: PartnerUnitStatus;
  statusLabel: string;
  siteCode: string | null;
  siteName: string | null;
  receivedAt: string;
  currency: string | null;
  publicPrice: string | null;
  sellerNet: string | null;
};

const PARTNER_UNIT_SELECT = Prisma.sql`
  SELECT u."id", u."itemId", i."name" AS "itemName", i."brand" AS "itemBrand", i."styleCode" AS "itemStyleCode",
         i."sizeLabel" AS "itemSizeLabel", i."imageUrl" AS "itemImageUrl", i."gtin" AS "itemGtin",
         u."condition", u."boxCondition", ${STATUS_SQL} AS "status", s."code" AS "siteCode", s."name" AS "siteName", u."receivedAt",
         v."currency", v."publicPrice"::text AS "publicPrice", v."sellerNet"::text AS "sellerNet"
  FROM "WarehouseUnit" u
  JOIN "WarehouseItem" i ON i."id" = u."itemId"
  LEFT JOIN "WarehouseSite" s ON s."id" = u."currentSiteId"
  LEFT JOIN "WarehouseUnitPrice" v ON v."unitId" = u."id" AND v."status" = 'VALIDATED'`;

const toPartnerUnit = (r: any): PartnerUnitRow => ({
  ...r,
  shortRef: unitShortRef(r.id),
  statusLabel: STATUS_LABELS[r.status as PartnerUnitStatus],
  receivedAt: new Date(r.receivedAt).toISOString(),
});

export type PartnerUnitFilters = {
  search?: string;
  status?: PartnerUnitStatus;
  itemId?: string;
  includeOut?: boolean;
};

function partnerFilters(partnerId: string, f: PartnerUnitFilters): Prisma.Sql[] {
  const where: Prisma.Sql[] = [owned(partnerId)];
  if (f.status) where.push(Prisma.sql`${STATUS_SQL} = ${f.status}`);
  else if (!f.includeOut) where.push(Prisma.sql`u."presence" <> 'OUT'`);
  if (f.itemId) where.push(Prisma.sql`u."itemId" = ${f.itemId}`);
  const q = String(f.search ?? "").trim();
  if (q) {
    const scan = classifyScan(q);
    const hex = q.toLowerCase().replace(/[^0-9a-f]/g, "");
    if (scan.kind === "GTIN") {
      where.push(Prisma.sql`u."itemId" IN (SELECT "itemId" FROM "WarehouseItemAlias" WHERE "namespace" = 'GTIN' AND "value" = ${scan.gtin})`);
    } else if (/^[0-9a-fA-F]{4}-?[0-9a-fA-F]{4}$/.test(q)) {
      where.push(Prisma.sql`u."id" LIKE ${`${hex}%`}`);
    } else {
      for (const t of q.toLowerCase().replace(/[%_\\]/g, "").split(/\s+/).filter(Boolean).slice(0, 6)) {
        where.push(Prisma.sql`i."searchText" LIKE ${`%${t}%`}`);
      }
    }
  }
  return where;
}

export async function listPartnerUnits(
  conn: WarehouseConn,
  partnerId: string,
  input: PartnerUnitFilters & { limit?: number; cursor?: string | null }
): Promise<{ items: PartnerUnitRow[]; nextCursor: string | null }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const where = partnerFilters(partnerId, input);
  if (input.cursor) {
    const [at, id] = input.cursor.split("|");
    const date = new Date(at);
    if (!Number.isNaN(date.getTime()) && id) where.push(Prisma.sql`(u."receivedAt", u."id") < (${date}, ${id})`);
  }
  const rows = await conn.$queryRaw<any[]>(Prisma.sql`
    ${PARTNER_UNIT_SELECT} WHERE ${Prisma.join(where, " AND ")} ORDER BY u."receivedAt" DESC, u."id" DESC LIMIT ${limit + 1}`);
  const page = rows.slice(0, limit);
  const last = page[page.length - 1];
  return {
    items: page.map(toPartnerUnit),
    nextCursor: rows.length > limit && last ? `${new Date(last.receivedAt).toISOString()}|${last.id}` : null,
  };
}

export type PartnerItemGroup = {
  itemId: string;
  itemName: string;
  itemBrand: string | null;
  itemStyleCode: string | null;
  itemSizeLabel: string | null;
  itemImageUrl: string | null;
  quantity: number;
  inControl: number;
  stored: number;
  saleAuthorized: number;
  blocked: number;
  currency: string | null;
  minPublicPrice: string | null;
  maxPublicPrice: string | null;
  minSellerNet: string | null;
  maxSellerNet: string | null;
};

/** "Groupé par modèle et pointure": quantities per variant. */
export async function listPartnerStockByItem(
  conn: WarehouseConn,
  partnerId: string,
  input: PartnerUnitFilters & { limit?: number; offset?: number }
): Promise<{ items: PartnerItemGroup[]; hasMore: boolean }> {
  const limit = Math.min(200, Math.max(1, input.limit ?? 50));
  const offset = Math.max(0, input.offset ?? 0);
  const where = partnerFilters(partnerId, input);
  const rows = await conn.$queryRaw<PartnerItemGroup[]>(Prisma.sql`
    SELECT u."itemId", i."name" AS "itemName", i."brand" AS "itemBrand", i."styleCode" AS "itemStyleCode", i."sizeLabel" AS "itemSizeLabel",
           i."imageUrl" AS "itemImageUrl", count(*)::int AS "quantity",
           count(*) FILTER (WHERE s.st = 'IN_CONTROL')::int AS "inControl",
           count(*) FILTER (WHERE s.st = 'STORED')::int AS "stored",
           count(*) FILTER (WHERE s.st = 'SALE_AUTHORIZED')::int AS "saleAuthorized",
           count(*) FILTER (WHERE s.st IN ('BLOCKED', 'CHECKING'))::int AS "blocked",
           max(v."currency") AS "currency", min(v."publicPrice")::text AS "minPublicPrice", max(v."publicPrice")::text AS "maxPublicPrice",
           min(v."sellerNet")::text AS "minSellerNet", max(v."sellerNet")::text AS "maxSellerNet"
    FROM "WarehouseUnit" u
    JOIN "WarehouseItem" i ON i."id" = u."itemId"
    CROSS JOIN LATERAL (SELECT ${STATUS_SQL} AS st) s
    LEFT JOIN "WarehouseUnitPrice" v ON v."unitId" = u."id" AND v."status" = 'VALIDATED'
    WHERE ${Prisma.join(where, " AND ")}
    GROUP BY u."itemId", i."name", i."brand", i."styleCode", i."sizeLabel", i."imageUrl"
    ORDER BY i."name", i."sizeLabel", u."itemId" LIMIT ${limit + 1} OFFSET ${offset}`);
  return { items: rows.slice(0, limit), hasMore: rows.length > limit };
}

export type PartnerUnitDetail = PartnerUnitRow & {
  conditionNote: null;
  /** Partner-safe milestones only (no address, operator or internal reason). */
  timeline: { at: string; label: string }[];
  requests: { id: string; type: string; status: string; message: string; response: string | null; createdAt: string }[];
};

const TIMELINE_LABELS: Record<string, string> = {
  RECEIVE: "Reçue au dépôt",
  STOCK_TAKE: "Relevée au dépôt",
  PUTAWAY: "Rangée en stock",
  TRANSFER_OUT: "Départ en transfert",
  TRANSFER_IN: "Arrivée sur site",
  OUT: "Sortie du stock",
};

export async function getPartnerUnit(conn: WarehouseConn, partnerId: string, unitId: string): Promise<PartnerUnitDetail> {
  const id = String(unitId ?? "").toLowerCase();
  const rows = /^[0-9a-f-]{36}$/.test(id)
    ? await conn.$queryRaw<any[]>(Prisma.sql`${PARTNER_UNIT_SELECT} WHERE ${owned(partnerId)} AND u."id" = ${id}`)
    : [];
  // Same answer for "not yours" and "does not exist".
  if (!rows[0]) throw notFound("Paire");
  const movements = await conn.$queryRaw<{ type: string; changes: any; createdAt: Date }[]>(Prisma.sql`
    SELECT m."type", m."changes", m."createdAt" FROM "WarehouseMovement" m
    WHERE m."unitId" = ${id} AND m."type" IN ('RECEIVE', 'STOCK_TAKE', 'PUTAWAY', 'TRANSFER_OUT', 'TRANSFER_IN', 'OUT', 'QC', 'SALE_STATE')
    ORDER BY m."seq" DESC LIMIT 50`);
  const timeline: { at: string; label: string }[] = [];
  let putawaySeen = false;
  for (const m of movements) {
    let label: string | null = TIMELINE_LABELS[m.type] ?? null;
    if (m.type === "PUTAWAY") {
      if (putawaySeen) continue; // internal re-shelving is not a partner event
      putawaySeen = true;
    }
    if (m.type === "QC") {
      const to = m.changes?.qcState?.[1];
      label = to === "PASSED" ? "Contrôle validé" : to === "QUARANTINE" ? "Mise en vérification" : null;
    }
    if (m.type === "SALE_STATE") {
      const to = m.changes?.saleState?.[1];
      label = to === "SALE_AUTHORIZED" ? "Autorisée à la vente" : to === "BLOCKED" ? "Vente suspendue" : to === "STORAGE_ONLY" ? "Stockage seul" : null;
    }
    if (label) timeline.push({ at: new Date(m.createdAt).toISOString(), label });
  }
  const requests = await conn.$queryRaw<any[]>(Prisma.sql`
    SELECT "id", "type", "status", "message", "response", "createdAt" FROM "WarehousePartnerRequest"
    WHERE "partnerId" = ${partnerId} AND "unitId" = ${id} ORDER BY "createdAt" DESC LIMIT 20`);
  return {
    ...toPartnerUnit(rows[0]),
    conditionNote: null,
    timeline,
    requests: requests.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() })),
  };
}

const CONDITION_FR: Record<string, string> = { NEW: "Neuf", USED: "Porté", DAMAGED: "Abîmé", UNKNOWN: "À contrôler" };
const BOX_FR: Record<string, string> = { GOOD: "Bonne", DAMAGED: "Abîmée", MISSING: "Sans boîte", UNKNOWN: "À contrôler" };

/**
 * CSV statement of the partner's stock — same predicate and same whitelist as the list, built
 * at request time (no stored file, no shareable link). Cells are formula-safe (C24).
 */
export async function exportPartnerStockCsv(
  conn: WarehouseConn,
  partnerId: string,
  filters: PartnerUnitFilters = {}
): Promise<{ csv: string; rows: number; truncated: boolean }> {
  const MAX = 50_000;
  const out: unknown[][] = [];
  let cursor: string | null = null;
  let truncated = false;
  for (;;) {
    const page: { items: PartnerUnitRow[]; nextCursor: string | null } = await listPartnerUnits(conn, partnerId, { ...filters, limit: 200, cursor });
    for (const u of page.items) {
      out.push([
        u.shortRef,
        u.itemBrand ?? "",
        u.itemName,
        u.itemStyleCode ?? "",
        u.itemSizeLabel ?? "",
        u.itemGtin ?? "",
        CONDITION_FR[u.condition] ?? u.condition,
        BOX_FR[u.boxCondition] ?? u.boxCondition,
        u.statusLabel,
        u.siteCode ?? "",
        u.receivedAt.slice(0, 10),
        u.publicPrice ?? "",
        u.sellerNet ?? "",
        u.currency ?? "",
      ]);
    }
    cursor = page.nextCursor;
    if (!cursor) break;
    if (out.length >= MAX) {
      truncated = true;
      break;
    }
  }
  const csv = toCsv(
    ["Référence", "Marque", "Modèle", "Référence fabricant", "Pointure", "GTIN", "État", "Boîte", "Statut", "Site", "Reçue le", "Prix public", "Net vendeur", "Devise"],
    out
  );
  return { csv, rows: out.length, truncated };
}
