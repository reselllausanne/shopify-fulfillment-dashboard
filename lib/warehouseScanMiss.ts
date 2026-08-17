import { prisma } from "@/app/lib/prisma";

/** How long failed warehouse scans are retained. */
export const WAREHOUSE_SCAN_MISS_RETENTION_DAYS = 30;

export type WarehouseScanMissInput = {
  rawCode: string;
  normalizedAwb?: string | null;
  lookupCandidates?: string[];
  status: string;
  errorMessage?: string | null;
  scanSessionKey?: string | null;
  userAgent?: string | null;
};

function retentionCutoff(): Date {
  return new Date(Date.now() - WAREHOUSE_SCAN_MISS_RETENTION_DAYS * 24 * 60 * 60 * 1000);
}

/** Persist a failed scan. Never throws — logging must not break the scanner. */
export async function recordWarehouseScanMiss(input: WarehouseScanMissInput): Promise<void> {
  const rawCode = String(input.rawCode ?? "").trim();
  if (!rawCode) return;

  const status = String(input.status ?? "").trim().toUpperCase() || "NOT_FOUND";
  const normalizedAwb = String(input.normalizedAwb ?? "").trim() || null;
  const candidates = Array.isArray(input.lookupCandidates)
    ? input.lookupCandidates.map((c) => String(c).trim()).filter(Boolean).slice(0, 20)
    : [];
  const errorMessage = String(input.errorMessage ?? "").trim().slice(0, 500) || null;
  const scanSessionKey = String(input.scanSessionKey ?? "").trim().slice(0, 120) || null;
  const userAgent = String(input.userAgent ?? "").trim().slice(0, 300) || null;

  try {
    await prisma.warehouseScanMiss.create({
      data: {
        rawCode: rawCode.slice(0, 200),
        normalizedAwb: normalizedAwb ? normalizedAwb.slice(0, 200) : null,
        lookupCandidates: candidates,
        status,
        errorMessage,
        scanSessionKey,
        userAgent,
      },
    });
  } catch (err) {
    console.error("[WarehouseScanMiss] create failed:", err);
    return;
  }

  // Opportunistic prune (~10% of writes) so table stays bounded.
  if (Math.random() > 0.1) return;
  try {
    await prisma.warehouseScanMiss.deleteMany({
      where: { createdAt: { lt: retentionCutoff() } },
    });
  } catch (err) {
    console.error("[WarehouseScanMiss] prune failed:", err);
  }
}
