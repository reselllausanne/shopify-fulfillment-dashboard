"use client";

/**
 * Typed client of the staff warehouse API (`/api/warehouse/...`).
 *
 * - Envelope `{ ok, data }` / `{ ok:false, error:{ code, message, details } }`.
 * - Sends the operator token and the station credential when this browser has them.
 * - A 401 with `details.operatorRequired` opens the operator picker (registered by the
 *   provider) and replays the SAME request (same body, same opKey).
 * - A network failure or a timeout is reported as `WhError` with `fateUnknown` so the caller
 *   keeps its opKey and retries with it.
 */

export const OPERATOR_STORAGE_KEY = "warehouse.operator.v1";
export const STATION_STORAGE_KEY = "warehouse.station.v1";
export const SITE_STORAGE_KEY = "warehouse.site.v1";
export const MUTE_STORAGE_KEY = "warehouse.mute.v1";
export const AGENT_PAUSE_STORAGE_KEY = "warehouse.agentPaused.v1";

export type StoredOperator = { operatorId: string; name: string; token: string };
export type StoredStation = { stationId: string; code: string; name: string; credential: string };

export class WhError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: Record<string, unknown> | null;
  /** True when the request may or may not have reached the server (network error, timeout, 5xx gateway). */
  readonly fateUnknown: boolean;

  constructor(code: string, message: string, status: number, details: Record<string, unknown> | null = null, fateUnknown = false) {
    super(message);
    this.name = "WhError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.fateUnknown = fateUnknown;
  }
}

export function isWhError(err: unknown): err is WhError {
  return err instanceof WhError;
}

export function errorMessage(err: unknown): string {
  if (isWhError(err)) return err.message;
  if (err instanceof Error && err.message) return err.message;
  return "Erreur inattendue.";
}

function readJson<T>(key: string): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

export function loadOperator(): StoredOperator | null {
  const v = readJson<StoredOperator>(OPERATOR_STORAGE_KEY);
  return v && v.operatorId && v.token ? v : null;
}
export function saveOperator(op: StoredOperator | null): void {
  if (typeof window === "undefined") return;
  if (op) window.localStorage.setItem(OPERATOR_STORAGE_KEY, JSON.stringify(op));
  else window.localStorage.removeItem(OPERATOR_STORAGE_KEY);
}
export function loadStation(): StoredStation | null {
  const v = readJson<StoredStation>(STATION_STORAGE_KEY);
  return v && v.stationId && v.credential ? v : null;
}
export function saveStation(st: StoredStation | null): void {
  if (typeof window === "undefined") return;
  if (st) window.localStorage.setItem(STATION_STORAGE_KEY, JSON.stringify(st));
  else window.localStorage.removeItem(STATION_STORAGE_KEY);
}

// ---- hooks registered by the provider ----

type Listeners = {
  /** Opens the operator picker; resolves true once an operator is identified. */
  requestOperator: (() => Promise<boolean>) | null;
  onWritesDisabled: (() => void) | null;
  onModuleDisabled: (() => void) | null;
};
const listeners: Listeners = { requestOperator: null, onWritesDisabled: null, onModuleDisabled: null };

export function registerApiListeners(next: Partial<Listeners>): () => void {
  Object.assign(listeners, next);
  return () => {
    for (const k of Object.keys(next) as (keyof Listeners)[]) {
      if (listeners[k] === next[k]) listeners[k] = null;
    }
  };
}

// ---- requests ----

export type Query = Record<string, string | number | boolean | null | undefined>;

export function whUrl(path: string, query?: Query): string {
  const clean = path.replace(/^\/+/, "");
  const params = new URLSearchParams();
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === "") continue;
      params.set(k, String(v));
    }
  }
  const qs = params.toString();
  return `/api/warehouse/${clean}${qs ? `?${qs}` : ""}`;
}

type RequestOptions = {
  query?: Query;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Do not open the operator picker on 401 (background polling). */
  silent?: boolean;
};

const DEFAULT_TIMEOUT_MS = 25_000;

