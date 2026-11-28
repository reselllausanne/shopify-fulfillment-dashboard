import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as operators from "../operators";
import * as printing from "../printing";
import { HAS_DB, TEST_URL, admin, closeTestDb, makeItem, makePartner, makeReceivingBatch, makeWorld, op, receiveOne, type World } from "./harness";

/**
 * HTTP-level checks of the two entry points: module flag, staff / partner sessions, roles,
 * operator identification, station credential and partner isolation through direct links.
 */

const d = describe.skipIf(!HAS_DB);
const SECRET = "warehouse-api-test-secret";

let handleStaff: (req: NextRequest, segments: string[]) => Promise<Response>;
let handlePartner: (req: NextRequest, segments: string[]) => Promise<Response>;
let w: World;

const sign = (payload: Record<string, unknown>) =>
  new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(SECRET));

type CallOpts = { method?: string; body?: unknown; cookie?: string; headers?: Record<string, string> };
function request(url: string, opts: CallOpts): NextRequest {
  const headers: Record<string, string> = { ...(opts.headers ?? {}) };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  return new NextRequest(`http://localhost${url}`, { method: opts.method ?? "GET", headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
}
async function staff(pathAndQuery: string, opts: CallOpts = {}) {
  const res = await handleStaff(request(`/api/warehouse/${pathAndQuery}`, opts), pathAndQuery.split("?")[0].split("/"));
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, json: isJson ? ((await res.json()) as any) : null, res };
}
async function partner(pathAndQuery: string, opts: CallOpts = {}) {
  const res = await handlePartner(request(`/api/partners/warehouse/${pathAndQuery}`, opts), pathAndQuery.split("?")[0].split("/"));
  const isJson = (res.headers.get("content-type") ?? "").includes("json");
  return { status: res.status, json: isJson ? ((await res.json()) as any) : null, text: isJson ? "" : await res.text(), res };
}

let adminCookie = "";
let logisticsCookie = "";
let savCookie = "";

beforeAll(async () => {
  if (!HAS_DB) return;
  process.env.DATABASE_URL = TEST_URL;
  process.env.DIRECT_URL = TEST_URL;
  process.env.JWT_SECRET = SECRET;
  delete process.env.PARTNER_JWT_SECRET;
  const http = await import("../api/http");
  const { staffRoutes } = await import("../api/staff");
  const partnerApi = await import("../api/partner");
  handleStaff = (req, segments) => http.handleStaffRequest(req, segments, staffRoutes);
  handlePartner = partnerApi.handlePartnerRequest;
  adminCookie = `auth_token=${await sign({ role: "admin" })}`;
  logisticsCookie = `auth_token=${await sign({ role: "logistics" })}`;
  savCookie = `auth_token=${await sign({ role: "sav" })}`;
  w = await makeWorld();
});
afterAll(closeTestDb);

d("staff API — access rules", () => {
  it("module flag off: every route answers 404 MODULE_DISABLED, even with a valid session", async () => {
    process.env.WAREHOUSE_MODULE_ENABLED = "false";
    try {
      const a = await staff("config", { cookie: adminCookie });
      expect(a.status).toBe(404);
      expect(a.json.error.code).toBe("MODULE_DISABLED");
      const b = await staff(`batches/${"x".repeat(8)}/receive`, { method: "POST", cookie: adminCookie, body: {} });
      expect(b.status).toBe(404);
      const p = await partner("summary", { cookie: `partner_auth=${await sign({ partnerId: w.partner.id, partnerKey: w.partner.key })}` });
      expect(p.status).toBe(404);
    } finally {
      process.env.WAREHOUSE_MODULE_ENABLED = "true";
    }
  });

  it("needs a staff session; the SAV role and a partner cookie are not staff", async () => {
    expect((await staff("config")).status).toBe(401);
    expect((await staff("config", { cookie: "auth_token=garbage" })).status).toBe(401);
    expect((await staff("config", { cookie: savCookie })).status).toBe(401);
    const partnerCookie = `partner_auth=${await sign({ partnerId: w.partner.id, partnerKey: w.partner.key })}`;
    expect((await staff("units", { cookie: partnerCookie })).status).toBe(401);
    const ok = await staff("config", { cookie: logisticsCookie });
    expect(ok.status).toBe(200);
    expect(ok.json.data.role).toBe("logistics");
    expect(ok.json.data.flags.outboundConnectors).toBe("none");
    expect(ok.res.headers.get("cache-control")).toBe("no-store");
  });

  it("configuration and sensitive corrections are admin-only", async () => {
    const denied = [
      staff("sites", { method: "POST", cookie: logisticsCookie, body: { code: "ZZ77", name: "x", countryCode: "CH" } }),
      staff("locations/generate", { method: "POST", cookie: logisticsCookie, body: { siteId: w.site.id } }),
      staff("stations", { method: "POST", cookie: logisticsCookie, body: { siteId: w.site.id, name: "x" } }),
      staff(`stations/${w.station.id}/pair`, { method: "POST", cookie: logisticsCookie, body: {} }),
      staff("printers", { method: "POST", cookie: logisticsCookie, body: {} }),
      staff("operators", { method: "POST", cookie: logisticsCookie, body: { name: "x" } }),
      staff(`partners/${w.partner.id}/agreements`, { method: "POST", cookie: logisticsCookie, body: { saleAllowed: true } }),
      staff("prices/unit", { method: "POST", cookie: logisticsCookie, body: {} }),
      staff("journal/reconcile", { method: "POST", cookie: logisticsCookie, body: {} }),
    ];
    for (const r of await Promise.all(denied)) {
      expect(r.status).toBe(403);
      expect(r.json.error.code).toBe("FORBIDDEN");
    }
  });

  it("write stop switch: gestures answer 503, reads and scans keep working", async () => {
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    process.env.WAREHOUSE_WRITES_ENABLED = "false";
    try {
      const refused = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body: { opKey: op("rcv"), itemId: item.id } });
      expect(refused.status).toBe(503);
      expect(refused.json.error.code).toBe("WRITES_DISABLED");
      const move = await staff(`units/${r.unit.id}/relocate`, { method: "POST", cookie: logisticsCookie, body: { opKey: op("mv"), toLocationId: w.levels[0].id } });
      expect(move.status).toBe(503);
      const scan = await staff(`scan?code=${encodeURIComponent(r.unit.labelCode)}`, { cookie: logisticsCookie });
      expect(scan.status).toBe(200);
      expect(scan.json.data.unit.id).toBe(r.unit.id);
      expect((await staff(`units?siteId=${w.site.id}`, { cookie: logisticsCookie })).status).toBe(200);
      const cfg = await staff("config", { cookie: logisticsCookie });
      expect(cfg.json.data.flags.writesEnabled).toBe(false);
      const cookie = `partner_auth=${await sign({ partnerId: w.partner.id, partnerKey: w.partner.key })}`;
      expect((await partner("summary", { cookie })).status).toBe(200);
      expect((await partner("requests", { method: "POST", cookie, body: { type: "OTHER", message: "Question pendant l'arrêt" } })).status).toBe(503);
    } finally {
      delete process.env.WAREHOUSE_WRITES_ENABLED;
    }
    // Nothing was written while stopped.
    const detail = await staff(`units/${r.unit.id}`, { cookie: logisticsCookie });
    expect(detail.json.data.unit.currentLocationId).toBe(w.cart.id);
  });

  it("pilot perimeter: stock only enters on the listed sites; existing pairs stay readable", async () => {
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    process.env.WAREHOUSE_PILOT_SITES = "ZZ00";
    try {
      const newBatch = await staff("batches", {
        method: "POST",
        cookie: logisticsCookie,
        body: { siteId: w.site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: w.partner.id, receivingLocationId: w.cart.id },
      });
      expect(newBatch.status).toBe(403);
      expect(newBatch.json.error.code).toBe("SITE_NOT_IN_PILOT");
      const rcv = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body: { opKey: op("rcv"), itemId: item.id } });
      expect(rcv.status).toBe(403);
      expect((await staff(`scan?code=${encodeURIComponent(r.unit.labelCode)}`, { cookie: logisticsCookie })).status).toBe(200);
    } finally {
      delete process.env.WAREHOUSE_PILOT_SITES;
    }
    process.env.WAREHOUSE_PILOT_SITES = `ZZ00, ${w.site.code.toLowerCase()}`;
    try {
      const rcv = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body: { opKey: op("rcv"), itemId: item.id } });
      expect(rcv.status).toBe(200);
    } finally {
      delete process.env.WAREHOUSE_PILOT_SITES;
    }
  });

  it("unknown route and malformed JSON are clean errors", async () => {
    expect((await staff("nope/nope", { cookie: adminCookie })).status).toBe(404);
    const bad = await handleStaff(
      new NextRequest("http://localhost/api/warehouse/exceptions", { method: "POST", headers: { cookie: adminCookie, "content-type": "application/json" }, body: "{not json" }),
      ["exceptions"]
    );
    expect(bad.status).toBe(400);
  });

  it("a physical gesture needs a named operator once operators exist; a deactivated operator is refused at once", async () => {
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const operator = await operators.createOperator(w.db, { name: "Camille", code: `C${Math.random().toString(36).slice(2, 9)}`, pin: "4821" });
    const http = await import("../api/http");
    http.resetOperatorCache();
    const body = { opKey: op("rcv"), itemId: item.id };
    const anonymous = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body });
    expect(anonymous.status).toBe(401);
    expect(anonymous.json.error.details.operatorRequired).toBe(true);

    const wrongPin = await staff("operators/login", { method: "POST", cookie: logisticsCookie, body: { operatorId: operator.id, pin: "0000" } });
    expect(wrongPin.status).toBe(401);
    const login = await staff("operators/login", { method: "POST", cookie: logisticsCookie, body: { operatorId: operator.id, pin: "4821" } });
    expect(login.status).toBe(200);
    const token = login.json.data.token as string;
    expect(JSON.stringify(login.json)).not.toContain("pinHash");

    const done = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body, headers: { "x-warehouse-operator": token } });
    expect(done.status).toBe(200);
    expect(done.json.data.unit.labelCode).toMatch(new RegExp(`-${w.site.code}$`));
    // Same key again → replay, not a second pair.
    const replay = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body, headers: { "x-warehouse-operator": token } });
    expect(replay.json.data.replayed).toBe(true);
    expect(replay.json.data.unit.id).toBe(done.json.data.unit.id);
    const detail = await staff(`units/${done.json.data.unit.id}`, { cookie: logisticsCookie });
    expect(detail.json.data.movements[0].operatorName).toBe("Camille");
    expect(detail.json.data.movements.length).toBe(1);

    await operators.updateOperator(w.db, operator.id, { active: false });
    http.resetOperatorCache();
    const after = await staff(`batches/${batch.id}/receive`, { method: "POST", cookie: logisticsCookie, body: { opKey: op("rcv"), itemId: item.id }, headers: { "x-warehouse-operator": token } });
    // No active operator remains → the gesture is anonymous-allowed again only if none exist at all.
    const others = await operators.listOperators(w.db, { activeOnly: true });
    expect(after.status).toBe(others.length > 0 ? 401 : 200);
    const relogin = await staff("operators/login", { method: "POST", cookie: logisticsCookie, body: { operatorId: operator.id, pin: "4821" } });
    expect(relogin.status).toBe(401);
  });

  it("the print agent must prove its station; it only gets and reports its own jobs", async () => {
    const world = await makeWorld();
    const item = await makeItem(world.db);
    const batch = await makeReceivingBatch(world);
    await receiveOne(world, batch.id, item.id, world.ctx);
    const forOther = await receiveOne(world, batch.id, item.id, world.ctx2);
    const { credential } = await printing.pairStation(world.db, world.station.id);

    expect((await staff("agent/claim", { method: "POST", cookie: logisticsCookie, body: {} })).status).toBe(401);
    expect((await staff("agent/claim", { method: "POST", cookie: logisticsCookie, body: {}, headers: { "x-warehouse-station": `${world.station.id}.bad` } })).status).toBe(401);
    // The station credential alone (no staff session) is not enough either.
    expect((await staff("agent/claim", { method: "POST", body: {}, headers: { "x-warehouse-station": credential } })).status).toBe(401);

    const claim = await staff("agent/claim", { method: "POST", cookie: logisticsCookie, body: {}, headers: { "x-warehouse-station": credential } });
    expect(claim.status).toBe(200);
    const job = claim.json.data.job;
    expect(job.stationId).toBe(world.station.id);
    expect(Buffer.from(job.pdfBase64, "base64").toString("latin1").startsWith("%PDF-")).toBe(true);
    expect(job.printer.systemName).toBe("ZD421-test");
    const none = await staff("agent/claim", { method: "POST", cookie: logisticsCookie, body: {}, headers: { "x-warehouse-station": credential } });
    expect(none.json.data.job).toBeNull();

    const otherJob = (await printing.listPrintJobs(world.db, { objectId: forOther.unit.id }))[0];
    const foreign = await staff("agent/report", { method: "POST", cookie: logisticsCookie, body: { jobId: otherJob.id, claimToken: "x", outcome: "SENT" }, headers: { "x-warehouse-station": credential } });
    expect(foreign.status).toBe(404);
    const sent = await staff("agent/report", { method: "POST", cookie: logisticsCookie, body: { jobId: job.id, claimToken: job.claimToken, outcome: "SENT" }, headers: { "x-warehouse-station": credential } });
    expect(sent.json.data.status).toBe("SENT");
  });

  it("serves the pair label as a one-page PDF and as SVG", async () => {
    const item = await makeItem(w.db);
    const batch = await makeReceivingBatch(w);
    const r = await receiveOne(w, batch.id, item.id);
    const pdf = await handleStaff(request(`/api/warehouse/units/${r.unit.id}/label`, { cookie: adminCookie }), ["units", r.unit.id, "label"]);
    expect(pdf.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await pdf.arrayBuffer()).toString("latin1")).toContain("/Count 1");
    const svg = await handleStaff(request(`/api/warehouse/units/${r.unit.id}/label?format=svg`, { cookie: adminCookie }), ["units", r.unit.id, "label"]);
    expect(svg.headers.get("content-type")).toBe("image/svg+xml");
  });
});

