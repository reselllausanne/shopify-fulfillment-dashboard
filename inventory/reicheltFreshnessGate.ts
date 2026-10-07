import { prisma } from "@/app/lib/prisma";

/**
 * Reichelt rows are refreshed by scraping. Expensive SKUs must not stay live on a
 * stale "in stock" snapshot: publish 0 unless re-checked within the max age.
 */

const LOOKUP_CHUNK_SIZE = 5000;

export function reicheltHighValueChf(): number {
  const raw = Number(process.env.REI_HIGH_VALUE_CHF ?? 1000);
  return Number.isFinite(raw) && raw > 0 ? raw : 1000;
}

export function reicheltHighValueMaxAgeHours(): number {
  const raw = Number(process.env.REI_HIGH_VALUE_MAX_AGE_HOURS ?? 24);
  return Number.isFinite(raw) && raw > 0 ? raw : 24;
}

export function isReicheltSupplierVariantId(supplierVariantId: string | null | undefined): boolean {
  return String(supplierVariantId ?? "").trim().toLowerCase().startsWith("rei_");
}

export function isReicheltHighValuePrice(price: unknown): boolean {
  const n = Number(price);
  return Number.isFinite(n) && n >= reicheltHighValueChf();
}

export function isReicheltStaleHighValue(input: {
  price: unknown;
  lastSyncAt: Date | string | null | undefined;
  now?: Date;
}): boolean {
  if (!isReicheltHighValuePrice(input.price)) return false;
  if (!input.lastSyncAt) return true;
  const ts = new Date(input.lastSyncAt).getTime();
  if (!Number.isFinite(ts)) return true;
  const now = (input.now ?? new Date()).getTime();
  return now - ts > reicheltHighValueMaxAgeHours() * 3_600_000;
}

/** supplierVariantIds (rei_*) that are high-value and not re-checked recently. */
export async function loadStaleHighValueReicheltIds(supplierVariantIds: string[]): Promise<Set<string>> {
  const out = new Set<string>();
  const ids = Array.from(new Set(supplierVariantIds.filter(isReicheltSupplierVariantId)));
  if (!ids.length) return out;
  const prismaAny = prisma as any;
  if (!prismaAny.supplierVariant?.findMany) return out;
  const now = new Date();
  for (let offset = 0; offset < ids.length; offset += LOOKUP_CHUNK_SIZE) {
    const chunk = ids.slice(offset, offset + LOOKUP_CHUNK_SIZE);
    const rows = await prismaAny.supplierVariant.findMany({
      where: { supplierVariantId: { in: chunk }, price: { gte: reicheltHighValueChf() } },
      select: { supplierVariantId: true, price: true, lastSyncAt: true },
    });
    for (const row of rows ?? []) {
      if (isReicheltStaleHighValue({ price: row.price, lastSyncAt: row.lastSyncAt, now })) {
        out.add(String(row.supplierVariantId));
      }
    }
  }
  return out;
}
