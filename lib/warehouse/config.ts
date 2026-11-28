/**
 * Module switches (env, same convention as PARTNER_SELF_FULFILL_ENABLED / GALAXUS_*_DISABLED).
 *
 * WAREHOUSE_MODULE_ENABLED   off → nav hidden, every /api/warehouse and partner stock API answers 404.
 * WAREHOUSE_WRITES_ENABLED   off → read-only: lookups, lists and already-issued QR codes still resolve;
 *                            every mutation is refused (stop switch that keeps verified data readable).
 * WAREHOUSE_PARTNER_ALLOWLIST  comma-separated partner keys that see "Mon stock" (empty = all partners).
 * WAREHOUSE_PILOT_SITES      comma-separated site codes where operations are allowed (empty = all).
 *
 * Lot 1 has NO outbound connector: nothing in lib/warehouse imports Shopify / Galaxus / EDI /
 * Swiss Post / feed code (enforced by lib/warehouse/__tests__/isolation.test.ts).
 */

function flag(name: string, fallback: boolean): boolean {
  const raw = String(process.env[name] ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function list(name: string): string[] {
  return String(process.env[name] ?? "")
    .split(",")
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);
}

function int(name: string, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(String(process.env[name] ?? ""), 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

export function isWarehouseModuleEnabled(): boolean {
  return flag("WAREHOUSE_MODULE_ENABLED", false);
}

export function isWarehouseWritesEnabled(): boolean {
  return isWarehouseModuleEnabled() && flag("WAREHOUSE_WRITES_ENABLED", true);
}

export function isPartnerAllowedForWarehouse(partnerKey: string): boolean {
  if (!isWarehouseModuleEnabled()) return false;
  const allow = list("WAREHOUSE_PARTNER_ALLOWLIST");
  if (allow.length === 0) return true;
  return allow.includes(String(partnerKey ?? "").trim().toUpperCase());
}

export function isSiteInPilot(siteCode: string): boolean {
  const sites = list("WAREHOUSE_PILOT_SITES");
  if (sites.length === 0) return true;
  return sites.includes(String(siteCode ?? "").trim().toUpperCase());
}

/** How long a proposed destination holds capacity before it is released (minutes). */
export function reservationTtlMinutes(): number {
  return int("WAREHOUSE_RESERVATION_TTL_MINUTES", 8 * 60, 1, 7 * 24 * 60);
}

/** A claimed print job with no answer after this delay becomes UNCERTAIN (never auto-resent). */
export function printClaimTimeoutSeconds(): number {
  return int("WAREHOUSE_PRINT_CLAIM_TIMEOUT_SECONDS", 90, 5, 3600);
}

/**
 * When on, a pair label can only be queued for printing once its issuance journal entry has
 * reached the independent sink (protects QR codes issued after the last DB backup).
 */
export function isLabelJournalEnforced(): boolean {
  return flag("WAREHOUSE_LABEL_JOURNAL_ENFORCE", false);
}

export function labelJournalDir(): string | null {
  const dir = String(process.env.WAREHOUSE_LABEL_JOURNAL_DIR ?? "").trim();
  return dir || null;
}

/** Putaway tasks older than this are reported as stale on the overview (hours). */
export function staleTaskHours(): number {
  return int("WAREHOUSE_STALE_TASK_HOURS", 24, 1, 24 * 30);
}

export function warehouseFlagsSnapshot() {
  return {
    moduleEnabled: isWarehouseModuleEnabled(),
    writesEnabled: isWarehouseWritesEnabled(),
    partnerAllowlist: list("WAREHOUSE_PARTNER_ALLOWLIST"),
    pilotSites: list("WAREHOUSE_PILOT_SITES"),
    reservationTtlMinutes: reservationTtlMinutes(),
    printClaimTimeoutSeconds: printClaimTimeoutSeconds(),
    labelJournalEnforced: isLabelJournalEnforced(),
    labelJournalDir: labelJournalDir(),
    /** Lot 1: there is no channel connector in this module. */
    outboundConnectors: "none" as const,
  };
}
