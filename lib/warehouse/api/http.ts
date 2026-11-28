import { SignJWT, jwtVerify } from "jose";
import { NextRequest, NextResponse } from "next/server";
import { getStaffRoleFromRequest } from "@/app/lib/staffAuth";
import { isWarehouseModuleEnabled } from "../config";
import { getWarehouseDb, toPlain, type WarehouseDb } from "../db";
import { WarehouseError, isWarehouseError } from "../errors";
import { isOperatorActive } from "../operators";
import { authenticateStation } from "../printing";
import type { ActorContext, StaffRole } from "../types";

/**
 * HTTP plumbing shared by the staff and partner warehouse APIs.
 *
 * Response envelope: `{ ok: true, data }` or `{ ok: false, error: { code, message, details } }`.
 * Errors never echo tokens, credentials or customer data; unexpected errors are logged with the
 * route name only and answered with a generic message.
 */

export const OPERATOR_HEADER = "x-warehouse-operator";
export const STATION_HEADER = "x-warehouse-station";

export type Station = { id: string; siteId: string; siteCode: string; code: string; name: string };

export type StaffCall = {
  req: NextRequest;
  db: WarehouseDb;
  role: StaffRole;
  ctx: ActorContext;
  station: Station | null;
  params: Record<string, string>;
  query: URLSearchParams;
  body: Record<string, any>;
};

const NO_STORE = { "Cache-Control": "no-store" };

export function ok(data: unknown, init: { status?: number } = {}): NextResponse {
  return NextResponse.json({ ok: true, data: toPlain(data) }, { status: init.status ?? 200, headers: NO_STORE });
}

/**
 * C29 — the database refuses writes (read-only after a failover, disk full) or cannot be reached.
 * The operator must not keep sticking labels on the strength of a generic "retry": say plainly
 * that nothing was recorded and that the outage procedure applies.
 */
