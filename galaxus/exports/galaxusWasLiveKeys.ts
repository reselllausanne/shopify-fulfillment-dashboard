import { prisma } from "@/app/lib/prisma";

/**
 * ProviderKeys Galaxus may still treat as live (we last pushed qty > 0).
 * Stock export only emits QuantityOnStock=0 for these — never-pushed catalog
 * shells must not pad the feed (~270k rows / Tali 2026-10-27).
 */
export async function loadGalaxusWasLiveProviderKeys(): Promise<Set<string>> {
  const prismaAny = prisma as any;
  const rows = await prismaAny.channelListingState.findMany({
    where: {
      channel: "GALAXUS",
      lastPushedStock: { gt: 0 },
    },
    select: { providerKey: true },
  });
  const out = new Set<string>();
  for (const row of rows as Array<{ providerKey?: string | null }>) {
    const key = String(row?.providerKey ?? "").trim();
    if (key) out.add(key);
  }
  return out;
}

/** Fail-open when `wasLive` is null (load error) so we never skip a needed delist. */
export function shouldEmitGalaxusDelistZero(
  providerKey: string | null | undefined,
  wasLive: Set<string> | null
): boolean {
  const key = String(providerKey ?? "").trim();
  if (!key) return false;
  if (wasLive == null) return true;
  return wasLive.has(key);
}
