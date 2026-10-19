import type { SalesCategory, SourceResult } from "@/market-pricing/types";

/** One product lookup request handed to every source. */
export type LookupInput = {
  gtin: string;
  title: string | null;
  brand: string | null;
  category: SalesCategory;
  /** Human query term for keyword-only sources (toppreise, trends). */
  queryTerm: string;
  /** Our own seller name so sources can flag isSelf. */
  selfSellerNames: string[];
};

export interface PriceSource {
  key: string;
  /** False when env/keys missing — engine skips it and records it as skipped. */
  isEnabled(): boolean;
  lookup(input: LookupInput): Promise<SourceResult>;
}

const DEFAULT_TIMEOUT_MS = 15_000;

/** fetch with timeout + JSON parse, never throws (returns null on any failure). */
export async function fetchJson<T>(
  url: string,
  init?: RequestInit & { timeoutMs?: number }
): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), init?.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function isSelfSeller(seller: string | null, selfNames: string[]): boolean {
  if (!seller) return false;
  const s = seller.toLowerCase();
  return selfNames.some((n) => n && s.includes(n.toLowerCase()));
}

export function skipped(key: string): SourceResult {
  return { source: key, ok: false, offers: [], shopCount: null, error: "disabled" };
}