export function classifyStorageError(err: unknown): "READ_ONLY" | "DISK_FULL" | "OVERLOADED" | "UNREACHABLE" | null {
  const e = err as { code?: string; message?: string; meta?: { code?: string; message?: string } } | null;
  const text = `${e?.code ?? ""} ${e?.meta?.code ?? ""} ${e?.message ?? ""} ${e?.meta?.message ?? ""}`;
  if (/\b25006\b|read-only transaction|cannot execute .* in a read-only/i.test(text)) return "READ_ONLY";
  if (/\b53100\b|No space left on device|could not extend file|disk full/i.test(text)) return "DISK_FULL";
  if (/\b53300\b|\b53200\b|too many connections|remaining connection slots|out of memory|P2024|Timed out fetching a new connection/i.test(text)) return "OVERLOADED";
  if (/P1001|P1002|P1008|P1017|Can't reach database server|Connection terminated|ECONNREFUSED|ECONNRESET|Server has closed the connection/i.test(text)) return "UNREACHABLE";
  return null;
}

const STORAGE_MESSAGES: Record<string, string> = {
  READ_ONLY: "La base est en lecture seule : rien n'a été enregistré. Ne collez plus d'étiquette, gardez les boîtes à part et prévenez le responsable (procédure de panne).",
  DISK_FULL: "Le disque de la base est plein : rien n'a été enregistré. Ne collez plus d'étiquette, gardez les boîtes à part et prévenez le responsable (procédure de panne).",
  OVERLOADED: "La base est saturée : rien n'a été enregistré. Attendez une minute puis rescannez ; si cela persiste, prévenez le responsable.",
  UNREACHABLE: "La base est injoignable : rien n'a été enregistré. Gardez les boîtes à part ; reprenez les scans quand la connexion revient.",
};

export function fail(err: unknown, route: string, opKey?: string | null): NextResponse {
  if (isWarehouseError(err)) {
    return NextResponse.json(
      { ok: false, error: { code: err.code, message: err.message, details: toPlain(err.details ?? null) } },
      { status: err.status, headers: NO_STORE }
    );
  }
  // Never log request bodies, headers or tokens. The action key is not a secret: it ties this line
  // to the operator's gesture and to the operation ledger (C22).
  const key = typeof opKey === "string" && /^[A-Za-z0-9:_.-]{8,120}$/.test(opKey) ? ` opKey=${opKey}` : "";
  console.error(`[warehouse] ${route}${key}:`, (err as Error)?.message ?? err);
  const storage = classifyStorageError(err);
  if (storage) {
    return NextResponse.json(
      { ok: false, error: { code: "STORAGE_UNAVAILABLE", message: STORAGE_MESSAGES[storage], details: { reason: storage, nothingWritten: true } } },
      { status: 503, headers: NO_STORE }
    );
  }
  return NextResponse.json(
    { ok: false, error: { code: "INTERNAL", message: "Erreur technique : rien n'a été enregistré. Réessayer.", details: null } },
    { status: 500, headers: NO_STORE }
  );
}

export function moduleDisabledResponse(): NextResponse {
  return NextResponse.json(
    { ok: false, error: { code: "MODULE_DISABLED", message: "Module Entrepôt désactivé.", details: null } },
    { status: 404, headers: NO_STORE }
  );
}

function operatorSecret(): Uint8Array {
  const raw = String(process.env.JWT_SECRET ?? "").trim();
  if (raw.length >= 8) return new TextEncoder().encode(raw);
  if (process.env.NODE_ENV !== "production") return new TextEncoder().encode("warehouse-operator-local-dev-only");
  throw new WarehouseError("UNAUTHORIZED", "Signature opérateur non configurée.", 500);
}

/** Short-lived proof that a named person identified at this device (12 h = one shift). */
export async function signOperatorToken(operator: { id: string; name: string }): Promise<string> {
  return new SignJWT({ operatorId: operator.id, name: operator.name, aud: "warehouse-operator" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(operatorSecret());
}

async function readOperator(req: NextRequest, db: WarehouseDb): Promise<string | null> {
  const token = req.headers.get(OPERATOR_HEADER);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, operatorSecret());
    if (payload.aud !== "warehouse-operator" || typeof payload.operatorId !== "string") return null;
    // A deactivated operator loses access immediately, even with a valid token.
    return (await isOperatorActive(db, payload.operatorId)) ? payload.operatorId : null;
  } catch {
    return null;
  }
}

export type Method = "GET" | "POST" | "PATCH";
export type StaffRoute = {
  method: Method;
  path: string;
  /** Admin-only configuration or sensitive correction. */
  admin?: boolean;
  /** Mutating scan/stock gesture: a named operator is required as soon as operators exist. */
  operator?: boolean;
  /** Called by the print agent with the station credential. */
  station?: boolean;
  handler: (call: StaffCall) => Promise<unknown>;
};

type Compiled<R> = R & { regex: RegExp; keys: string[] };

export function compileRoutes<R extends { path: string }>(routes: R[]): Compiled<R>[] {
  return routes.map((r) => {
    const keys: string[] = [];
    const pattern = r.path
      .split("/")
      .filter(Boolean)
      .map((seg) => {
        if (seg.startsWith(":")) {
          keys.push(seg.slice(1));
          return "([^/]+)";
        }
        return seg.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      })
      .join("/");
    return { ...r, regex: new RegExp(`^${pattern}$`), keys };
  });
}

export function matchRoute<R extends { method: string }>(
  routes: Compiled<R & { path: string }>[],
  method: string,
  segments: string[]
): { route: Compiled<R & { path: string }>; params: Record<string, string> } | null {
  const path = segments.map((s) => decodeURIComponent(s)).join("/");
  for (const route of routes) {
    if (route.method !== method) continue;
    const m = route.regex.exec(path);
    if (!m) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((k, i) => (params[k] = m[i + 1]));
    return { route, params };
  }
  return null;
}

async function readBody(req: NextRequest): Promise<Record<string, any>> {
  if (req.method === "GET") return {};
  const text = await req.text();
  if (!text) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    throw new WarehouseError("INVALID_INPUT", "Corps de requête JSON invalide.", 400);
  }
}

