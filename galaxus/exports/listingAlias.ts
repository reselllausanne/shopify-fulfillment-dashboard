/**
 * Galaxus listing identity alias.
 *
 * When a SupplierVariant GTIN/providerKey is remapped, Galaxus often still has the
 * *old* ProviderKey (master ingest). Stock/offer must keep updating that key so we
 * do not trigger a catalog re-ingest. Internal catalog (SV/mapping) may use the
 * current barcode; feeds emit under the listing key Galaxus already knows.
 */
import { prisma } from "@/app/lib/prisma";
import { buildProviderKey } from "@/galaxus/supplier/providerKey";

export type GalaxusListingIdentity = {
  supplierVariantId: string;
  /** Key Galaxus already ingested — use in stock/offer ProviderKey. */
  listingProviderKey: string;
  /** GTIN embedded in listingProviderKey (digits after PREFIX_). */
  listingGtin: string | null;
  /** Current catalog providerKey (may differ after remap). */
  currentProviderKey: string | null;
  /** True when listing key ≠ current catalog key. */
  isAlias: boolean;
};

function gtinFromProviderKey(providerKey: string | null | undefined): string | null {
  const raw = String(providerKey ?? "").trim();
  const idx = raw.indexOf("_");
  if (idx <= 0) return null;
  const gtin = raw.slice(idx + 1).replace(/\D/g, "");
  return gtin.length >= 8 ? gtin : null;
}

/**
 * Pick listing ProviderKey for one SV among its Galaxus CLS rows.
 * Prefer a key that still exists in master feed snapshot (Galaxus catalog),
 * else the oldest non-archived Galaxus CLS, else the current catalog key.
 */
export function pickGalaxusListingProviderKey(input: {
  currentProviderKey: string | null | undefined;
  clsProviderKeys: string[];
  masterProviderKeys: Set<string>;
}): string | null {
  const current = String(input.currentProviderKey ?? "").trim() || null;
  const clsKeys = Array.from(
    new Set(input.clsProviderKeys.map((k) => String(k ?? "").trim()).filter(Boolean))
  );
  if (clsKeys.length === 0) return current;

  const inMaster = clsKeys.filter((k) => input.masterProviderKeys.has(k));
  if (inMaster.length === 1) return inMaster[0]!;
  if (inMaster.length > 1) {
    // Prefer non-current master key (the pre-remap Galaxus identity).
    const notCurrent = inMaster.filter((k) => k !== current);
    return notCurrent[0] ?? inMaster[0]!;
  }

  // No master hit: prefer ghost key ≠ current when both exist.
  if (current && clsKeys.includes(current) && clsKeys.length > 1) {
    const ghost = clsKeys.find((k) => k !== current);
    if (ghost) return ghost;
  }
  if (current && clsKeys.includes(current)) return current;
  return clsKeys[0] ?? current;
}

export function buildGalaxusListingIdentity(input: {
  supplierVariantId: string;
  currentProviderKey: string | null | undefined;
  listingProviderKey: string | null | undefined;
}): GalaxusListingIdentity | null {
  const svId = String(input.supplierVariantId ?? "").trim();
  const current = String(input.currentProviderKey ?? "").trim() || null;
  const listing = String(input.listingProviderKey ?? "").trim() || current;
  if (!svId || !listing) return null;
  return {
    supplierVariantId: svId,
    listingProviderKey: listing,
    listingGtin: gtinFromProviderKey(listing),
    currentProviderKey: current,
    isAlias: Boolean(current && listing !== current),
  };
}

/**
 * Batch-resolve Galaxus listing identities for export/order paths.
 */
