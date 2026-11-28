import { Prisma } from "@prisma/client";
import * as batches from "../batches";
import { toCsv } from "../codes";
import { isWarehouseWritesEnabled, warehouseFlagsSnapshot } from "../config";
import { WarehouseError, invalid } from "../errors";
import * as exceptions from "../exceptions";
import * as imports from "../imports";
import * as items from "../items";
import * as journal from "../journal";
import { LABEL_PROFILES, renderLabelSvg, renderLabelsPdf, type LabelPayload } from "../labels";
import * as locations from "../locations";
import { getOperationResult } from "../operations";
import * as operators from "../operators";
import { getOverview, getStockReconciliation } from "../overview";
import * as pricing from "../pricing";
import * as printing from "../printing";
import * as putaway from "../putaway";
import * as transfers from "../transfers";
import * as units from "../units";
import {
  bool,
  compileRoutes,
  fileResponse,
  int,
  list,
  reqInt,
  reqStr,
  resetOperatorCache,
  signOperatorToken,
  str,
  type StaffCall,
  type StaffRoute,
} from "./http";

/**
 * Staff API of the warehouse module — one table, one line per route.
 * Paths are relative to `/api/warehouse`. See docs/warehouse/CONTRACTS.md.
 *
 *  admin    : configuration and sensitive corrections (role admin only)
 *  operator : physical gesture; needs a named operator once operators exist
 *  station  : called by the print agent with the station credential
 */

const stationIdOf = (c: StaffCall): string | null => c.station?.id ?? str(c.body.stationId) ?? null;

const labelFile = (payloads: { payload: LabelPayload; widthMm: number; heightMm: number }[], format: string | undefined, name: string) => {
  if (payloads.length === 0) throw invalid("Aucune étiquette à produire.");
  if (format === "svg") {
    const l = payloads[0];
    return fileResponse(renderLabelSvg(l.payload, l.widthMm, l.heightMm), "image/svg+xml");
  }
  const pdf = renderLabelsPdf(payloads);
  const res = fileResponse(pdf, "application/pdf");
  res.headers.set("Content-Disposition", `inline; filename="${name}.pdf"`);
  return res;
};

async function listWarehousePartners(c: StaffCall) {
  return c.db.$queryRaw<any[]>(Prisma.sql`
    SELECT p."id", p."key", p."name", p."active",
           coalesce(u."held", 0)::int AS "unitsHeld",
           coalesce(u."saleAuthorized", 0)::int AS "unitsSaleAuthorized",
           coalesce(u."priced", 0)::int AS "unitsPriced",
           coalesce(u."proposed", 0)::int AS "pricesToValidate",
           coalesce(r."open", 0)::int AS "openRequests",
           a."id" AS "agreementId", a."version" AS "agreementVersion", a."saleAllowed", a."pricingMode", a."pricingFactor",
           a."pricingBasisIs", a."commissionRate", a."fixedFee", a."currency", a."channels"
    FROM "Partner" p
    LEFT JOIN LATERAL (
      SELECT count(*) FILTER (WHERE wu."presence" <> 'OUT') AS "held",
             count(*) FILTER (WHERE wu."presence" <> 'OUT' AND wu."saleState" = 'SALE_AUTHORIZED') AS "saleAuthorized",
             count(*) FILTER (WHERE wu."presence" <> 'OUT' AND EXISTS (
               SELECT 1 FROM "WarehouseUnitPrice" pr WHERE pr."unitId" = wu."id" AND pr."status" = 'VALIDATED')) AS "priced",
             count(*) FILTER (WHERE wu."presence" <> 'OUT' AND EXISTS (
               SELECT 1 FROM "WarehouseUnitPrice" pr WHERE pr."unitId" = wu."id" AND pr."status" = 'PROPOSED')) AS "proposed"
      FROM "WarehouseUnit" wu WHERE wu."ownerPartnerId" = p."id" AND wu."ownerKind" = 'PARTNER'
    ) u ON true
    LEFT JOIN LATERAL (
      SELECT count(*) AS "open" FROM "WarehousePartnerRequest" pr WHERE pr."partnerId" = p."id" AND pr."status" = 'OPEN'
    ) r ON true
    LEFT JOIN "WarehouseDepositAgreement" a ON a."partnerId" = p."id" AND a."status" = 'ACTIVE'
    ORDER BY coalesce(u."held", 0) DESC, p."name"`);
}

