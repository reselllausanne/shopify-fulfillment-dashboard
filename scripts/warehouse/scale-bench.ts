/**
 * Measured recipe for a volume tier (roadmap §7.1 / §7.2) — LOCAL TEST DATABASE ONLY.
 *
 *   WAREHOUSE_TEST_DATABASE_URL=postgresql://…/warehouse_scale?schema=public \
 *     npx tsx scripts/warehouse/scale-bench.ts --label 10k [--seconds 30] [--partners 50] [--stations 2] [--out file.json]
 *
 * What it measures, on the data left by scale-seed.ts:
 *   1. reads   — every query a screen or a scanner issues (scan, detail, lists, deep keyset
 *                pages, search, partner views, overview, reconciliation), run cold first;
 *   2. writes  — the pilot gestures (receive, propose, putaway, relocate, reprint) one by one;
 *   3. load    — N partner sessions + M stations in parallel through the real API handlers
 *                (session check, routing, service, JSON), mixed read / write, with the first
 *                seconds reported separately from the sustained phase;
 *   4. safety  — contention on the last free place, registry uniqueness, index use of the code
 *                lookup, stock reconciliation before / after, counters vs reality;
 *   5. sizes   — tables and indexes.
 *
 * The API handlers run in this process: latency includes auth, routing, services and the
 * database, NOT the network, TLS or the reverse proxy. `--http <base-url>` is reported as a
 * separate pass when a real server is given.
 */
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { PrismaClient } from "@prisma/client";

const url = process.env.WAREHOUSE_TEST_DATABASE_URL ?? "";
if (!/@(127\.0\.0\.1|localhost)[:/]/.test(url)) {
  console.error("Refus : WAREHOUSE_TEST_DATABASE_URL doit pointer sur une base locale (127.0.0.1).");
  process.exit(1);
}
const POOL = Number(process.env.WAREHOUSE_BENCH_POOL ?? 20);
const pooledUrl = `${url}&connection_limit=${POOL}&pool_timeout=30`;
process.env.DATABASE_URL = pooledUrl;
process.env.DIRECT_URL = url;
process.env.JWT_SECRET = "warehouse-bench-secret";
delete process.env.PARTNER_JWT_SECRET;
process.env.WAREHOUSE_MODULE_ENABLED = "true";
process.env.WAREHOUSE_WRITES_ENABLED = "true";
process.env.WAREHOUSE_PARTNER_ALLOWLIST = "*";

const argv = process.argv.slice(2);
const flag = (name: string, fallback: string): string => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : fallback;
};
const LABEL = flag("label", "tier");
const SECONDS = Number(flag("seconds", "30"));
const PARTNER_SESSIONS = Number(flag("partners", "50"));
const STATIONS = Number(flag("stations", "2"));
const OUT = flag("out", "");
const ITER = Number(flag("iter", "200"));

type Stat = { n: number; p50: number; p95: number; p99: number; max: number; mean: number; first?: number; errors?: number };
function stat(samples: number[], first?: number, errors = 0): Stat {
  const s = [...samples].sort((a, b) => a - b);
  const at = (p: number) => s[Math.min(s.length - 1, Math.floor(p * s.length))] ?? 0;
  const r = (v: number) => Number(v.toFixed(2));
  return { n: s.length, p50: r(at(0.5)), p95: r(at(0.95)), p99: r(at(0.99)), max: r(s[s.length - 1] ?? 0), mean: r(s.reduce((a, b) => a + b, 0) / (s.length || 1)), ...(first !== undefined ? { first: r(first) } : {}), ...(errors ? { errors } : {}) };
}
async function measure(n: number, fn: (i: number) => Promise<unknown>): Promise<Stat> {
  const samples: number[] = [];
  let first = 0;
  for (let i = 0; i < n; i += 1) {
    const t0 = performance.now();
    await fn(i);
    const dt = performance.now() - t0;
    if (i === 0) first = dt;
    samples.push(dt);
  }
  return stat(samples, first);
}
const pick = <T,>(arr: T[], i: number): T => arr[i % arr.length];