async function request<T>(method: "GET" | "POST" | "PATCH", path: string, body: unknown, opts: RequestOptions = {}, attempt = 0): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  const operator = loadOperator();
  const station = loadStation();
  if (operator?.token) headers["x-warehouse-operator"] = operator.token;
  if (station?.credential) headers["x-warehouse-station"] = station.credential;
  if (method !== "GET") headers["content-type"] = "application/json";

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onOuterAbort = () => controller.abort();
  opts.signal?.addEventListener("abort", onOuterAbort);

  let res: Response;
  try {
    res = await fetch(whUrl(path, opts.query), {
      method,
      headers,
      body: method === "GET" ? undefined : JSON.stringify(body ?? {}),
      cache: "no-store",
      credentials: "same-origin",
      signal: controller.signal,
    });
  } catch (err) {
    if (opts.signal?.aborted) throw new WhError("ABORTED", "Requête annulée.", 0, null, false);
    const timedOut = controller.signal.aborted;
    throw new WhError(
      timedOut ? "TIMEOUT" : "NETWORK",
      timedOut ? "Le serveur ne répond pas. Le résultat de l'action est inconnu." : "Connexion perdue.",
      0,
      { cause: (err as Error)?.message ?? null },
      true
    );
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  let payload: any = null;
  try {
    payload = await res.json();
  } catch {
    payload = null;
  }

  if (res.ok && payload && payload.ok === true) return payload.data as T;

  const error = payload && payload.ok === false && payload.error ? payload.error : null;
  if (!error) {
    // Not our envelope: proxy / gateway / auth redirect. The fate of a write is unknown on 5xx.
    if (res.status === 401 || res.status === 403) {
      throw new WhError("UNAUTHORIZED", "Session expirée : reconnectez-vous.", res.status);
    }
    throw new WhError("HTTP_ERROR", `Réponse inattendue du serveur (${res.status}).`, res.status, null, res.status >= 502);
  }

  const details = (error.details && typeof error.details === "object" ? error.details : null) as Record<string, unknown> | null;
  const whErr = new WhError(String(error.code ?? "ERROR"), String(error.message ?? "Erreur."), res.status, details, false);

  if (whErr.code === "MODULE_DISABLED") listeners.onModuleDisabled?.();
  if (whErr.code === "WRITES_DISABLED") listeners.onWritesDisabled?.();

  if (res.status === 401 && details?.operatorRequired && !opts.silent && attempt === 0 && listeners.requestOperator) {
    const identified = await listeners.requestOperator();
    // Same method, same path, same body: the opKey is unchanged.
    if (identified) return request<T>(method, path, body, opts, attempt + 1);
  }
  throw whErr;
}

export function whGet<T>(path: string, query?: Query, opts: Omit<RequestOptions, "query"> = {}): Promise<T> {
  return request<T>("GET", path, undefined, { ...opts, query });
}
export function whPost<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  return request<T>("POST", path, body ?? {}, opts);
}
export function whPatch<T>(path: string, body?: unknown, opts: RequestOptions = {}): Promise<T> {
  return request<T>("PATCH", path, body ?? {}, opts);
}

// ---- action keys ----

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  // Non-secure context (plain http on the LAN): build a v4 from getRandomValues.
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** One key per real physical action. Never call this for a retry. */
export function newOpKey(prefix: string): string {
  return `${prefix}-${uuid()}`;
}

export type OperationLookup<T> = { found: boolean; kind?: string; result?: T; createdAt?: string };

/** What happened to a gesture whose answer was lost? `found:false` = nothing was recorded. */
export function lookupOperation<T>(opKey: string): Promise<OperationLookup<T>> {
  return whGet<OperationLookup<T>>(`operations/${encodeURIComponent(opKey)}`, undefined, { silent: true });
}

/**
 * Send a gesture carrying an opKey. On a network error / timeout the SAME body is retried
 * (the server replays the stored result). Business errors are thrown immediately.
 */
/** Fired on the window after a gesture was recorded: counters shown elsewhere on the screen refresh at once. */
export const STOCK_CHANGED_EVENT = "warehouse:stock-changed";

export async function whGesture<T>(path: string, body: { opKey: string } & Record<string, unknown>, opts: { retries?: number; timeoutMs?: number } = {}): Promise<T> {
  // Short timeout + one automatic retry: on the floor, a frozen screen is worse than "Vérifier".
  const retries = opts.retries ?? 1;
  const timeoutMs = opts.timeoutMs ?? 12_000;
  let lastErr: unknown = null;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const result = await whPost<T>(path, body, { timeoutMs });
      if (typeof window !== "undefined") window.dispatchEvent(new Event(STOCK_CHANGED_EVENT));
      return result;
    } catch (err) {
      lastErr = err;
      if (!isWhError(err) || !err.fateUnknown) throw err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw lastErr;
}
