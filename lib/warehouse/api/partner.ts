import { NextRequest, NextResponse } from "next/server";
import { getPartnerSession } from "@/app/lib/partnerAuth";
import { isPartnerAllowedForWarehouse, isWarehouseModuleEnabled } from "../config";
import { getWarehouseDb, type WarehouseDb } from "../db";
import { WarehouseError } from "../errors";
import * as partnerView from "../partnerView";
import * as pricing from "../pricing";
import { bool, compileRoutes, fail, fileResponse, int, matchRoute, moduleDisabledResponse, ok, reqStr, str, type Method } from "./http";

/**
 * Partner API of the warehouse module. Paths are relative to `/api/partners/warehouse`.
 *
 * Isolation rule: the partner id comes from the signed session cookie ONLY. No route accepts a
 * partner id, an owner filter or a site-wide scope from the client; a foreign or unknown unit id
 * answers the same NOT_FOUND. The partner can read its stock and prices and send requests —
 * prices are set by the administration.
 */

type PartnerCall = {
  db: WarehouseDb;
  partnerId: string;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, any>;
};

type PartnerRoute = { method: Method; path: string; handler: (call: PartnerCall) => Promise<unknown> };

const filters = (q: URLSearchParams): partnerView.PartnerUnitFilters => ({
  search: str(q.get("search")),
  status: str(q.get("status")) as any,
  itemId: str(q.get("itemId")),
  includeOut: bool(q.get("includeOut")),
});

const routes: PartnerRoute[] = [
  { method: "GET", path: "summary", handler: (c) => partnerView.getPartnerStockSummary(c.db, c.partnerId) },
  {
    method: "GET",
    path: "units",
    handler: (c) =>
      c.query.get("group") === "item"
        ? partnerView.listPartnerStockByItem(c.db, c.partnerId, { ...filters(c.query), limit: int(c.query.get("limit")), offset: int(c.query.get("offset")) })
        : partnerView.listPartnerUnits(c.db, c.partnerId, { ...filters(c.query), limit: int(c.query.get("limit")), cursor: str(c.query.get("cursor")) ?? null }),
  },
  {
    method: "GET",
    path: "units/export",
    handler: async (c) => {
      const out = await partnerView.exportPartnerStockCsv(c.db, c.partnerId, filters(c.query));
      return fileResponse(out.csv, "text/csv; charset=utf-8", "mon-stock.csv");
    },
  },
  { method: "GET", path: "units/:id", handler: (c) => partnerView.getPartnerUnit(c.db, c.partnerId, c.params.id) },
  { method: "GET", path: "requests", handler: (c) => pricing.listPartnerRequests(c.db, { partnerId: c.partnerId, status: str(c.query.get("status")) as any, limit: int(c.query.get("limit")) }) },
  {
    method: "POST",
    path: "requests",
    handler: async (c) => {
      const unitId = str(c.body.unitId) ?? null;
      // Ownership check before anything is stored: a foreign unit is "not found".
      if (unitId) await partnerView.getPartnerUnit(c.db, c.partnerId, unitId);
      return pricing.createPartnerRequest(c.db, {
        partnerId: c.partnerId,
        unitId,
        type: (["PRICE_CHANGE", "DISCREPANCY", "OTHER"].includes(String(c.body.type)) ? c.body.type : "OTHER") as any,
        message: reqStr(c.body.message, "Message"),
        requestedPublicPrice: str(c.body.requestedPublicPrice) ?? null,
      });
    },
  },
];

const compiled = compileRoutes(routes);

/** Entry point of `app/api/partners/warehouse/[...path]/route.ts`. */
export async function handlePartnerRequest(req: NextRequest, segments: string[]): Promise<NextResponse> {
  const label = `partner ${req.method} /${segments.join("/")}`;
  try {
    if (!isWarehouseModuleEnabled()) return moduleDisabledResponse();
    const session = await getPartnerSession(req);
    if (!session) throw new WarehouseError("UNAUTHORIZED", "Connexion requise.", 401);
    if (!isPartnerAllowedForWarehouse(session.partnerKey)) return moduleDisabledResponse();
    const matched = matchRoute(compiled, req.method, segments);
    if (!matched) throw new WarehouseError("NOT_FOUND", "Route inconnue.", 404);
    const db = await getWarehouseDb();
    // The session must still point at an active partner (a deactivated partner loses access).
    const partner = await db.$queryRaw<{ id: string }[]>`SELECT "id" FROM "Partner" WHERE "id" = ${session.partnerId} AND "active" = true`;
    if (!partner[0]) throw new WarehouseError("UNAUTHORIZED", "Connexion requise.", 401);
    let body: Record<string, any> = {};
    if (req.method !== "GET") {
      try {
        const parsed = JSON.parse((await req.text()) || "{}");
        body = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
      } catch {
        throw new WarehouseError("INVALID_INPUT", "Corps de requête JSON invalide.", 400);
      }
    }
    const result = await matched.route.handler({ db, partnerId: partner[0].id, params: matched.params, query: req.nextUrl.searchParams, body });
    if (result instanceof NextResponse) return result;
    return ok(result);
  } catch (err) {
    return fail(err, label);
  }
}