let operatorsExistCache: { at: number; value: boolean } | null = null;
async function operatorsExist(db: WarehouseDb): Promise<boolean> {
  if (operatorsExistCache && Date.now() - operatorsExistCache.at < 15_000) return operatorsExistCache.value;
  const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "WarehouseOperator" WHERE "active" = true`;
  operatorsExistCache = { at: Date.now(), value: rows[0].n > 0 };
  return operatorsExistCache.value;
}

/** Entry point of `app/api/warehouse/[...path]/route.ts`. */
export async function handleStaffRequest(
  req: NextRequest,
  segments: string[],
  routes: Compiled<StaffRoute>[]
): Promise<NextResponse> {
  const label = `${req.method} /${segments.join("/")}`;
  let opKey: string | null = null;
  try {
    if (!isWarehouseModuleEnabled()) return moduleDisabledResponse();
    const matched = matchRoute(routes, req.method, segments);
    if (!matched) throw new WarehouseError("NOT_FOUND", "Route inconnue.", 404);
    const { route, params } = matched;
    const db = await getWarehouseDb();

    const station = await authenticateStation(db, req.headers.get(STATION_HEADER));
    let role = await getStaffRoleFromRequest(req);
    if (route.station) {
      // The print agent runs inside a staff browser session AND proves which station it is.
      if (!station) throw new WarehouseError("UNAUTHORIZED", "Poste non appairé ou appairage révoqué.", 401);
    }
    if (!role) throw new WarehouseError("UNAUTHORIZED", "Connexion requise.", 401);
    if (route.admin && role !== "admin") throw new WarehouseError("FORBIDDEN", "Réservé à l'administration.", 403);
    role = role as StaffRole;

    const operatorId = await readOperator(req, db);
    if (route.operator && !operatorId && (await operatorsExist(db))) {
      throw new WarehouseError("UNAUTHORIZED", "Identifiez-vous (opérateur) avant ce geste.", 401, { operatorRequired: true });
    }
    const body = await readBody(req);
    opKey = typeof body?.opKey === "string" ? body.opKey : null;
    const call: StaffCall = {
      req,
      db,
      role,
      ctx: { role, operatorId, stationId: station?.id ?? null },
      station,
      params,
      query: req.nextUrl.searchParams,
      body,
    };
    const result = await route.handler(call);
    if (result instanceof NextResponse) return result;
    return ok(result);
  } catch (err) {
    return fail(err, label, opKey);
  }
}

/** Invalidate the "operators exist" cache after an operator is created or changed. */
export function resetOperatorCache(): void {
  operatorsExistCache = null;
}

// ---- small typed readers ----

export const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s === "" ? undefined : s;
};
export const reqStr = (v: unknown, what: string): string => {
  const s = str(v);
  if (!s) throw new WarehouseError("INVALID_INPUT", `${what} requis.`, 400);
  return s;
};
export const int = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number.parseInt(String(v), 10);
  return Number.isFinite(n) ? Math.trunc(n) : undefined;
};
export const reqInt = (v: unknown, what: string): number => {
  const n = int(v);
  if (n === undefined) throw new WarehouseError("INVALID_INPUT", `${what} : nombre entier requis.`, 400);
  return n;
};
export const bool = (v: unknown): boolean => v === true || v === "true" || v === "1" || v === 1;
export const list = (v: unknown): string[] | undefined => {
  if (Array.isArray(v)) return v.map((x) => String(x).trim()).filter(Boolean);
  const s = str(v);
  return s ? s.split(",").map((x) => x.trim()).filter(Boolean) : undefined;
};

export function fileResponse(body: string | Buffer, contentType: string, filename?: string): NextResponse {
  const headers: Record<string, string> = { "Content-Type": contentType, ...NO_STORE };
  if (filename) headers["Content-Disposition"] = `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`;
  const payload = typeof body === "string" ? body : new Uint8Array(body);
  return new NextResponse(payload, { status: 200, headers });
}
