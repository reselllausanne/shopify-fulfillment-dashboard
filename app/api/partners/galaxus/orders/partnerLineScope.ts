import { prisma } from "@/app/lib/prisma";

function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0 || items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function clean(value: unknown): string {
  return String(value ?? "").trim();
}

export function collectGtinsFromLines(lines: Array<{ gtin?: string | null }>): string[] {
  return Array.from(
    new Set(
      lines
        .map((line) => clean(line?.gtin))
        .filter(Boolean)
    )
  );
}

export async function resolvePartnerGtins(gtins: string[], partnerKeyUpper: string): Promise<Set<string>> {
  const out = new Set<string>();
  if (gtins.length === 0) return out;

  const prismaAny = prisma as any;
  const pkUpper = partnerKeyUpper.toUpperCase();
  const pkLower = pkUpper.toLowerCase();
  const prefixProvider = `${pkUpper}_`;
  const prefixIdColon = `${pkLower}:`;
  const prefixIdUnderscore = `${pkLower}_`;

  for (const batch of chunkArray(gtins, 500)) {
    const rows = await prismaAny.variantMapping.findMany({
      where: {
        gtin: { in: batch },
        OR: [
          { supplierVariantId: { startsWith: prefixIdColon, mode: "insensitive" } },
          { supplierVariantId: { startsWith: prefixIdUnderscore, mode: "insensitive" } },
          { providerKey: { startsWith: prefixProvider, mode: "insensitive" } },
        ],
      },
      select: { gtin: true },
    });
    for (const row of rows) {
      const gtin = clean(row?.gtin);
      if (gtin) out.add(gtin);
    }
  }

  return out;
}

export function lineMatchesPartnerScope(
  line: { providerKey?: string | null; supplierVariantId?: string | null; gtin?: string | null },
  partnerKeyUpper: string,
  partnerGtins: Set<string>
): boolean {
  const pkUpper = partnerKeyUpper.toUpperCase();
  const pkLower = pkUpper.toLowerCase();
  const providerKey = clean(line?.providerKey).toUpperCase();
  const supplierVariantId = clean(line?.supplierVariantId).toLowerCase();
  const gtin = clean(line?.gtin);

  if (providerKey.startsWith(`${pkUpper}_`)) return true;
  if (supplierVariantId.startsWith(`${pkLower}:`)) return true;
  if (supplierVariantId.startsWith(`${pkLower}_`)) return true;
  if (gtin && partnerGtins.has(gtin)) return true;
  return false;
}