const routes: StaffRoute[] = [
  // ---- context ----
  {
    method: "GET",
    path: "config",
    handler: async (c) => ({
      role: c.role,
      flags: warehouseFlagsSnapshot(),
      sites: await locations.listSites(c.db),
      operators: await operators.listOperators(c.db, { activeOnly: true }),
      operatorId: c.ctx.operatorId ?? null,
      station: c.station,
      labelProfiles: LABEL_PROFILES,
    }),
  },
  {
    method: "GET",
    path: "overview",
    handler: async (c) => {
      // C10: a claimed job whose station went silent must surface even when no print agent is open.
      await sweepStalePrints(c.db);
      return getOverview(c.db, reqStr(c.query.get("site"), "Site"));
    },
  },
  { method: "GET", path: "reconciliation", handler: (c) => getStockReconciliation(c.db, str(c.query.get("siteId"))) },
  { method: "GET", path: "operations/:opKey", handler: (c) => getOperationResult(c.db, c.params.opKey) },
  { method: "GET", path: "scan", handler: (c) => units.resolveScan(c.db, c.query.get("code") ?? "") },

  // ---- sites ----
  { method: "GET", path: "sites", handler: (c) => locations.listSites(c.db, { includeRetired: bool(c.query.get("all")) }) },
  {
    method: "POST",
    path: "sites",
    admin: true,
    handler: (c) =>
      locations.createSite(c.db, {
        code: reqStr(c.body.code, "Code du site"),
        name: reqStr(c.body.name, "Nom du site"),
        countryCode: reqStr(c.body.countryCode, "Pays"),
        timezone: str(c.body.timezone),
        isTest: bool(c.body.isTest),
      }),
  },
  { method: "POST", path: "sites/:id/status", admin: true, handler: (c) => locations.setSiteStatus(c.db, c.params.id, c.body.status === "RETIRED" ? "RETIRED" : "ACTIVE") },

  // ---- locations ----
  {
    method: "GET",
    path: "locations",
    handler: (c) =>
      locations.listLocations(c.db, {
        siteId: reqStr(c.query.get("siteId"), "Site"),
        kinds: list(c.query.get("kinds")) as any,
        holdsUnits: c.query.has("holdsUnits") ? bool(c.query.get("holdsUnits")) : undefined,
        status: str(c.query.get("status")) as any,
        sector: str(c.query.get("sector")),
        rowNo: int(c.query.get("rowNo")),
        rackNo: int(c.query.get("rackNo")),
        search: str(c.query.get("search")),
        onlyFree: bool(c.query.get("onlyFree")),
        limit: int(c.query.get("limit")),
        cursor: str(c.query.get("cursor")) ?? null,
      }),
  },
  { method: "GET", path: "locations/structure", handler: (c) => locations.getSiteStructure(c.db, reqStr(c.query.get("siteId"), "Site")) },
  {
    method: "GET",
    path: "locations/labels",
    handler: async (c) => {
      const ids = list(c.query.get("ids")) ?? [];
      if (ids.length > 500) throw invalid("500 étiquettes au maximum par fichier.");
      const payloads = [];
      for (const id of ids) {
        const { siteId: _siteId, ...payload } = await printing.buildLocationLabelPayload(c.db, id);
        payloads.push({ payload: payload as LabelPayload, widthMm: LABEL_PROFILES.LOCATION.widthMm, heightMm: LABEL_PROFILES.LOCATION.heightMm });
      }
      return labelFile(payloads, str(c.query.get("format")), "etiquettes-emplacements");
    },
  },
  {
    method: "GET",
    path: "locations/:id",
    handler: async (c) => {
      const location = await locations.getLocation(c.db, c.params.id);
      const inside = await units.listUnits(c.db, { locationId: location.id, presence: "PRESENT", limit: 200 });
      return { location, units: inside.items, hasMore: Boolean(inside.nextCursor) };
    },
  },
  {
    method: "POST",
    path: "locations/generate",
    admin: true,
    handler: (c) =>
      locations.generateRacks(c.db, {
        siteId: reqStr(c.body.siteId, "Site"),
        sector: reqStr(c.body.sector, "Secteur"),
        rowFrom: reqInt(c.body.rowFrom, "Première rangée"),
        rowTo: reqInt(c.body.rowTo, "Dernière rangée"),
        racksPerRow: reqInt(c.body.racksPerRow, "Racks par rangée"),
        levelsPerRack: reqInt(c.body.levelsPerRack, "Niveaux par rack"),
        capacityPerLevel: reqInt(c.body.capacityPerLevel, "Capacité par niveau"),
        sizeProfile: str(c.body.sizeProfile),
        serpentine: c.body.serpentine === undefined ? undefined : bool(c.body.serpentine),
        sectorIndex: int(c.body.sectorIndex),
      }),
  },
  {
    method: "POST",
    path: "locations/level",
    admin: true,
    handler: (c) =>
      locations.createLevel(c.db, {
        siteId: reqStr(c.body.siteId, "Site"),
        sector: reqStr(c.body.sector, "Secteur"),
        rowNo: reqInt(c.body.rowNo, "Rangée"),
        rackNo: reqInt(c.body.rackNo, "Rack"),
        levelNo: reqInt(c.body.levelNo, "Niveau"),
        capacity: reqInt(c.body.capacity, "Capacité"),
        sizeProfile: str(c.body.sizeProfile),
      }),
  },
  {
    method: "POST",
    path: "locations/special",
    admin: true,
    handler: (c) =>
      locations.createSpecialLocation(c.db, {
        siteId: reqStr(c.body.siteId, "Site"),
        kind: reqStr(c.body.kind, "Type") as any,
        number: int(c.body.number),
        capacity: c.body.capacity === null ? null : int(c.body.capacity),
        label: str(c.body.label),
      }),
  },
  { method: "POST", path: "locations/reconcile", admin: true, handler: (c) => locations.reconcileLocationCounters(c.db, { siteId: reqStr(c.body.siteId, "Site"), fix: bool(c.body.fix) }) },
  {
    method: "POST",
    path: "locations/print-labels",
    handler: (c) =>
      printing.enqueueLocationLabels(c.db, { opKey: reqStr(c.body.opKey, "opKey"), stationId: stationIdOf(c), locationIds: list(c.body.locationIds) ?? [] }, c.ctx),
  },
  {
    method: "PATCH",
    path: "locations/:id",
    admin: true,
    handler: (c) =>
      locations.updateLocation(c.db, c.params.id, {
        capacity: c.body.capacity === null ? null : int(c.body.capacity),
        sizeProfile: str(c.body.sizeProfile),
        walkSequence: int(c.body.walkSequence),
        shortCode: str(c.body.shortCode),
      }),
  },
  {
    method: "POST",
    path: "locations/:id/rename",
    admin: true,
    handler: (c) => locations.renameLocation(c.db, c.params.id, { newCode: reqStr(c.body.newCode, "Nouveau code"), newShortCode: str(c.body.newShortCode) }),
  },
  {
    method: "POST",
    path: "locations/:id/status",
    operator: true,
    handler: (c) => locations.setLocationStatus(c.db, c.params.id, { status: reqStr(c.body.status, "Statut") as any, reason: str(c.body.reason) }, c.ctx),
  },

  // ---- catalog / items ----
  { method: "GET", path: "items/search", handler: (c) => items.searchItems(c.db, c.query.get("q") ?? "", int(c.query.get("limit")) ?? 25) },
  { method: "GET", path: "items/catalog", handler: (c) => items.searchCatalog(c.db, c.query.get("q") ?? "", int(c.query.get("limit")) ?? 40) },
  { method: "GET", path: "items/gtin", handler: (c) => items.resolveGtin(c.db, c.query.get("gtin") ?? "") },
  { method: "GET", path: "items/:id", handler: (c) => items.getItem(c.db, c.params.id) },
  {
    method: "POST",
    path: "items",
    operator: true,
    handler: (c) =>
      items.createItem(c.db, {
        gtin: str(c.body.gtin) ?? null,
        brand: str(c.body.brand) ?? null,
        name: reqStr(c.body.name, "Nom du modèle"),
        styleCode: str(c.body.styleCode) ?? null,
        colorway: str(c.body.colorway) ?? null,
        sizeSystem: str(c.body.sizeSystem) ?? null,
        sizeLabel: str(c.body.sizeLabel) ?? null,
        sizeEu: str(c.body.sizeEu) ?? null,
        sizeUs: str(c.body.sizeUs) ?? null,
        imageUrl: str(c.body.imageUrl) ?? null,
        catalogSource: "MANUAL",
        provisional: bool(c.body.provisional),
      }),
  },
  {
    method: "POST",
    path: "items/from-candidate",
    operator: true,
    handler: (c) => {
      if (!c.body.candidate || typeof c.body.candidate !== "object") throw invalid("Candidat catalogue requis.");
      return items.createItemFromCandidate(c.db, c.body.candidate);
    },
  },
  {
    // A10: a provisional article (box without usable GTIN) is confirmed once identified for certain.
    method: "POST",
    path: "items/:id/confirm",
    admin: true,
    handler: (c) =>
      items.confirmItem(
        c.db,
        {
          opKey: reqStr(c.body.opKey, "opKey"),
          itemId: c.params.id,
          gtin: str(c.body.gtin) ?? null,
          brand: str(c.body.brand) ?? null,
          name: str(c.body.name) ?? null,
          styleCode: str(c.body.styleCode) ?? null,
          colorway: str(c.body.colorway) ?? null,
          sizeLabel: str(c.body.sizeLabel) ?? null,
          sizeEu: str(c.body.sizeEu) ?? null,
          sizeUs: str(c.body.sizeUs) ?? null,
          note: reqStr(c.body.note, "Preuve d'identification"),
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "items/:id/alias",
    admin: true,
    handler: (c) => items.addItemAlias(c.db, { itemId: c.params.id, namespace: reqStr(c.body.namespace, "Type d'alias"), value: reqStr(c.body.value, "Valeur") }),
  },

  // ---- units ----
  {
    method: "GET",
    path: "units",
    handler: (c) => {
      const input: units.ListUnitsInput = {
        siteId: str(c.query.get("siteId")),
        ownerKind: str(c.query.get("ownerKind")) as any,
        ownerPartnerId: str(c.query.get("ownerPartnerId")),
        presence: (list(c.query.get("presence")) as any) ?? undefined,
        qcState: str(c.query.get("qcState")) as any,
        saleState: str(c.query.get("saleState")) as any,
        itemId: str(c.query.get("itemId")),
        locationId: str(c.query.get("locationId")),
        batchId: str(c.query.get("batchId")),
        search: str(c.query.get("search")),
        limit: int(c.query.get("limit")),
        cursor: str(c.query.get("cursor")) ?? null,
      };
      return c.query.get("group") === "item"
        ? units.aggregateUnitsByItem(c.db, { ...input, offset: int(c.query.get("offset")) })
        : units.listUnits(c.db, input);
    },
  },
  {
    method: "GET",
    path: "units/export",
    handler: async (c) => {
      const rows: unknown[][] = [];
      let cursor: string | null = null;
      for (let page = 0; page < 100; page += 1) {
        const res: Awaited<ReturnType<typeof units.listUnits>> = await units.listUnits(c.db, {
          siteId: str(c.query.get("siteId")),
          ownerKind: str(c.query.get("ownerKind")) as any,
          ownerPartnerId: str(c.query.get("ownerPartnerId")),
          presence: (list(c.query.get("presence")) as any) ?? undefined,
          search: str(c.query.get("search")),
          limit: 200,
          cursor,
        });
        for (const u of res.items) {
          rows.push([u.labelCode, u.shortRef, u.itemGtin ?? "", u.itemBrand ?? "", u.itemName ?? "", u.itemStyleCode ?? "", u.itemSizeLabel ?? "", u.ownerKind, u.ownerName ?? "", u.currentSiteCode ?? "", u.currentLocationCode ?? "", u.presence, u.qcState, u.saleState, u.condition, u.receivedAt]);
        }
        cursor = res.nextCursor;
        if (!cursor) break;
      }
      const csv = toCsv(["code_etiquette", "ref_courte", "gtin", "marque", "modele", "ref_modele", "pointure", "proprietaire", "partenaire", "site", "emplacement", "presence", "controle", "vente", "etat", "recu_le"], rows);
      return fileResponse(csv, "text/csv; charset=utf-8", "stock-entrepot.csv");
    },
  },
  { method: "GET", path: "units/:id", handler: (c) => units.getUnitDetail(c.db, c.params.id) },
  {
    method: "GET",
    path: "units/:id/label",
    handler: async (c) => {
      const payload = await printing.buildPairLabelPayload(c.db, c.params.id, bool(c.query.get("reprint")));
      // The fallback PDF follows the same rule as the station queue (C01).
      await journal.assertLabelProtected(c.db, payload.code);
      return labelFile([{ payload, widthMm: LABEL_PROFILES.PAIR.widthMm, heightMm: LABEL_PROFILES.PAIR.heightMm }], str(c.query.get("format")), `etiquette-${payload.code.slice(0, 8)}`);
    },
  },
  {
    method: "POST",
    path: "units/:id/:action",
    operator: true,
    handler: async (c) => {
      const base = {
        opKey: reqStr(c.body.opKey, "opKey"),
        unitId: c.params.id,
        expectedVersion: int(c.body.expectedVersion) ?? null,
        reason: str(c.body.reason) ?? null,
        note: str(c.body.note) ?? null,
      };
      switch (c.params.action) {
        case "qc":
          return units.setUnitQcState(c.db, { ...base, qcState: reqStr(c.body.qcState, "État de contrôle") as any }, c.ctx);
        case "sale":
          return units.setUnitSaleState(c.db, { ...base, saleState: reqStr(c.body.saleState, "Droit de vente") as any }, c.ctx);
        case "condition":
          return units.setUnitCondition(
            c.db,
            { ...base, condition: str(c.body.condition) as any, boxCondition: str(c.body.boxCondition) as any, boxProfile: str(c.body.boxProfile) ?? null, conditionNote: str(c.body.conditionNote) ?? null },
            c.ctx
          );
        case "owner":
          return units.changeUnitOwner(c.db, { ...base, ownerKind: reqStr(c.body.ownerKind, "Propriétaire") as any, ownerPartnerId: str(c.body.ownerPartnerId) ?? null }, c.ctx);
        case "item":
          return units.correctUnitItem(c.db, { ...base, itemId: reqStr(c.body.itemId, "Variante") }, c.ctx);
        case "missing":
          return units.markUnitMissing(c.db, base, c.ctx);
        case "out":
          return units.markUnitOut(c.db, { ...base, outReason: reqStr(c.body.outReason, "Motif de sortie") as any }, c.ctx);
        case "relocate":
          return putaway.relocateUnit(
            c.db,
            { ...base, toLocationId: reqStr(c.body.toLocationId, "Destination"), force: bool(c.body.force), acceptProfileMismatch: bool(c.body.acceptProfileMismatch) },
            c.ctx
          );
        case "duplicate-label":
          return units.reportDuplicateLabel(c.db, { ...base, seenAtLocationId: str(c.body.seenAtLocationId) ?? null }, c.ctx);
        case "reprint":
          return printing.reprintUnitLabel(c.db, { opKey: base.opKey, unitId: base.unitId, stationId: stationIdOf(c), reason: reqStr(c.body.reason, "Motif de réimpression") }, c.ctx);
        case "confirm-label":
          return printing.confirmUnitLabelScan(c.db, { opKey: base.opKey, unitId: base.unitId }, c.ctx);
        case "external-ref":
          return units.addUnitExternalRef(c.db, { unitId: base.unitId, namespace: reqStr(c.body.namespace, "Type de référence"), value: reqStr(c.body.value, "Valeur"), note: base.note });
        default:
          throw new WarehouseError("NOT_FOUND", "Geste inconnu.", 404);
      }
    },
  },

  // ---- batches: receiving and stock-take ----
  {
    method: "GET",
    path: "batches",
    handler: (c) =>
      batches.listBatches(c.db, {
        siteId: str(c.query.get("siteId")),
        status: list(c.query.get("status")) as any,
        kind: str(c.query.get("kind")) as any,
        ownerPartnerId: str(c.query.get("ownerPartnerId")),
        limit: int(c.query.get("limit")),
      }),
  },
  {
    method: "POST",
    path: "batches",
    operator: true,
    handler: (c) =>
      batches.createBatch(
        c.db,
        {
          siteId: reqStr(c.body.siteId, "Site"),
          kind: reqStr(c.body.kind, "Type de lot") as any,
          flow: reqStr(c.body.flow, "Flux") as any,
          title: str(c.body.title) ?? null,
          ownerKind: reqStr(c.body.ownerKind, "Propriétaire") as any,
          ownerPartnerId: str(c.body.ownerPartnerId) ?? null,
          supplierName: str(c.body.supplierName) ?? null,
          sourceDocType: str(c.body.sourceDocType) ?? null,
          sourceDocRef: str(c.body.sourceDocRef) ?? null,
          receivingLocationId: str(c.body.receivingLocationId) ?? null,
          countedAt: str(c.body.countedAt) ?? null,
          notes: str(c.body.notes) ?? null,
        },
        c.ctx
      ),
  },
  { method: "GET", path: "batches/:id", handler: (c) => batches.getBatchDetail(c.db, c.params.id) },
  {
    method: "POST",
    path: "batches/:id/lines",
    operator: true,
    handler: (c) => {
      if (!Array.isArray(c.body.lines) || c.body.lines.length === 0) throw invalid("Lignes requises.");
      return batches.addBatchLines(
        c.db,
        c.params.id,
        c.body.lines.slice(0, 2000).map((l: any) => ({
          gtin: str(l?.gtin) ?? null,
          itemId: str(l?.itemId) ?? null,
          description: str(l?.description) ?? null,
          sizeLabel: str(l?.sizeLabel) ?? null,
          expectedQty: int(l?.expectedQty) ?? null,
          externalRef: str(l?.externalRef) ?? null,
        }))
      );
    },
  },
  { method: "POST", path: "batches/:id/status", operator: true, handler: (c) => batches.setBatchStatus(c.db, { batchId: c.params.id, action: reqStr(c.body.action, "Action") as any }) },
  { method: "POST", path: "batches/:id/close", operator: true, handler: (c) => batches.closeBatch(c.db, { batchId: c.params.id, reason: str(c.body.reason) ?? null }, c.ctx) },
  {
    method: "POST",
    path: "batches/:id/receive",
    operator: true,
    handler: (c) =>
      afterIssue(
        c,
        batches.receiveUnit(
          c.db,
          {
            opKey: reqStr(c.body.opKey, "opKey"),
            batchId: c.params.id,
            itemId: reqStr(c.body.itemId, "Variante"),
            lineId: str(c.body.lineId) ?? null,
            locationId: str(c.body.locationId) ?? null,
            condition: str(c.body.condition) as any,
            boxCondition: str(c.body.boxCondition) as any,
            conditionNote: str(c.body.conditionNote) ?? null,
            boxProfile: str(c.body.boxProfile) ?? null,
            hold: bool(c.body.hold),
            print: c.body.print === undefined ? true : bool(c.body.print),
          },
          c.ctx
        )
      ),
  },
  {
    method: "POST",
    path: "batches/:id/sessions",
    operator: true,
    handler: (c) => batches.openCountSession(c.db, { batchId: c.params.id, locationId: reqStr(c.body.locationId, "Niveau"), takeOver: bool(c.body.takeOver) }, c.ctx),
  },
  { method: "GET", path: "sessions/:id", handler: (c) => batches.getCountSession(c.db, c.params.id) },
  {
    method: "POST",
    path: "sessions/:id/create-unit",
    operator: true,
    handler: (c) =>
      afterIssue(
        c,
        batches.stockTakeCreateUnit(
          c.db,
          {
            opKey: reqStr(c.body.opKey, "opKey"),
            sessionId: c.params.id,
            itemId: reqStr(c.body.itemId, "Variante"),
            condition: str(c.body.condition) as any,
            boxCondition: str(c.body.boxCondition) as any,
            conditionNote: str(c.body.conditionNote) ?? null,
            boxProfile: str(c.body.boxProfile) ?? null,
            ownerUncertain: bool(c.body.ownerUncertain),
            print: c.body.print === undefined ? true : bool(c.body.print),
          },
          c.ctx
        )
      ),
  },
  {
    method: "POST",
    path: "sessions/:id/scan-unit",
    operator: true,
    handler: (c) =>
      batches.stockTakeScanUnit(
        c.db,
        { opKey: reqStr(c.body.opKey, "opKey"), sessionId: c.params.id, unitId: reqStr(c.body.unitId, "Paire"), confirmMove: bool(c.body.confirmMove), acknowledgeOwner: bool(c.body.acknowledgeOwner) },
        c.ctx
      ),
  },
  { method: "POST", path: "sessions/:id/close", operator: true, handler: (c) => batches.closeCountSession(c.db, { sessionId: c.params.id }, c.ctx) },

  // ---- putaway ----
  {
    method: "GET",
    path: "putaway",
    handler: (c) =>
      putaway.listPutawayQueue(c.db, {
        siteId: reqStr(c.query.get("siteId"), "Site"),
        batchId: str(c.query.get("batchId")) ?? null,
        cartLocationId: str(c.query.get("cartLocationId")) ?? null,
        fromLocationId: str(c.query.get("fromLocationId")) ?? null,
        limit: int(c.query.get("limit")),
      }),
  },
  {
    method: "POST",
    path: "putaway/propose",
    operator: true,
    handler: (c) =>
      putaway.proposeDestinations(
        c.db,
        {
          siteId: reqStr(c.body.siteId, "Site"),
          batchId: str(c.body.batchId) ?? null,
          cartLocationId: str(c.body.cartLocationId) ?? null,
          fromLocationId: str(c.body.fromLocationId) ?? null,
          unitIds: list(c.body.unitIds),
          sizeProfile: str(c.body.sizeProfile),
          limit: int(c.body.limit),
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "putaway/confirm",
    operator: true,
    handler: (c) =>
      putaway.confirmPutaway(
        c.db,
        {
          opKey: reqStr(c.body.opKey, "opKey"),
          unitId: reqStr(c.body.unitId, "Paire"),
          locationId: reqStr(c.body.locationId, "Niveau"),
          acceptMismatch: bool(c.body.acceptMismatch),
          acceptProfileMismatch: bool(c.body.acceptProfileMismatch),
          expectedVersion: int(c.body.expectedVersion) ?? null,
          note: str(c.body.note) ?? null,
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "putaway/reassign",
    operator: true,
    handler: (c) =>
      putaway.reassignPutaway(c.db, { opKey: reqStr(c.body.opKey, "opKey"), unitId: reqStr(c.body.unitId, "Paire"), reason: reqStr(c.body.reason, "Motif"), sizeProfile: str(c.body.sizeProfile) }, c.ctx),
  },
  {
    method: "POST",
    path: "putaway/cancel",
    operator: true,
    handler: (c) => putaway.cancelPutawayTask(c.db, { opKey: reqStr(c.body.opKey, "opKey"), unitId: reqStr(c.body.unitId, "Paire"), reason: reqStr(c.body.reason, "Motif") }, c.ctx),
  },
  {
    method: "POST",
    path: "putaway/level-full",
    operator: true,
    handler: (c) => putaway.reportLevelFull(c.db, { opKey: reqStr(c.body.opKey, "opKey"), locationId: reqStr(c.body.locationId, "Niveau"), note: str(c.body.note) ?? null }, c.ctx),
  },
  { method: "POST", path: "putaway/expire", handler: (c) => putaway.expireReservations(c.db, str(c.body.siteId)) },

  // ---- discrepancies ----
  {
    method: "GET",
    path: "exceptions",
    handler: (c) =>
      exceptions.listExceptions(c.db, {
        siteId: str(c.query.get("siteId")),
        status: (str(c.query.get("status")) as any) ?? "OPEN",
        type: str(c.query.get("type")) as any,
        batchId: str(c.query.get("batchId")),
        unitId: str(c.query.get("unitId")),
        limit: int(c.query.get("limit")),
        cursor: str(c.query.get("cursor")) ?? null,
      }),
  },
  {
    method: "POST",
    path: "exceptions",
    operator: true,
    handler: (c) =>
      exceptions.openException(
        c.db,
        {
          siteId: str(c.body.siteId) ?? null,
          type: reqStr(c.body.type, "Type d'écart") as any,
          unitId: str(c.body.unitId) ?? null,
          locationId: str(c.body.locationId) ?? null,
          batchId: str(c.body.batchId) ?? null,
          rawCode: str(c.body.rawCode)?.slice(0, 200) ?? null,
          details: c.body.details && typeof c.body.details === "object" ? c.body.details : null,
          opKey: str(c.body.opKey) ?? null,
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "exceptions/:id/resolve",
    operator: true,
    handler: (c) =>
      exceptions.resolveException(
        c.db,
        {
          id: c.params.id,
          status: c.body.status === "DISMISSED" ? "DISMISSED" : "RESOLVED",
          resolution: reqStr(c.body.resolution, "Résolution"),
          reason: reqStr(c.body.reason, "Motif"),
          proofRef: str(c.body.proofRef) ?? null,
        },
        c.ctx
      ),
  },

  // ---- stations, printers, print jobs ----
  {
    method: "GET",
    path: "stations",
    handler: async (c) => {
      const siteId = str(c.query.get("siteId"));
      await sweepStalePrints(c.db);
      const [stations, printers, journalStatus] = await Promise.all([printing.listStations(c.db, siteId), printing.listPrinters(c.db, siteId), journal.getJournalStatus(c.db)]);
      return { stations, printers, journal: journalStatus };
    },
  },
  {
    method: "POST",
    path: "stations",
    admin: true,
    handler: (c) => printing.createStation(c.db, { siteId: reqStr(c.body.siteId, "Site"), code: str(c.body.code), name: reqStr(c.body.name, "Nom du poste") }),
  },
  {
    method: "PATCH",
    path: "stations/:id",
    admin: true,
    handler: (c) => printing.updateStation(c.db, c.params.id, { name: str(c.body.name), status: str(c.body.status) as any }),
  },
  { method: "POST", path: "stations/:id/pair", admin: true, handler: (c) => printing.pairStation(c.db, c.params.id) },
  { method: "POST", path: "stations/:id/unpair", admin: true, handler: (c) => printing.unpairStation(c.db, c.params.id) },
  {
    method: "POST",
    path: "stations/:id/route",
    admin: true,
    handler: (c) =>
      printing.setStationRoute(c.db, {
        stationId: c.params.id,
        labelKind: reqStr(c.body.labelKind, "Type d'étiquette") as any,
        printerId: str(c.body.printerId) ?? null,
        fallbackPrinterId: str(c.body.fallbackPrinterId) ?? null,
      }),
  },
  {
    method: "POST",
    path: "stations/:id/test-print",
    handler: (c) => printing.enqueueTestPrint(c.db, { opKey: reqStr(c.body.opKey, "opKey"), stationId: c.params.id, printerId: reqStr(c.body.printerId, "Imprimante") }, c.ctx),
  },
  { method: "GET", path: "printers", handler: (c) => printing.listPrinters(c.db, str(c.query.get("siteId"))) },
  {
    method: "POST",
    path: "printers",
    admin: true,
    handler: (c) =>
      printing.createPrinter(c.db, {
        siteId: reqStr(c.body.siteId, "Site"),
        name: reqStr(c.body.name, "Nom de l'imprimante"),
        adapter: (str(c.body.adapter) as any) ?? "QZ_TRAY",
        systemName: str(c.body.systemName) ?? null,
        mediaWidthMm: Number(c.body.mediaWidthMm),
        mediaHeightMm: Number(c.body.mediaHeightMm),
        dpi: int(c.body.dpi) ?? null,
        orientation: str(c.body.orientation) as any,
        marginMm: c.body.marginMm === undefined ? undefined : Number(c.body.marginMm),
        useDriverPaperSize: c.body.useDriverPaperSize === undefined ? undefined : bool(c.body.useDriverPaperSize),
        supportedKinds: list(c.body.supportedKinds),
      }),
  },
  {
    method: "PATCH",
    path: "printers/:id",
    admin: true,
    handler: (c) => {
      const b = c.body;
      const patch: Record<string, unknown> = {};
      if (b.name !== undefined) patch.name = reqStr(b.name, "Nom");
      if (b.adapter !== undefined) patch.adapter = str(b.adapter);
      if (b.systemName !== undefined) patch.systemName = str(b.systemName) ?? null;
      if (b.mediaWidthMm !== undefined) patch.mediaWidthMm = Number(b.mediaWidthMm);
      if (b.mediaHeightMm !== undefined) patch.mediaHeightMm = Number(b.mediaHeightMm);
      if (b.dpi !== undefined) patch.dpi = int(b.dpi) ?? null;
      if (b.orientation !== undefined) patch.orientation = str(b.orientation);
      if (b.marginMm !== undefined) patch.marginMm = Number(b.marginMm);
      if (b.useDriverPaperSize !== undefined) patch.useDriverPaperSize = bool(b.useDriverPaperSize);
      if (b.supportedKinds !== undefined) patch.supportedKinds = list(b.supportedKinds) ?? [];
      if (b.status !== undefined) patch.status = str(b.status);
      return printing.updatePrinter(c.db, c.params.id, patch as any);
    },
  },
  { method: "POST", path: "printers/:id/verified", admin: true, handler: (c) => printing.markPrinterVerified(c.db, c.params.id, str(c.body.note) ?? null) },
  {
    method: "GET",
    path: "print-jobs",
    handler: async (c) => {
      await sweepStalePrints(c.db);
      return printing.listPrintJobs(c.db, {
        siteId: str(c.query.get("siteId")),
        stationId: str(c.query.get("stationId")),
        status: list(c.query.get("status")) as any,
        objectId: str(c.query.get("objectId")),
        limit: int(c.query.get("limit")),
      });
    },
  },
  {
    method: "GET",
    path: "print-jobs/:id/label",
    handler: async (c) => {
      const job = await printing.getPrintJob(c.db, c.params.id);
      if (job.labelKind === "PAIR") await journal.assertLabelProtected(c.db, job.labelCode);
      return labelFile([{ payload: job.payload, widthMm: job.widthMm, heightMm: job.heightMm }], str(c.query.get("format")), `etiquette-${job.id.slice(0, 8)}`);
    },
  },
  {
    method: "POST",
    path: "print-jobs/:id/action",
    operator: true,
    handler: (c) =>
      printing.actOnPrintJob(c.db, {
        jobId: c.params.id,
        action: reqStr(c.body.action, "Action") as any,
        printerId: str(c.body.printerId) ?? null,
        stationId: str(c.body.stationId) ?? null,
      }, c.ctx),
  },

  // ---- print agent (station credential) ----
  { method: "GET", path: "agent/me", station: true, handler: async (c) => ({ station: await printing.getStation(c.db, c.station!.id) }) },
  {
    method: "POST",
    path: "agent/claim",
    station: true,
    handler: async (c) => {
      await journal.flushJournalAfterIssue(c.db);
      const job = await printing.claimNextPrintJob(c.db, { stationId: c.station!.id });
      if (!job) return { job: null };
      const pdf = renderLabelsPdf([{ payload: job.payload, widthMm: job.widthMm, heightMm: job.heightMm }]);
      return { job: { ...job, pdfBase64: pdf.toString("base64") } };
    },
  },
  {
    method: "POST",
    path: "agent/report",
    station: true,
    handler: async (c) => {
      const job = await printing.getPrintJob(c.db, reqStr(c.body.jobId, "Tâche"));
      // A station can only report on its own jobs.
      if (job.stationId !== c.station!.id) throw new WarehouseError("NOT_FOUND", "Tâche d'impression introuvable", 404);
      return printing.reportPrintJob(
        c.db,
        { jobId: job.id, claimToken: reqStr(c.body.claimToken, "Jeton"), outcome: c.body.outcome === "SENT" ? "SENT" : "FAILED", error: str(c.body.error)?.slice(0, 300) ?? null },
        c.ctx
      );
    },
  },

  // ---- operators ----
  { method: "GET", path: "operators", handler: (c) => operators.listOperators(c.db, { activeOnly: !bool(c.query.get("all")) }) },
  {
    method: "POST",
    path: "operators",
    admin: true,
    handler: async (c) => {
      const op = await operators.createOperator(c.db, { code: str(c.body.code), name: reqStr(c.body.name, "Nom"), pin: str(c.body.pin) ?? null });
      resetOperatorCache();
      return op;
    },
  },
  {
    method: "PATCH",
    path: "operators/:id",
    admin: true,
    handler: async (c) => {
      const patch: { name?: string; active?: boolean; pin?: string | null } = {};
      if (c.body.name !== undefined) patch.name = reqStr(c.body.name, "Nom");
      if (c.body.active !== undefined) patch.active = bool(c.body.active);
      if (c.body.pin !== undefined) patch.pin = str(c.body.pin) ?? null;
      const op = await operators.updateOperator(c.db, c.params.id, patch);
      resetOperatorCache();
      return op;
    },
  },
  {
    method: "POST",
    path: "operators/login",
    handler: async (c) => {
      const op = await operators.verifyOperator(c.db, { operatorId: reqStr(c.body.operatorId, "Opérateur"), pin: str(c.body.pin) ?? null });
      if (!op) throw new WarehouseError("UNAUTHORIZED", "Opérateur inactif ou code PIN incorrect.", 401);
      return { operator: op, token: await signOperatorToken(op) };
    },
  },

  // ---- partners, agreements, prices, requests ----
  { method: "GET", path: "partners", handler: (c) => listWarehousePartners(c) },
  { method: "GET", path: "partners/:id/agreements", handler: (c) => pricing.listAgreements(c.db, c.params.id) },
  {
    method: "POST",
    path: "partners/:id/agreements",
    admin: true,
    handler: (c) =>
      pricing.saveAgreement(
        c.db,
        {
          partnerId: c.params.id,
          saleAllowed: bool(c.body.saleAllowed),
          channels: list(c.body.channels),
          pricingMode: str(c.body.pricingMode) as any,
          pricingFactor: c.body.pricingFactor ?? null,
          pricingBasisIs: str(c.body.pricingBasisIs) as any,
          commissionRate: c.body.commissionRate ?? null,
          fixedFee: c.body.fixedFee ?? null,
          currency: str(c.body.currency),
          notes: str(c.body.notes) ?? null,
        },
        c.ctx
      ),
  },
  {
    method: "GET",
    path: "prices",
    handler: (c) =>
      pricing.listPartnerPrices(c.db, {
        partnerId: reqStr(c.query.get("partnerId"), "Partenaire"),
        itemId: str(c.query.get("itemId")),
        only: str(c.query.get("only")) as any,
        limit: int(c.query.get("limit")),
        cursor: str(c.query.get("cursor")) ?? null,
      }),
  },
  {
    method: "POST",
    path: "prices/unit",
    admin: true,
    handler: (c) =>
      pricing.setUnitPrice(
        c.db,
        {
          opKey: reqStr(c.body.opKey, "opKey"),
          unitId: reqStr(c.body.unitId, "Paire"),
          publicPrice: reqStr(c.body.publicPrice, "Prix public"),
          sellerNet: str(c.body.sellerNet) ?? null,
          currency: str(c.body.currency),
          note: str(c.body.note) ?? null,
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "prices/stockx-proposal",
    admin: true,
    handler: (c) =>
      pricing.proposeStockxPrices(
        c.db,
        {
          opKey: reqStr(c.body.opKey, "opKey"),
          partnerId: reqStr(c.body.partnerId, "Partenaire"),
          itemId: reqStr(c.body.itemId, "Variante"),
          basisAmount: reqStr(c.body.basisAmount, "Prix StockX de référence"),
          basisCurrency: reqStr(c.body.basisCurrency, "Devise"),
          basisRef: reqStr(c.body.basisRef, "Référence de l'annonce"),
          basisIncludesFees: c.body.basisIncludesFees === null || c.body.basisIncludesFees === undefined ? null : bool(c.body.basisIncludesFees),
          basisObservedAt: reqStr(c.body.basisObservedAt, "Date d'observation"),
          factor: c.body.factor ?? null,
          note: str(c.body.note) ?? null,
        },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "prices/:id/decide",
    admin: true,
    handler: (c) => pricing.decidePrice(c.db, { priceId: c.params.id, decision: c.body.decision === "REJECT" ? "REJECT" : "VALIDATE", note: str(c.body.note) ?? null }, c.ctx),
  },
  {
    method: "GET",
    path: "requests",
    handler: (c) => pricing.listPartnerRequests(c.db, { partnerId: str(c.query.get("partnerId")), status: str(c.query.get("status")) as any, limit: int(c.query.get("limit")) }),
  },
  {
    method: "POST",
    path: "requests/:id/answer",
    admin: true,
    handler: (c) => pricing.answerPartnerRequest(c.db, { id: c.params.id, response: reqStr(c.body.response, "Réponse"), status: c.body.status === "CLOSED" ? "CLOSED" : "ANSWERED" }, c.ctx),
  },

  // ---- inter-site transfers ----
  { method: "GET", path: "transfers", handler: (c) => transfers.listTransfers(c.db, { siteId: str(c.query.get("siteId")), limit: int(c.query.get("limit")) }) },
  {
    method: "POST",
    path: "transfers",
    admin: true,
    handler: (c) => transfers.createTransfer(c.db, { fromSiteId: reqStr(c.body.fromSiteId, "Site de départ"), toSiteId: reqStr(c.body.toSiteId, "Site d'arrivée"), note: str(c.body.note) ?? null }),
  },
  { method: "GET", path: "transfers/:id", handler: (c) => transfers.getTransfer(c.db, c.params.id) },
  {
    method: "POST",
    path: "transfers/:id/ship",
    operator: true,
    handler: (c) => transfers.shipTransferUnit(c.db, { opKey: reqStr(c.body.opKey, "opKey"), transferId: c.params.id, unitId: reqStr(c.body.unitId, "Paire") }, c.ctx),
  },
  {
    method: "POST",
    path: "transfers/receive",
    operator: true,
    handler: (c) =>
      transfers.receiveTransferUnit(
        c.db,
        { opKey: reqStr(c.body.opKey, "opKey"), unitId: reqStr(c.body.unitId, "Paire"), toLocationId: reqStr(c.body.toLocationId, "Emplacement"), acceptOtherSite: bool(c.body.acceptOtherSite) },
        c.ctx
      ),
  },
  {
    method: "POST",
    path: "transfers/missing",
    operator: true,
    handler: (c) => transfers.markTransferUnitMissing(c.db, { opKey: reqStr(c.body.opKey, "opKey"), unitId: reqStr(c.body.unitId, "Paire"), reason: reqStr(c.body.reason, "Motif") }, c.ctx),
  },

  // ---- assisted imports ----
  {
    method: "POST",
    path: "imports/preview",
    handler: (c) => {
      const kind = reqStr(c.body.kind, "Type d'import") as imports.ImportKind;
      if (kind === "LOCATIONS" && c.role !== "admin") throw new WarehouseError("FORBIDDEN", "Réservé à l'administration.", 403);
      return imports.previewImport(c.db, { kind, targetId: reqStr(c.body.targetId, "Cible"), filename: str(c.body.filename) ?? "import.csv", csv: String(c.body.csv ?? "") });
    },
  },
  { method: "GET", path: "imports/:id", handler: (c) => imports.getImport(c.db, c.params.id) },
  { method: "POST", path: "imports/:id/apply", handler: (c) => imports.applyImport(c.db, { importId: c.params.id, maxRows: int(c.body.maxRows) }) },

  // ---- label issuance journal ----
  { method: "GET", path: "journal", handler: (c) => journal.getJournalStatus(c.db) },
  { method: "POST", path: "journal/export", handler: (c) => journal.exportLabelJournal(c.db, { limit: int(c.body.limit) }) },
  { method: "POST", path: "journal/reconcile", admin: true, handler: (c) => journal.reconcileJournalFromSink(c.db, { dryRun: c.body.dryRun === undefined ? true : bool(c.body.dryRun) }) },
];

/** Reads never fail because of this housekeeping; with writes stopped nothing is swept. */
async function sweepStalePrints(db: any): Promise<void> {
  if (!isWarehouseWritesEnabled()) return;
  await printing.sweepPrintTimeouts(db).catch(() => undefined);
}

/** A gesture that issued a pair code: push the issuance journal to its independent sink before answering. */
async function afterIssue<T>(c: { db: any }, result: Promise<T>): Promise<T> {
  const value = await result;
  await journal.flushJournalAfterIssue(c.db);
  return value;
}

export const staffRoutes = compileRoutes(routes);
