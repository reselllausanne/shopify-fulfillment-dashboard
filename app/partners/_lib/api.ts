/**
 * Typed client of the partner stock API (`/api/partners/warehouse/...`).
 *
 * Types only are imported from `lib/warehouse` (erased at build time): no runtime code from the
 * domain layer may reach a client bundle. The partner is always decided by the session cookie;
 * no function here accepts or sends a partner identifier.
 */
import type {
  PartnerItemGroup,
  PartnerStockSummary,
  PartnerUnitDetail,
  PartnerUnitRow,
  PartnerUnitStatus,
} from "@/lib/warehouse/partnerView";
import type { PartnerRequestRow } from "@/lib/warehouse/pricing";

export type {
  PartnerItemGroup,
  PartnerRequestRow,
  PartnerStockSummary,
  PartnerUnitDetail,
  PartnerUnitRow,
  PartnerUnitStatus,
};

export type PartnerRequestType = PartnerRequestRow["type"];
export type PartnerRequestStatus = PartnerRequestRow["status"];

const BASE = "/api/partners/warehouse";

export class PartnerApiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details: unknown;

  constructor(code: string, message: string, status: number, details: unknown = null) {
    super(message);
    this.name = "PartnerApiError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export function isModuleDisabled(err: unknown): boolean {
  return err instanceof PartnerApiError && err.code === "MODULE_DISABLED";
}

export function isNotFound(err: unknown): boolean {
  return err instanceof PartnerApiError && err.code === "NOT_FOUND";
}

/** French message to show for any thrown value (API messages are shown as they are). */
export function errorMessage(err: unknown): string {
  if (err instanceof PartnerApiError) return err.message;
  return "Une erreur inattendue est survenue. Réessayez dans un instant.";
}

/** Same behaviour as the portal layout: an expired session goes back to the partner login. */
export function redirectToPartnerLogin(): void {
  if (typeof window === "undefined") return;
  const { pathname, search } = window.location;
  if (pathname.startsWith("/partners/login")) return;
  const callbackUrl = encodeURIComponent(`${pathname}${search}`);
  window.location.assign(`/partners/login?callbackUrl=${callbackUrl}`);
}

async function send(path: string, init?: RequestInit): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(`${BASE}/${path}`, { cache: "no-store", credentials: "same-origin", ...init });
  } catch {
    throw new PartnerApiError("NETWORK", "Connexion impossible. Vérifiez votre réseau puis réessayez.", 0);
  }
  if (res.status === 401) {
    redirectToPartnerLogin();
    throw new PartnerApiError("UNAUTHORIZED", "Connexion requise.", 401);
  }
  return res;
}

async function failure(res: Response): Promise<PartnerApiError> {
  const body = await res.json().catch(() => null);
  const err = body && typeof body === "object" ? (body as { error?: { code?: string; message?: string; details?: unknown } }).error : null;
  return new PartnerApiError(
    err?.code ?? `HTTP_${res.status}`,
    err?.message ?? "Le service ne répond pas correctement. Réessayez dans un instant.",
    res.status,
    err?.details ?? null
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await send(path, { ...init, headers: { Accept: "application/json", ...(init?.headers ?? {}) } });
  const body = await res.clone().json().catch(() => null);
  if (res.ok && body && typeof body === "object" && (body as { ok?: boolean }).ok === true) {
    return (body as { data: T }).data;
  }
  throw await failure(res);
}

function query(params: Record<string, string | number | boolean | null | undefined>): string {
  const q = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === null || value === undefined || value === "" || value === false) continue;
    q.set(key, value === true ? "1" : String(value));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

export type UnitFilters = {
  search?: string;
  status?: PartnerUnitStatus | null;
  itemId?: string | null;
  includeOut?: boolean;
};

export type UnitPage = { items: PartnerUnitRow[]; nextCursor: string | null };
export type ItemGroupPage = { items: PartnerItemGroup[]; hasMore: boolean };

export type CreateRequestInput = {
  unitId?: string | null;
  type: PartnerRequestType;
  message: string;
  /** Decimal string with a dot, e.g. "189.00". Required by the API for PRICE_CHANGE. */
  requestedPublicPrice?: string | null;
};

export const partnerApi = {
  summary: () => request<PartnerStockSummary>("summary"),

  units: (filters: UnitFilters & { limit?: number; cursor?: string | null } = {}) =>
    request<UnitPage>(
      `units${query({
        search: filters.search,
        status: filters.status,
        itemId: filters.itemId,
        includeOut: filters.includeOut,
        limit: filters.limit,
        cursor: filters.cursor,
      })}`
    ),

  unitGroups: (filters: UnitFilters & { limit?: number; offset?: number } = {}) =>
    request<ItemGroupPage>(
      `units${query({
        group: "item",
        search: filters.search,
        status: filters.status,
        itemId: filters.itemId,
        includeOut: filters.includeOut,
        limit: filters.limit,
        offset: filters.offset,
      })}`
    ),

  unit: (unitId: string) => request<PartnerUnitDetail>(`units/${encodeURIComponent(unitId)}`),

  requests: (opts: { status?: PartnerRequestStatus | null; limit?: number } = {}) =>
    request<PartnerRequestRow[]>(`requests${query({ status: opts.status, limit: opts.limit })}`),

  createRequest: (input: CreateRequestInput) =>
    request<{ id: string }>("requests", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId: input.unitId || undefined,
        type: input.type,
        message: input.message,
        requestedPublicPrice: input.requestedPublicPrice || undefined,
      }),
    }),

  /** Downloads the CSV statement of the partner's stock (same filters as the list). */
  async exportCsv(filters: UnitFilters = {}): Promise<void> {
    const res = await send(
      `units/export${query({
        search: filters.search,
        status: filters.status,
        itemId: filters.itemId,
        includeOut: filters.includeOut,
      })}`
    );
    if (!res.ok) throw await failure(res);
    const blob = await res.blob();
    const disposition = res.headers.get("content-disposition") ?? "";
    const match = disposition.match(/filename\*=UTF-8''([^;]+)/i) || disposition.match(/filename="?([^";]+)"?/i);
    let filename = "mon-stock.csv";
    if (match?.[1]) {
      try {
        filename = decodeURIComponent(match[1]);
      } catch {
        filename = match[1];
      }
    }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
