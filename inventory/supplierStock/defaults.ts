import type { SupplierStockPolicyStatus } from "./types";
import { HEAVY_PLATFORMS, resolveScrapeIntervalHours } from "./types";

export type SupplierSeed = {
  supplierKey: string;
  supplierCode: string;
  displayName: string;
  status: SupplierStockPolicyStatus;
  heavySource?: boolean;
};

const DISPLAY_NAMES: Record<string, string> = {
  wel: "WellPlayed",
  rei: "Reichelt",
  bae: "Bächli",
  fan: "FantasyWelt",
  exl: "Ex Libris",
  haw: "Hawk",
  wrk: "Warenkontor",
  bwz: "Baby-Walz",
  tus: "The Uncommon Shop",
  alt: "Alternate",
  ven: "Venova",
  hhv: "HHV",
  snl: "Snowleader",
  nso: "Newsole",
};

const SEED_KEYS = ["wel", "rei", "bae", "fan", "exl", "haw", "wrk", "bwz", "tus", "alt", "ven", "hhv", "snl", "nso"] as const;

export function defaultPolicyStatusForSupplier(supplierKey: string): SupplierStockPolicyStatus {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  if (key === "wel" || key === "rei") return "monitoring_only";
  return "review_required";
}

export function buildSupplierSeed(supplierKey: string, displayNameOverride?: string): SupplierSeed {
  const key = String(supplierKey ?? "").trim().toLowerCase();
  const heavySource = HEAVY_PLATFORMS.has(key);
  return {
    supplierKey: key,
    supplierCode: key.slice(0, 3).toUpperCase(),
    displayName: displayNameOverride ?? DISPLAY_NAMES[key] ?? key.toUpperCase(),
    status: defaultPolicyStatusForSupplier(key),
    heavySource,
  };
}

export function allSupplierSeeds(): SupplierSeed[] {
  return SEED_KEYS.map((key) => buildSupplierSeed(key));
}

export function seedScrapeIntervalHours(seed: SupplierSeed): number {
  return resolveScrapeIntervalHours(seed.supplierKey, seed.heavySource);
}
