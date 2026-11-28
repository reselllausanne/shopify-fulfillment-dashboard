import { Prisma } from "@prisma/client";
import { staleTaskHours, warehouseFlagsSnapshot } from "./config";
import type { WarehouseConn } from "./db";
import { listBatches, type BatchRow } from "./batches";
import { getSite, type SiteRow } from "./locations";

/**
 * "Vue d'ensemble" for one site: open batches, pairs to put away, blocked tasks, discrepancies
 * and the operational alerts a warehouse worker should not be the only one to see (C44).
 * Every figure is a direct SQL count on the indexed current state (no history replay).
 */

export type OverviewAlert = { level: "warning" | "critical"; code: string; message: string; count: number; href: string };

export type Overview = {
  site: SiteRow;
  flags: ReturnType<typeof warehouseFlagsSnapshot>;
  stock: { present: number; shelved: number; atTemporary: number; quarantine: number; missing: number; inTransit: number; ownerUnknown: number };
  capacity: { levels: number; capacity: number; occupied: number; reserved: number; blockedLevels: number };
  putaway: { active: number; reserved: number; pending: number; blocked: number; stale: number; oldestCreatedAt: string | null };
  exceptions: { open: number; byType: Record<string, number> };
  printing: { queued: number; failed: number; uncertain: number; oldestQueuedAt: string | null };
  labelJournal: { pendingExport: number; oldestPendingAt: string | null };
  partnerRequestsOpen: number;
  openBatches: BatchRow[];
  alerts: OverviewAlert[];
};

export async function getOverview(conn: WarehouseConn, siteIdOrCode: string): Promise<Overview> {
  const site = await getSite(conn, siteIdOrCode);
  const staleHours = staleTaskHours();
  const [stock, capacity, putaway, exceptions, printing, journal, requests, openBatches] = await Promise.all([
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE u."presence" = 'PRESENT')::int AS "present",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" = 'LEVEL')::int AS "shelved",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND l."kind" IN ('RECEIVING', 'CART'))::int AS "atTemporary",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND u."qcState" = 'QUARANTINE')::int AS "quarantine",
             count(*) FILTER (WHERE u."presence" = 'MISSING')::int AS "missing",
             count(*) FILTER (WHERE u."presence" = 'IN_TRANSIT')::int AS "inTransit",
             count(*) FILTER (WHERE u."presence" = 'PRESENT' AND u."ownerKind" = 'UNKNOWN')::int AS "ownerUnknown"
      FROM "WarehouseUnit" u LEFT JOIN "WarehouseLocation" l ON l."id" = u."currentLocationId"
      WHERE u."currentSiteId" = ${site.id} AND u."presence" IN ('PRESENT', 'MISSING', 'IN_TRANSIT')`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*)::int AS "levels", coalesce(sum("capacity"), 0)::int AS "capacity", coalesce(sum("occupiedCount"), 0)::int AS "occupied",
             coalesce(sum("reservedCount"), 0)::int AS "reserved", count(*) FILTER (WHERE "status" = 'BLOCKED')::int AS "blockedLevels"
      FROM "WarehouseLocation" WHERE "siteId" = ${site.id} AND "kind" = 'LEVEL' AND "status" <> 'RETIRED'`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*)::int AS "active",
             count(*) FILTER (WHERE "status" = 'RESERVED')::int AS "reserved",
             count(*) FILTER (WHERE "status" = 'PENDING')::int AS "pending",
             count(*) FILTER (WHERE "status" = 'PENDING' AND "holdReason" IS NOT NULL)::int AS "blocked",
             count(*) FILTER (WHERE "createdAt" < now() - make_interval(hours => ${staleHours}::int))::int AS "stale",
             min("createdAt") AS "oldestCreatedAt"
      FROM "WarehousePutawayTask" WHERE "siteId" = ${site.id} AND "status" IN ('PENDING', 'RESERVED')`),
    conn.$queryRaw<{ type: string; n: number }[]>(Prisma.sql`
      SELECT "type", count(*)::int AS n FROM "WarehouseException"
      WHERE "status" = 'OPEN' AND ("siteId" = ${site.id} OR "siteId" IS NULL) GROUP BY "type"`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*) FILTER (WHERE "status" = 'QUEUED')::int AS "queued",
             count(*) FILTER (WHERE "status" = 'FAILED')::int AS "failed",
             count(*) FILTER (WHERE "status" = 'UNCERTAIN')::int AS "uncertain",
             min("createdAt") FILTER (WHERE "status" = 'QUEUED') AS "oldestQueuedAt"
      FROM "WarehousePrintJob" WHERE "siteId" = ${site.id} AND "status" IN ('QUEUED', 'FAILED', 'UNCERTAIN')`),
    conn.$queryRaw<any[]>(Prisma.sql`
      SELECT count(*)::int AS "pendingExport", min("issuedAt") AS "oldestPendingAt" FROM "WarehouseLabelJournal" WHERE "exportedAt" IS NULL`),
    conn.$queryRaw<{ n: number }[]>(Prisma.sql`SELECT count(*)::int AS n FROM "WarehousePartnerRequest" WHERE "status" = 'OPEN'`),
    listBatches(conn, { siteId: site.id, status: ["OPEN", "PAUSED"], limit: 20 }),
  ]);

  const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);
  const p = putaway[0];
  const pr = printing[0];
  const j = journal[0];
  const byType = Object.fromEntries(exceptions.map((e) => [e.type, e.n]));
  const openExceptions = exceptions.reduce((n, e) => n + e.n, 0);
  const flags = warehouseFlagsSnapshot();

  const alerts: OverviewAlert[] = [];
  if (!flags.writesEnabled) {
    alerts.push({ level: "critical", code: "WRITES_DISABLED", message: "Écritures du module arrêtées : consultation seule.", count: 1, href: "/warehouse" });
  }
  if (pr.uncertain > 0) {
    alerts.push({ level: "critical", code: "PRINT_UNCERTAIN", message: "Impressions à l'issue incertaine : vérifier le papier avant toute réimpression.", count: pr.uncertain, href: "/warehouse/stations" });
  }
  if (pr.failed > 0) {
    alerts.push({ level: "warning", code: "PRINT_FAILED", message: "Impressions en échec à relancer ou rediriger.", count: pr.failed, href: "/warehouse/stations" });
  }
  if (pr.oldestQueuedAt && Date.now() - new Date(pr.oldestQueuedAt).getTime() > 10 * 60_000) {
    alerts.push({ level: "warning", code: "PRINT_QUEUE_STUCK", message: "Étiquettes en attente depuis plus de 10 min : le poste d'impression est-il ouvert ?", count: pr.queued, href: "/warehouse/stations" });
  }
  if (p.blocked > 0) {
    alerts.push({ level: "warning", code: "PUTAWAY_BLOCKED", message: "Rangements sans place proposée (niveau plein, bloqué ou plus de capacité).", count: p.blocked, href: "/warehouse/putaway" });
  }
  if (p.stale > 0) {
    alerts.push({ level: "warning", code: "PUTAWAY_STALE", message: `Paires en attente de rangement depuis plus de ${staleHours} h.`, count: p.stale, href: "/warehouse/putaway" });
  }
  if (capacity[0].blockedLevels > 0) {
    alerts.push({ level: "warning", code: "LEVELS_BLOCKED", message: "Niveaux bloqués : capacité à revoir.", count: capacity[0].blockedLevels, href: "/warehouse/locations" });
  }
  if (stock[0].ownerUnknown > 0) {
    alerts.push({ level: "warning", code: "OWNER_UNKNOWN", message: "Paires au propriétaire à confirmer (bloquées à la vente).", count: stock[0].ownerUnknown, href: "/warehouse/exceptions" });
  }
  if (stock[0].missing > 0) {
    alerts.push({ level: "warning", code: "UNITS_MISSING", message: "Paires déclarées introuvables.", count: stock[0].missing, href: "/warehouse/stock?presence=MISSING" });
  }
  if (flags.labelJournalDir && j.oldestPendingAt && Date.now() - new Date(j.oldestPendingAt).getTime() > 15 * 60_000) {
    alerts.push({ level: "critical", code: "JOURNAL_LAG", message: "Journal d'émission des QR non exporté depuis plus de 15 min.", count: j.pendingExport, href: "/warehouse/stations" });
  }
  if (!flags.labelJournalDir && j.pendingExport > 0) {
    alerts.push({ level: "warning", code: "JOURNAL_NO_SINK", message: "Journal d'émission des QR sans support indépendant configuré (WAREHOUSE_LABEL_JOURNAL_DIR).", count: j.pendingExport, href: "/warehouse/stations" });
  }

  return {
    site,
    flags,
    stock: stock[0],
    capacity: capacity[0],
    putaway: { active: p.active, reserved: p.reserved, pending: p.pending, blocked: p.blocked, stale: p.stale, oldestCreatedAt: iso(p.oldestCreatedAt) },
    exceptions: { open: openExceptions, byType },
    printing: { queued: pr.queued, failed: pr.failed, uncertain: pr.uncertain, oldestQueuedAt: iso(pr.oldestQueuedAt) },
    labelJournal: { pendingExport: j.pendingExport, oldestPendingAt: iso(j.oldestPendingAt) },
    partnerRequestsOpen: requests[0].n,
    openBatches,
    alerts,
  };
}