export async function loadGalaxusListingIdentities(
  rows: Array<{ supplierVariantId?: string | null; providerKey?: string | null }>
): Promise<Map<string, GalaxusListingIdentity>> {
  const bySv = new Map<string, string | null>();
  for (const row of rows) {
    const svId = String(row?.supplierVariantId ?? "").trim();
    if (!svId || bySv.has(svId)) continue;
    bySv.set(svId, String(row?.providerKey ?? "").trim() || null);
  }
  if (bySv.size === 0) return new Map();

  const svIds = Array.from(bySv.keys());
  // Postgres prepared-statement bind limit is 32767 — one bind var per IN value.
  // At catalog scale (NER ~1M SVs) a single findMany blows the limit, which is
  // what killed every stock/offer push. Chunk the IN list like every other
  // large export loader (availableStock / evidenceStock use the same pattern).
  const CLS_CHUNK_SIZE = 5000;
  const clsRows: Array<{
    supplierVariantId: string;
    providerKey: string;
    createdAt: Date;
    status: string;
  }> = [];
  for (let offset = 0; offset < svIds.length; offset += CLS_CHUNK_SIZE) {
    const chunk = svIds.slice(offset, offset + CLS_CHUNK_SIZE);
    const batch = await (prisma as any).channelListingState.findMany({
      where: {
        channel: "GALAXUS",
        supplierVariantId: { in: chunk },
        archivedAt: null,
      },
      select: {
        supplierVariantId: true,
        providerKey: true,
        createdAt: true,
        status: true,
      },
      orderBy: { createdAt: "asc" },
    });
    clsRows.push(...batch);
  }

  const clsBySv = new Map<string, string[]>();
  for (const row of clsRows as Array<{ supplierVariantId: string; providerKey: string }>) {
    const svId = String(row.supplierVariantId ?? "").trim();
    const pk = String(row.providerKey ?? "").trim();
    if (!svId || !pk) continue;
    const list = clsBySv.get(svId) ?? [];
    if (!list.includes(pk)) list.push(pk);
    clsBySv.set(svId, list);
  }

  // Master-presence is only ever consulted for CLS providerKeys (pickGalaxusListingProviderKey
  // calls masterProviderKeys.has(k) for k in clsProviderKeys — never for a SV's current key).
  // The old `.concat(bySv.values())` added the current providerKey of all ~1.2M SVs, so this
  // membership loop ran ~4800 IN(500) round-trips (the 21min `listingAlias` phase). CLS keys
  // only exist for remapped/listed SVs (tens of thousands), so scoping to them is identical in
  // result and cuts the loop to a handful of queries.
  const allKeys = Array.from(new Set(Array.from(clsBySv.values()).flat()));

  // "Master catalog keys" = providerKeys Galaxus already ingested. There is no
  // GalaxusFeedMasterSnapshot model (schema only has Stock/Offer snapshots), so the
  // old reference was `undefined.findMany` — it only ever ran once the CLS query
  // succeeded, which is why chunking the CLS IN list (bind-var fix) unmasked this
  // crash and killed every push. Use the pushed snapshot keys (stock ∪ offer) as the
  // master-presence proxy, and guard the model so a missing table degrades to the
  // CLS-only fallback in pickGalaxusListingProviderKey instead of throwing.
  const masterKeys = new Set<string>();
  const snapshotModels = [
    (prisma as any).galaxusFeedStockSnapshot,
    (prisma as any).galaxusFeedOfferSnapshot,
  ].filter((m) => m && typeof m.findMany === "function");
  if (allKeys.length > 0 && snapshotModels.length > 0) {
    const chunkSize = 500;
    for (const model of snapshotModels) {
      for (let i = 0; i < allKeys.length; i += chunkSize) {
        const chunk = allKeys.slice(i, i + chunkSize);
        const snapRows = await model.findMany({
          where: { providerKey: { in: chunk } },
          select: { providerKey: true },
        });
        for (const row of snapRows as Array<{ providerKey: string }>) {
          const pk = String(row.providerKey ?? "").trim();
          if (pk) masterKeys.add(pk);
        }
      }
    }
  }

  const out = new Map<string, GalaxusListingIdentity>();
  for (const [svId, currentPk] of bySv.entries()) {
    const listingPk = pickGalaxusListingProviderKey({
      currentProviderKey: currentPk,
      clsProviderKeys: clsBySv.get(svId) ?? (currentPk ? [currentPk] : []),
      masterProviderKeys: masterKeys,
    });
    const identity = buildGalaxusListingIdentity({
      supplierVariantId: svId,
      currentProviderKey: currentPk,
      listingProviderKey: listingPk,
    });
    if (identity) out.set(svId, identity);
  }
  return out;
}

/**
 * Apply listing alias onto export candidates (stock/offer ProviderKey).
 * Dedupes when two catalog keys collapse onto one Galaxus listing key.
 * Returns superseded current keys that should get QuantityOnStock=0.
 */
export function applyListingAliasToCandidates<
  T extends { providerKey?: string; variant?: { supplierVariantId?: string | null } | null }
>(
  candidates: T[],
  identities: Map<string, GalaxusListingIdentity>
): { candidates: T[]; supersededProviderKeys: string[] } {
  const superseded = new Set<string>();
  const byListingKey = new Map<string, T>();

  for (const candidate of candidates) {
    const svId = String(candidate?.variant?.supplierVariantId ?? "").trim();
    const catalogKey = String(candidate?.providerKey ?? "").trim();
    const identity = svId ? identities.get(svId) : undefined;
    const listingKey = identity?.listingProviderKey || catalogKey;
    if (!listingKey) continue;

    if (identity?.isAlias && catalogKey && catalogKey !== listingKey) {
      superseded.add(catalogKey);
    }

    const next = { ...candidate, providerKey: listingKey };
    if (!byListingKey.has(listingKey)) {
      byListingKey.set(listingKey, next);
    }
  }

  return {
    candidates: Array.from(byListingKey.values()),
    supersededProviderKeys: Array.from(superseded),
  };
}

/** Resolve supplierVariantId for an order line GTIN/providerKey via Galaxus CLS alias. */
export async function resolveSupplierVariantIdFromGalaxusListingKey(input: {
  gtin?: string | null;
  providerKey?: string | null;
  supplierVariantId?: string | null;
}): Promise<string | null> {
  const svDirect = String(input.supplierVariantId ?? "").trim();
  if (svDirect) return svDirect;

  const keys: string[] = [];
  const pk = String(input.providerKey ?? "").trim();
  if (pk) keys.push(pk);
  const gtin = String(input.gtin ?? "").replace(/\D/g, "");
  if (gtin) {
    const built = buildProviderKey(gtin, "stx_placeholder");
    if (built) keys.push(built);
  }

  if (keys.length === 0 && !gtin) return null;

  const row = await (prisma as any).channelListingState.findFirst({
    where: {
      channel: "GALAXUS",
      archivedAt: null,
      OR: [
        ...(keys.length ? [{ providerKey: { in: keys } }] : []),
        ...(gtin ? [{ gtin }] : []),
      ],
    },
    select: { supplierVariantId: true },
    orderBy: { updatedAt: "desc" },
  });
  const svId = String(row?.supplierVariantId ?? "").trim();
  return svId || null;
}
