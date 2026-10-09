/**
 * Galaxus stock from scraper evidence (supplier_variant_evidence) instead of
 * SupplierVariant.stock, which scrapers stop writing while
 * SUPPLIER_STOCK_PUBLISH_ENFORCED is unset (frozen since Sep 2026).
 *
 * Env:
 *   GALAXUS_EVIDENCE_STOCK_SUPPLIERS  comma list, default "bwz"
 *   GALAXUS_EVIDENCE_MAX_AGE_DAYS     default 2 (scrapers run daily)
 */
import { prisma } from "@/app/lib/prisma";

export type GalaxusStockEvidence = { publishedQty: number; lastProofAt: Date | null };

const EVIDENCE_CHUNK_SIZE = 5000;

export function galaxusEvidenceStockSuppliers(): Set<string> {
  const raw = String(process.env.GALAXUS_EVIDENCE_STOCK_SUPPLIERS ?? "bwz");
  return new Set(
    raw
      .split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean)
  );
}

export function galaxusEvidenceMaxAgeDays(): number {
  const n = Number.parseFloat(String(process.env.GALAXUS_EVIDENCE_MAX_AGE_DAYS ?? ""));
  return Number.isFinite(n) && n > 0 ? n : 2;
}

export function evidenceSupplierKey(supplierVariantId: string | null | undefined): string {
  return String(supplierVariantId ?? "").trim().toLowerCase().split(/[_:]/)[0] ?? "";
}

export function usesGalaxusEvidenceStock(supplierVariantId: string | null | undefined): boolean {
  const key = evidenceSupplierKey(supplierVariantId);
  return key.length > 0 && galaxusEvidenceStockSuppliers().has(key);
}

/** No evidence or proof older than the max age → 0 (never publish frozen stock). */
export function resolveGalaxusEvidenceStock(
  evidence: GalaxusStockEvidence | undefined,
  now: Date = new Date()
): number {
  if (!evidence || !evidence.lastProofAt) return 0;
  const ageDays = (now.getTime() - evidence.lastProofAt.getTime()) / 86_400_000;
  if (ageDays > galaxusEvidenceMaxAgeDays()) return 0;
  return Math.max(0, Math.trunc(Number(evidence.publishedQty) || 0));
}

export async function loadGalaxusStockEvidence(
  supplierVariantIds: string[]
): Promise<Map<string, GalaxusStockEvidence>> {
  const ids = Array.from(new Set(supplierVariantIds.filter((id) => usesGalaxusEvidenceStock(id))));
  const map = new Map<string, GalaxusStockEvidence>();
  for (let offset = 0; offset < ids.length; offset += EVIDENCE_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + EVIDENCE_CHUNK_SIZE);
    const rows = await (prisma as any).supplierVariantEvidence.findMany({
      where: { supplierVariantId: { in: chunk } },
      select: { supplierVariantId: true, publishedQty: true, lastProofAt: true },
    });
    for (const row of rows ?? []) {
      map.set(String(row.supplierVariantId), {
        publishedQty: Number(row.publishedQty) || 0,
        lastProofAt: row.lastProofAt ? new Date(row.lastProofAt) : null,
      });
    }
  }
  return map;
}