export type ReconcileRow = { siteCode: string | null; ownerKind: string; ownerName: string | null; presence: string; qcState: string; saleState: string; units: number };

/**
 * C42: stock rebuilt from the source of truth (unit rows), by site, owner and state. Compare
 * with any aggregated table or export; identities are never touched by a reconciliation.
 */
export async function getStockReconciliation(conn: WarehouseConn, siteId?: string): Promise<{ rows: ReconcileRow[]; totalUnits: number; distinctIds: number }> {
  const rows = await conn.$queryRaw<ReconcileRow[]>(Prisma.sql`
    SELECT s."code" AS "siteCode", u."ownerKind", p."name" AS "ownerName", u."presence", u."qcState", u."saleState", count(*)::int AS "units"
    FROM "WarehouseUnit" u
    LEFT JOIN "WarehouseSite" s ON s."id" = u."currentSiteId"
    LEFT JOIN "Partner" p ON p."id" = u."ownerPartnerId"
    ${siteId ? Prisma.sql`WHERE u."currentSiteId" = ${siteId}` : Prisma.empty}
    GROUP BY s."code", u."ownerKind", p."name", u."presence", u."qcState", u."saleState"
    ORDER BY s."code", u."ownerKind", p."name", u."presence", u."qcState", u."saleState"`);
  const totals = await conn.$queryRaw<{ total: number; ids: number }[]>(Prisma.sql`
    SELECT count(*)::int AS "total", count(DISTINCT "id")::int AS "ids" FROM "WarehouseUnit"
    ${siteId ? Prisma.sql`WHERE "currentSiteId" = ${siteId}` : Prisma.empty}`);
  return { rows, totalUnits: totals[0].total, distinctIds: totals[0].ids };
}