d("partner API — isolation through the HTTP surface", () => {
  it("needs a partner session; a staff cookie is not a partner; an inactive partner loses access", async () => {
    expect((await partner("summary")).status).toBe(401);
    expect((await partner("summary", { cookie: adminCookie })).status).toBe(401);
    const ghost = await sign({ partnerId: "00000000-0000-4000-8000-000000000000", partnerKey: "GHOST" });
    expect((await partner("summary", { cookie: `partner_auth=${ghost}` })).status).toBe(401);
    const inactive = await makePartner(w.db);
    await w.db.$executeRawUnsafe(`UPDATE "Partner" SET "active" = false WHERE "id" = $1`, inactive.id);
    expect((await partner("summary", { cookie: `partner_auth=${await sign({ partnerId: inactive.id, partnerKey: inactive.key })}` })).status).toBe(401);
  });

  it("the allow-list hides the module from partners outside the pilot", async () => {
    const cookie = `partner_auth=${await sign({ partnerId: w.partner.id, partnerKey: w.partner.key })}`;
    process.env.WAREHOUSE_PARTNER_ALLOWLIST = "SOMEONE_ELSE";
    try {
      const hidden = await partner("summary", { cookie });
      expect(hidden.status).toBe(404);
      expect(hidden.json.error.code).toBe("MODULE_DISABLED");
    } finally {
      delete process.env.WAREHOUSE_PARTNER_ALLOWLIST;
    }
    expect((await partner("summary", { cookie })).status).toBe(200);
  });

  it("lists, detail, export and requests are scoped by the session — query parameters cannot widen the scope", async () => {
    const world = await makeWorld();
    const rival = await makePartner(world.db, "Rival");
    const item = await makeItem(world.db);
    const mine = await receiveOne(world, (await makeReceivingBatch(world)).id, item.id);
    const theirs = await receiveOne(world, (await makeReceivingBatch(world, { ownerPartnerId: rival.id })).id, item.id);
    const cookie = `partner_auth=${await sign({ partnerId: world.partner.id, partnerKey: world.partner.key })}`;

    const list = await partner(`units?partnerId=${rival.id}&ownerPartnerId=${rival.id}&ownerKind=OWN&siteId=${world.site.id}&includeOut=true`, { cookie });
    expect(list.status).toBe(200);
    expect(list.json.data.items.map((u: any) => u.id)).toEqual([mine.unit.id]);
    const grouped = await partner(`units?group=item&partnerId=${rival.id}`, { cookie });
    expect(grouped.json.data.items.reduce((s: number, g: any) => s + g.quantity, 0)).toBe(1);
    const summary = await partner(`summary?partnerId=${rival.id}`, { cookie });
    expect(summary.json.data.held).toBe(1);

    const foreign = await partner(`units/${theirs.unit.id}`, { cookie });
    const unknown = await partner("units/00000000-0000-4000-8000-000000000000", { cookie });
    expect(foreign.status).toBe(404);
    expect(foreign.json).toEqual(unknown.json);
    // The full label code is not an entry either.
    expect((await partner(`units/${encodeURIComponent(theirs.unit.labelCode)}`, { cookie })).status).toBe(404);

    const own = await partner(`units/${mine.unit.id}`, { cookie });
    expect(own.status).toBe(200);
    expect(JSON.stringify(own.json)).not.toMatch(/CART|locationCode|operator|station|margin/);

    const csv = await partner("units/export", { cookie });
    expect(csv.res.headers.get("content-type")).toContain("text/csv");
    expect(csv.text).toContain(mine.unit.shortRef);
    expect(csv.text).not.toContain(theirs.unit.shortRef);

    const sneaky = await partner("requests", { method: "POST", cookie, body: { unitId: theirs.unit.id, partnerId: rival.id, type: "PRICE_CHANGE", message: "Baissez ce prix" } });
    expect(sneaky.status).toBe(404);
    const ok = await partner("requests", { method: "POST", cookie, body: { unitId: mine.unit.id, partnerId: rival.id, type: "PRICE_CHANGE", message: "Merci de revoir le prix", requestedPublicPrice: "150" } });
    expect(ok.status).toBe(200);
    const rivalCookie = `partner_auth=${await sign({ partnerId: rival.id, partnerKey: rival.key })}`;
    expect((await partner("requests", { cookie: rivalCookie })).json.data).toEqual([]);
    expect((await partner("requests", { cookie })).json.data.length).toBe(1);
    // The partner API has no write route on stock, prices or state.
    for (const path of [`units/${mine.unit.id}`, "prices/unit", `units/${mine.unit.id}/sale`]) {
      const res = await partner(path, { method: "POST", cookie, body: { publicPrice: "1", saleState: "SALE_AUTHORIZED" } });
      expect(res.status).toBe(404);
    }
    // Staff routes are unreachable with a partner cookie.
    expect((await staff(`units/${mine.unit.id}`, { cookie })).status).toBe(401);
    void admin;
  });
});