async function main() {
  const units = await import("../../lib/warehouse/units");
  const batches = await import("../../lib/warehouse/batches");
  const putaway = await import("../../lib/warehouse/putaway");
  const partnerView = await import("../../lib/warehouse/partnerView");
  const printing = await import("../../lib/warehouse/printing");
  const locations = await import("../../lib/warehouse/locations");
  const { getOverview, getStockReconciliation } = await import("../../lib/warehouse/overview");
  const http = await import("../../lib/warehouse/api/http");
  const { staffRoutes } = await import("../../lib/warehouse/api/staff");
  const partnerApi = await import("../../lib/warehouse/api/partner");

  const db = new PrismaClient({ datasources: { db: { url: pooledUrl } } });
  const n1 = async (sql: string, ...p: unknown[]) => Number((await db.$queryRawUnsafe<{ n: bigint }[]>(sql, ...p))[0].n);
  const report: Record<string, any> = { label: LABEL, at: new Date().toISOString(), pool: POOL };

  // ── Dataset ────────────────────────────────────────────────────────────────
  const sites = await db.$queryRawUnsafe<{ id: string; code: string; n: bigint }[]>(
    `SELECT s."id", s."code", (SELECT count(*) FROM "WarehouseUnit" u WHERE u."currentSiteId" = s."id") AS n FROM "WarehouseSite" s ORDER BY 3 DESC`
  );
  const site = sites[0];
  report.dataset = {
    activeUnits: await n1(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "presence" <> 'OUT'`),
    allUnits: await n1(`SELECT count(*) AS n FROM "WarehouseUnit"`),
    labelCodes: await n1(`SELECT count(*) AS n FROM "WarehouseLabelCode"`),
    movements: await n1(`SELECT count(*) AS n FROM "WarehouseMovement"`),
    archivedMovements: await n1(`SELECT count(*) AS n FROM "WarehouseMovementArchive"`),
    sites: sites.map((s) => ({ code: s.code, units: Number(s.n) })),
    levels: await n1(`SELECT count(*) AS n FROM "WarehouseLocation" WHERE "kind" = 'LEVEL'`),
    partners: await n1(`SELECT count(DISTINCT "ownerPartnerId") AS n FROM "WarehouseUnit" WHERE "presence" <> 'OUT'`),
    items: await n1(`SELECT count(*) AS n FROM "WarehouseItem"`),
  };
  const sample = await db.$queryRawUnsafe<{ id: string; labelCode: string; itemId: string; currentLocationId: string | null }[]>(
    `SELECT "id", "labelCode", "itemId", "currentLocationId" FROM "WarehouseUnit" WHERE "presence" = 'PRESENT' AND "currentSiteId" = $1 ORDER BY random() LIMIT 500`,
    site.id
  );
  const oldCodes = await db.$queryRawUnsafe<{ id: string; labelCode: string }[]>(`SELECT "id", "labelCode" FROM "WarehouseUnit" WHERE "presence" = 'OUT' ORDER BY random() LIMIT 200`);
  const partners = await db.$queryRawUnsafe<{ id: string; key: string; n: bigint }[]>(
    `SELECT p."id", p."key", count(u."id") AS n FROM "Partner" p JOIN "WarehouseUnit" u ON u."ownerPartnerId" = p."id" AND u."presence" <> 'OUT' GROUP BY 1, 2 ORDER BY 3 DESC`
  );
  const bigPartner = partners[0];
  const medianPartner = partners[Math.floor(partners.length / 2)];
  const styles = (await db.$queryRawUnsafe<{ styleCode: string }[]>(`SELECT "styleCode" FROM "WarehouseItem" WHERE "styleCode" IS NOT NULL ORDER BY random() LIMIT 50`)).map((r) => r.styleCode);
  const gtins = (await db.$queryRawUnsafe<{ gtin: string }[]>(`SELECT "gtin" FROM "WarehouseItem" WHERE "gtin" IS NOT NULL ORDER BY random() LIMIT 50`)).map((r) => r.gtin);
  const levelCodes = (await db.$queryRawUnsafe<{ code: string }[]>(`SELECT "code" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'LEVEL' ORDER BY random() LIMIT 100`, site.id)).map((r) => r.code);
  report.dataset.biggestPartnerUnits = Number(bigPartner.n);
  report.dataset.medianPartnerUnits = Number(medianPartner.n);

  const reconcileBefore = await getStockReconciliation(db);

  // ── 1. Reads (first call = cold for this process and, after a cluster restart, for the DB) ──
  const reads: Record<string, Stat> = {};
  reads["scan: pair QR → unit (registry)"] = await measure(ITER, (i) => units.resolveScan(db, pick(sample, i).labelCode));
  if (oldCodes.length) reads["scan: QR of a pair gone / archived"] = await measure(Math.min(ITER, 200), (i) => units.resolveScan(db, pick(oldCodes, i).labelCode));
  reads["scan: well-formed code never issued"] = await measure(ITER, () => units.resolveScan(db, `${randomUUID()}-${site.code}`));
  reads["scan: level code → location"] = await measure(ITER, (i) => units.resolveScan(db, pick(levelCodes, i)));
  reads["scan: GTIN → variant"] = await measure(ITER, (i) => units.resolveScan(db, pick(gtins, i)));
  reads["unit detail (state + history)"] = await measure(ITER, (i) => units.getUnitDetail(db, pick(sample, i).id));
  reads["stock list: site, page 1 (50)"] = await measure(60, () => units.listUnits(db, { siteId: site.id, limit: 50 }));
  {
    // Deep keyset pagination: walk 40 pages, time each page.
    const samples: number[] = [];
    let cursor: string | null = null;
    for (let p = 0; p < 40; p += 1) {
      const t0 = performance.now();
      const page: { nextCursor: string | null } = await units.listUnits(db, { siteId: site.id, limit: 50, cursor });
      samples.push(performance.now() - t0);
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    reads["stock list: keyset pages 1→40"] = stat(samples);
  }
  reads["stock list: one owner on one site"] = await measure(60, (i) => units.listUnits(db, { siteId: site.id, ownerPartnerId: pick(partners, i).id, limit: 50 }));
  reads["stock list: sellable + quality passed"] = await measure(60, () => units.listUnits(db, { siteId: site.id, saleState: "SALE_AUTHORIZED", qcState: "PASSED", limit: 50 }));
  reads["stock list: missing pairs"] = await measure(60, () => units.listUnits(db, { presence: "MISSING", limit: 50 }));
  reads["stock list: one level"] = await measure(ITER, (i) => units.listUnits(db, { locationId: pick(sample, i).currentLocationId ?? undefined, limit: 50 }));
  reads["stock search: style code (text)"] = await measure(60, (i) => units.listUnits(db, { siteId: site.id, search: pick(styles, i), limit: 50 }));
  reads["stock search: GTIN"] = await measure(60, (i) => units.listUnits(db, { search: pick(gtins, i), limit: 50 }));
  reads["stock search: short ref (ABCD-1234)"] = await measure(ITER, (i) => units.listUnits(db, { search: pick(sample, i).id.slice(0, 8), limit: 50 }));
  reads["stock by variant: site, page 1"] = await measure(30, () => units.aggregateUnitsByItem(db, { siteId: site.id, limit: 50 } as any));
  reads["overview: site dashboard"] = await measure(30, () => getOverview(db, site.id));
  reads["reconciliation: site × owner × state"] = await measure(10, () => getStockReconciliation(db));
  reads["putaway queue: site"] = await measure(30, () => putaway.listPutawayQueue(db, { siteId: site.id, limit: 200 }));
  reads["locations: site structure"] = await measure(20, () => locations.getSiteStructure(db, site.id));
  for (const [name, p] of [["biggest", bigPartner], ["median", medianPartner]] as const) {
    reads[`partner ${name}: summary`] = await measure(60, () => partnerView.getPartnerStockSummary(db, p.id));
    reads[`partner ${name}: list page 1`] = await measure(60, () => partnerView.listPartnerUnits(db, p.id, { limit: 50 }));
    reads[`partner ${name}: by variant`] = await measure(60, () => partnerView.listPartnerStockByItem(db, p.id, { limit: 50 }));
    reads[`partner ${name}: search style`] = await measure(60, (i) => partnerView.listPartnerUnits(db, p.id, { search: pick(styles, i), limit: 50 }));
  }
  report.reads = reads;

  // ── Index use of the code lookup ───────────────────────────────────────────
  const explain = async (sql: string, ...p: unknown[]) => (await db.$queryRawUnsafe<{ "QUERY PLAN": string }[]>(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, ...p)).map((r) => r["QUERY PLAN"]);
  const planCode = await explain(`SELECT "unitId", "format", "isOriginal" FROM "WarehouseLabelCode" WHERE "code" = $1`, sample[0].labelCode);
  const planUnit = await explain(`SELECT * FROM "WarehouseUnit" WHERE "id" = $1`, sample[0].id);
  const planHistory = await explain(`SELECT * FROM "WarehouseMovement" WHERE "unitId" = $1 ORDER BY "seq" DESC LIMIT 50`, sample[0].id);
  const planPartner = await explain(
    `SELECT u."id" FROM "WarehouseUnit" u WHERE u."ownerPartnerId" = $1 AND u."presence" <> 'OUT' ORDER BY u."receivedAt" DESC, u."id" DESC LIMIT 51`,
    bigPartner.id
  );
  report.plans = {
    codeLookup: planCode,
    codeLookupUsesIndex: planCode.some((l) => /Index (Only )?Scan using "?WarehouseLabelCode_pkey/.test(l)) && !planCode.some((l) => /Seq Scan/.test(l)),
    unitById: planUnit[0],
    unitHistory: planHistory.slice(0, 3),
    historyUsesIndex: planHistory.some((l) => /WarehouseMovement_unitId_seq_idx/.test(l)),
    partnerList: planPartner.slice(0, 4),
    partnerListSeqScan: planPartner.some((l) => /Seq Scan/.test(l)),
  };

  // ── Parallel scans on the registry ─────────────────────────────────────────
  {
    const all = [...sample, ...oldCodes];
    const samples: number[] = [];
    const t0 = performance.now();
    await Promise.all(
      Array.from({ length: 64 }, async (_, w) => {
        for (let i = 0; i < 100; i += 1) {
          const u = all[(w * 100 + i) % all.length];
          const s0 = performance.now();
          const r = await units.resolveScan(db, u.labelCode);
          samples.push(performance.now() - s0);
          if (r.kind !== "UNIT" || r.unit.id !== u.id) throw new Error(`Scan of ${u.labelCode} did not return its own unit`);
        }
      })
    );
    const seconds = (performance.now() - t0) / 1000;
    report.parallelScans = { workers: 64, scans: samples.length, perSecond: Math.round(samples.length / seconds), latencyMs: stat(samples), allResolvedToOwnUuid: true };
  }

  // ── 2. Writes, one by one, then contention ─────────────────────────────────
  const ctxFor = async (i: number) => {
    const code = `B${LABEL.replace(/[^A-Za-z0-9]/g, "").slice(0, 4).toUpperCase()}${i}${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
    const station = await printing.createStation(db, { siteId: site.id, code, name: `Banc ${LABEL} ${i}` });
    return { role: "logistics" as const, operatorId: null, stationId: station.id };
  };
  const stationCtx = await Promise.all(Array.from({ length: Math.max(2, STATIONS) }, (_, i) => ctxFor(i + 1)));
  const carts = await db.$queryRawUnsafe<{ id: string }[]>(`SELECT "id" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'RECEIVING' ORDER BY "code"`, site.id);
  const newBatch = (i: number) =>
    batches.createBatch(
      db,
      { siteId: site.id, kind: "RECEIVING", flow: "CONSIGNMENT", ownerKind: "PARTNER", ownerPartnerId: pick(partners, i).id, receivingLocationId: pick(carts, i).id, title: `Banc ${LABEL}` } as any,
      stationCtx[i % stationCtx.length]
    );
  const writes: Record<string, Stat> = {};
  {
    const batch = await newBatch(0);
    const ctx = stationCtx[0];
    const created: string[] = [];
    writes["receive one pair (new UUID + label job + task)"] = await measure(100, async (i) => {
      const r = await batches.receiveUnit(db, { opKey: `bench-${randomUUID()}`, batchId: batch.id, itemId: pick(sample, i).itemId, condition: "NEW" } as any, ctx);
      created.push(r.unit.id);
    });
    const replayKey = `bench-${randomUUID()}`;
    await batches.receiveUnit(db, { opKey: replayKey, batchId: batch.id, itemId: sample[0].itemId, condition: "NEW" } as any, ctx);
    writes["replay of the same gesture key"] = await measure(50, () => batches.receiveUnit(db, { opKey: replayKey, batchId: batch.id, itemId: sample[0].itemId, condition: "NEW" } as any, ctx));
    writes["propose destinations for 100 pairs"] = await measure(1, () => putaway.proposeDestinations(db, { siteId: site.id, batchId: batch.id, limit: 200 }, ctx));
    const queue = await putaway.listPutawayQueue(db, { siteId: site.id, batchId: batch.id, limit: 500 });
    const reserved = queue.tasks.filter((t) => t.proposedLocationId);
    writes["confirm putaway (scan pair + level)"] = await measure(Math.min(100, reserved.length), (i) =>
      putaway.confirmPutaway(db, { opKey: `bench-${randomUUID()}`, unitId: reserved[i].unit.id, locationId: reserved[i].proposedLocationId as string }, ctx)
    );
    const free = await db.$queryRawUnsafe<{ id: string }[]>(
      `SELECT "id" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'LEVEL' AND "status" = 'ACTIVE' AND "occupiedCount" + "reservedCount" <= "capacity" - 2 ORDER BY random() LIMIT 60`,
      site.id
    );
    writes["relocate a pair to another level"] = await measure(Math.min(60, free.length), (i) =>
      putaway.relocateUnit(db, { opKey: `bench-${randomUUID()}`, unitId: created[i], toLocationId: free[i].id, reason: "Banc de charge" }, ctx)
    );
    writes["quality check passed"] = await measure(60, (i) => units.setUnitQcState(db, { opKey: `bench-${randomUUID()}`, unitId: created[i], qcState: "PASSED" } as any, ctx));
    report.benchBatchId = batch.id;
  }
  report.writes = writes;

  // Last free place: two stations confirm two different pairs on a level with one place left.
  {
    const rounds = 25;
    let exactlyOne = 0;
    let overbooked = 0;
    const batch = await newBatch(1);
    for (let r = 0; r < rounds; r += 1) {
      const lvl = (
        await db.$queryRawUnsafe<{ id: string; capacity: number; occupiedCount: number }[]>(
          `SELECT "id", "capacity", "occupiedCount" FROM "WarehouseLocation" WHERE "siteId" = $1 AND "kind" = 'LEVEL' AND "status" = 'ACTIVE' AND "reservedCount" = 0 AND "occupiedCount" < "capacity" ORDER BY random() LIMIT 1`,
          site.id
        )
      )[0];
      // Fill the level up to capacity - 1 with fresh pairs, then race for the last place.
      const filler = lvl.capacity - 1 - lvl.occupiedCount;
      for (let f = 0; f < filler; f += 1) {
        const u = await batches.receiveUnit(db, { opKey: `bench-${randomUUID()}`, batchId: batch.id, itemId: pick(sample, f).itemId, condition: "NEW" } as any, stationCtx[0]);
        await putaway.confirmPutaway(db, { opKey: `bench-${randomUUID()}`, unitId: u.unit.id, locationId: lvl.id, acceptMismatch: true }, stationCtx[0]);
      }
      const a = await batches.receiveUnit(db, { opKey: `bench-${randomUUID()}`, batchId: batch.id, itemId: sample[0].itemId, condition: "NEW" } as any, stationCtx[0]);
      const b = await batches.receiveUnit(db, { opKey: `bench-${randomUUID()}`, batchId: batch.id, itemId: sample[1].itemId, condition: "NEW" } as any, stationCtx[1]);
      const results = await Promise.allSettled([
        putaway.confirmPutaway(db, { opKey: `bench-${randomUUID()}`, unitId: a.unit.id, locationId: lvl.id, acceptMismatch: true }, stationCtx[0]),
        putaway.confirmPutaway(db, { opKey: `bench-${randomUUID()}`, unitId: b.unit.id, locationId: lvl.id, acceptMismatch: true }, stationCtx[1]),
      ]);
      if (results.filter((x) => x.status === "fulfilled").length === 1) exactlyOne += 1;
      const after = (await db.$queryRawUnsafe<{ over: boolean }[]>(`SELECT ("occupiedCount" + "reservedCount") > "capacity" AS over FROM "WarehouseLocation" WHERE "id" = $1`, lvl.id))[0];
      if (after.over) overbooked += 1;
    }
    report.lastPlaceContention = { rounds, exactlyOneWinner: exactlyOne, overbookedLevels: overbooked };
  }

  // ── 3. Mixed load through the API handlers ─────────────────────────────────
  const secret = new TextEncoder().encode(process.env.JWT_SECRET);
  const sign = (payload: Record<string, unknown>) => new SignJWT(payload).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("2h").sign(secret);
  const staffCookie = `auth_token=${await sign({ role: "logistics" })}`;
  const callStaff = async (method: string, path: string, body?: unknown, station?: string) => {
    const headers: Record<string, string> = { cookie: staffCookie };
    if (body !== undefined) headers["content-type"] = "application/json";
    void station;
    const res = await http.handleStaffRequest(
      new NextRequest(`http://localhost/api/warehouse/${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) }),
      path.split("?")[0].split("/"),
      staffRoutes
    );
    const json = (await res.json()) as any;
    return { status: res.status, data: json?.data, error: json?.error };
  };
  const callPartner = async (cookie: string, path: string) => {
    const res = await partnerApi.handlePartnerRequest(new NextRequest(`http://localhost/api/partners/warehouse/${path}`, { headers: { cookie } }), path.split("?")[0].split("/"));
    const json = (await res.json()) as any;
    return { status: res.status, data: json?.data };
  };

  const runLoad = async (seconds: number) => {
    const lat: Record<string, number[]> = {};
    const firstWindow: Record<string, number[]> = {};
    let errors = 0;
    const errorSamples: string[] = [];
    const started = performance.now();
    const deadline = started + seconds * 1000;
    const rec = (name: string, dt: number, t: number) => {
      (lat[name] ??= []).push(dt);
      if (t - started < 5000) (firstWindow[name] ??= []).push(dt);
    };
    const timedCall = async (name: string, fn: () => Promise<{ status: number; data?: any; error?: any }>) => {
      const t0 = performance.now();
      const r = await fn();
      rec(name, performance.now() - t0, t0);
      if (r.status >= 400) {
        errors += 1;
        if (errorSamples.length < 5) errorSamples.push(`${name}: ${r.status} ${r.error?.code ?? ""} ${r.error?.message ?? ""}`);
      }
      return r;
    };
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const partnerSession = async (idx: number) => {
      const p = partners[idx % partners.length];
      const cookie = `partner_auth=${await sign({ partnerId: p.id, partnerKey: p.key })}`;
      await sleep(Math.random() * 300);
      while (performance.now() < deadline) {
        await timedCall("partner: home summary", () => callPartner(cookie, "summary"));
        const list = await timedCall("partner: my stock page", () => callPartner(cookie, "units?limit=50"));
        await timedCall("partner: stock by variant", () => callPartner(cookie, "units?group=item&limit=50"));
        const firstUnit = list.data?.items?.[Math.floor(Math.random() * (list.data?.items?.length || 1))];
        if (firstUnit) await timedCall("partner: pair detail", () => callPartner(cookie, `units/${firstUnit.id}`));
        if (list.data?.nextCursor) await timedCall("partner: my stock next page", () => callPartner(cookie, `units?limit=50&cursor=${encodeURIComponent(list.data.nextCursor)}`));
        await timedCall("partner: search", () => callPartner(cookie, `units?search=${encodeURIComponent(pick(styles, idx + Math.floor(Math.random() * 50)))}`));
        await timedCall("partner: requests", () => callPartner(cookie, "requests"));
        await sleep(150 + Math.random() * 250);
      }
    };

    const stationSession = async (idx: number) => {
      const batch = await newBatch(idx + 2);
      let i = 0;
      while (performance.now() < deadline) {
        i += 1;
        const item = pick(sample, idx * 131 + i).itemId;
        await timedCall("station: scan GTIN", () => callStaff("GET", `scan?code=${pick(gtins, i)}`));
        const rcv = await timedCall("station: receive pair", () => callStaff("POST", `batches/${batch.id}/receive`, { opKey: `load-${randomUUID()}`, itemId: item, condition: "NEW" }));
        const unit = rcv.data?.unit;
        if (!unit) continue;
        await timedCall("station: scan new QR", () => callStaff("GET", `scan?code=${encodeURIComponent(unit.labelCode)}`));
        await timedCall("station: propose destination", () => callStaff("POST", "putaway/propose", { siteId: site.id, unitIds: [unit.id] }));
        const queue = await timedCall("station: putaway queue of the batch", () => callStaff("GET", `putaway?siteId=${site.id}&batchId=${batch.id}&limit=50`));
        const task = (queue.data?.tasks ?? []).find((t: any) => t.unit.id === unit.id);
        if (task?.proposedLocationId) {
          await timedCall("station: confirm putaway", () => callStaff("POST", "putaway/confirm", { opKey: `load-${randomUUID()}`, unitId: unit.id, locationId: task.proposedLocationId }));
        }
        await timedCall("station: scan old QR", () => callStaff("GET", `scan?code=${encodeURIComponent(pick(sample, i * 7 + idx).labelCode)}`));
        if (i % 5 === 0) await timedCall("station: stock list", () => callStaff("GET", `units?siteId=${site.id}&limit=50`));
        if (i % 10 === 0) await timedCall("station: overview", () => callStaff("GET", `overview?site=${site.id}`));
        await sleep(40);
      }
    };

    const dbBefore = (await db.$queryRawUnsafe<any[]>(`SELECT xact_commit, xact_rollback, blks_read, blks_hit, deadlocks, tup_inserted, tup_updated FROM pg_stat_database WHERE datname = current_database()`))[0];
    const cpu0 = process.cpuUsage();
    await Promise.all([...Array.from({ length: PARTNER_SESSIONS }, (_, i) => partnerSession(i)), ...Array.from({ length: STATIONS }, (_, i) => stationSession(i))]);
    const cpu = process.cpuUsage(cpu0);
    const elapsed = (performance.now() - started) / 1000;
    const dbAfter = (await db.$queryRawUnsafe<any[]>(`SELECT xact_commit, xact_rollback, blks_read, blks_hit, deadlocks, tup_inserted, tup_updated FROM pg_stat_database WHERE datname = current_database()`))[0];
    const all = Object.values(lat).flat();
    const delta = (k: string) => Number(dbAfter[k]) - Number(dbBefore[k]);
    return {
      seconds: Number(elapsed.toFixed(1)),
      partnerSessions: PARTNER_SESSIONS,
      stations: STATIONS,
      requests: all.length,
      requestsPerSecond: Math.round(all.length / elapsed),
      errors,
      errorSamples,
      overall: stat(all),
      first5s: stat(Object.values(firstWindow).flat()),
      writesOnly: stat([...(lat["station: receive pair"] ?? []), ...(lat["station: confirm putaway"] ?? []), ...(lat["station: propose destination"] ?? [])]),
      byRoute: Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, stat(v)])),
      worstRouteP95: Object.entries(lat).map(([k, v]) => [k, stat(v).p95] as const).sort((a, b) => b[1] - a[1])[0],
      nodeCpuSeconds: Number(((cpu.user + cpu.system) / 1e6).toFixed(1)),
      db: {
        commits: delta("xact_commit"),
        rollbacks: delta("xact_rollback"),
        deadlocks: delta("deadlocks"),
        blocksReadFromDisk: delta("blks_read"),
        blocksHitInCache: delta("blks_hit"),
        rowsInserted: delta("tup_inserted"),
        rowsUpdated: delta("tup_updated"),
      },
    };
  };
  report.load = await runLoad(SECONDS);
  report.load.p95Under1s = report.load.overall.p95 < 1000 && Object.values(report.load.byRoute as Record<string, Stat>).every((s) => s.p95 < 1000);

  // ── 4. Safety after the run ────────────────────────────────────────────────
  const reconcileAfter = await getStockReconciliation(db);
  const created = await n1(`SELECT count(*) AS n FROM "WarehouseUnit" WHERE "createdAt" >= $1::timestamptz`, report.at);
  report.integrity = {
    unitsBefore: reconcileBefore.totalUnits,
    unitsAfter: reconcileAfter.totalUnits,
    createdDuringBench: created,
    reconciles: reconcileAfter.totalUnits === reconcileBefore.totalUnits + created,
    distinctIdsEqualUnits: reconcileAfter.distinctIds === reconcileAfter.totalUnits,
    labelCodes: await n1(`SELECT count(*) AS n FROM "WarehouseLabelCode"`),
    distinctLabelCodes: await n1(`SELECT count(DISTINCT "code") AS n FROM "WarehouseLabelCode"`),
    unitsWithoutRegistryRow: await n1(`SELECT count(*) AS n FROM "WarehouseUnit" u WHERE NOT EXISTS (SELECT 1 FROM "WarehouseLabelCode" c WHERE c."code" = u."labelCode")`),
    unitsWithoutJournalRow: await n1(`SELECT count(*) AS n FROM "WarehouseUnit" u WHERE NOT EXISTS (SELECT 1 FROM "WarehouseLabelJournal" j WHERE j."code" = u."labelCode")`),
    overCapacityLevels: await n1(`SELECT count(*) AS n FROM "WarehouseLocation" WHERE "kind" = 'LEVEL' AND "occupiedCount" + "reservedCount" > "capacity"`),
    overCapacityOtherPositions: await n1(`SELECT count(*) AS n FROM "WarehouseLocation" WHERE "kind" <> 'LEVEL' AND "capacity" IS NOT NULL AND "occupiedCount" + "reservedCount" > "capacity"`),
    occupancyCounterDrift: await n1(
      `SELECT count(*) AS n FROM "WarehouseLocation" l WHERE l."holdsUnits" AND l."occupiedCount" <> (SELECT count(*) FROM "WarehouseUnit" u WHERE u."currentLocationId" = l."id")`
    ),
    reservationCounterDrift: await n1(
      `SELECT count(*) AS n FROM "WarehouseLocation" l WHERE l."holdsUnits" AND l."reservedCount" <> (SELECT count(*) FROM "WarehousePutawayTask" t WHERE t."proposedLocationId" = l."id" AND t."status" = 'RESERVED')`
    ),
    unitsInTwoPlaces: await n1(`SELECT count(*) AS n FROM (SELECT "id" FROM "WarehouseUnit" GROUP BY "id" HAVING count(*) > 1) x`),
    pairsWithTwoActiveTasks: await n1(`SELECT count(*) AS n FROM (SELECT "unitId" FROM "WarehousePutawayTask" WHERE "status" IN ('PENDING','RESERVED') GROUP BY 1 HAVING count(*) > 1) x`),
  };
  // Registry: a duplicate code is refused by the database itself, and issuance continues.
  let duplicateRefused = false;
  try {
    await db.$executeRawUnsafe(`INSERT INTO "WarehouseLabelCode" ("code", "unitId", "format", "isOriginal", "issuingSiteCode") VALUES ($1, $2, 'UUID_SITE_V1', true, $3)`, sample[0].labelCode, sample[1].id, site.code);
  } catch {
    duplicateRefused = true;
  }
  let reissueRefused = false;
  try {
    await db.$executeRawUnsafe(`UPDATE "WarehouseLabelCode" SET "unitId" = $2 WHERE "code" = $1`, sample[0].labelCode, sample[1].id);
  } catch {
    reissueRefused = true;
  }
  const beyond = await batches.receiveUnit(db, { opKey: `bench-${randomUUID()}`, batchId: report.benchBatchId, itemId: sample[0].itemId, condition: "NEW" } as any, stationCtx[0]);
  const beyondScan = await units.resolveScan(db, beyond.unit.labelCode);
  report.registry = {
    codesBeforeNewIssue: report.integrity.labelCodes,
    duplicateCodeRefusedByDatabase: duplicateRefused,
    codeReassignmentRefusedByDatabase: reissueRefused,
    newCodeIssuedAfterTier: beyond.unit.labelCode,
    newCodeScansToItsUuid: beyondScan.kind === "UNIT" && beyondScan.unit.id === beyond.unit.id,
  };

  // ── 5. Sizes ───────────────────────────────────────────────────────────────
  const sizes = await db.$queryRawUnsafe<{ table: string; rows: bigint; table_mb: string; index_mb: string; total_mb: string }[]>(
    `SELECT c.relname AS "table", c.reltuples::bigint AS rows,
            round(pg_table_size(c.oid) / 1048576.0, 1)::text AS table_mb, round(pg_indexes_size(c.oid) / 1048576.0, 1)::text AS index_mb,
            round(pg_total_relation_size(c.oid) / 1048576.0, 1)::text AS total_mb
     FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'Warehouse%' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 12`
  );
  report.sizes = sizes.map((s) => ({ table: s.table, rows: Number(s.rows), tableMb: Number(s.table_mb), indexMb: Number(s.index_mb), totalMb: Number(s.total_mb) }));
  report.totalWarehouseMb = Number(
    (await db.$queryRawUnsafe<{ mb: string }[]>(
      `SELECT round(sum(pg_total_relation_size(c.oid)) / 1048576.0, 1)::text AS mb FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname LIKE 'Warehouse%'`
    ))[0].mb
  );
  report.slowestRead = Object.entries(reads).map(([k, v]) => ({ name: k, p95: v.p95 })).sort((a, b) => b.p95 - a.p95).slice(0, 5);
  report.environment = { node: process.version, platform: `${process.platform}/${process.arch}`, postgres: (await db.$queryRawUnsafe<{ v: string }[]>(`SHOW server_version`))[0].v, note: "Local workstation, isolated PostgreSQL cluster, synthetic data. Not the VPS." };

  const json = JSON.stringify(report, (_k, v) => (typeof v === "bigint" ? Number(v) : v), 2);
  if (OUT) writeFileSync(OUT, json);
  const brief = {
    label: LABEL,
    dataset: report.dataset,
    slowestRead: report.slowestRead,
    writes: Object.fromEntries(Object.entries(writes).map(([k, v]) => [k, `p50 ${v.p50} / p95 ${v.p95} ms`])),
    parallelScans: report.parallelScans,
    load: { ...report.load, byRoute: undefined, worst: report.load.worstRouteP95 },
    codeLookupUsesIndex: report.plans.codeLookupUsesIndex,
    partnerListSeqScan: report.plans.partnerListSeqScan,
    lastPlaceContention: report.lastPlaceContention,
    integrity: report.integrity,
    registry: report.registry,
    totalWarehouseMb: report.totalWarehouseMb,
  };
  console.log(JSON.stringify(brief, null, 2));
  await db.$disconnect();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
