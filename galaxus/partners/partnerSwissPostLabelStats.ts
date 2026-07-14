import { prisma } from "@/app/lib/prisma";
import { normalizeProviderKey } from "@/galaxus/supplier/providerKey";

/**
 * Count Swiss Post labels for a partner (Decathlon ship flow).
 * Prefer shipments tagged with partnerKey (partner portal).
 * Legacy fallback: unlabeled partnerKey on shipments that include that partner's lines.
 */
export async function countPartnerSwissPostLabels(sessionPartnerKey: string): Promise<number> {
  const pk = normalizeProviderKey(sessionPartnerKey);
  if (!pk) return 0;
  const prefix = `${pk}_`;

  const tagged = await (prisma as any).decathlonShipment.count({
    where: {
      labelGeneratedAt: { not: null },
      partnerKey: { equals: pk, mode: "insensitive" },
    },
  });

  const legacy = await (prisma as any).decathlonShipment.count({
    where: {
      labelGeneratedAt: { not: null },
      AND: [
        {
          OR: [{ partnerKey: null }, { partnerKey: "" }],
        },
        {
          OR: [
            { order: { partnerKey: { equals: pk, mode: "insensitive" } } },
            {
              lines: {
                some: {
                  orderLine: {
                    OR: [
                      { partnerKey: { equals: pk, mode: "insensitive" } },
                      { offerSku: { startsWith: prefix, mode: "insensitive" } },
                    ],
                  },
                },
              },
            },
          ],
        },
      ],
    },
  });

  return Number(tagged ?? 0) + Number(legacy ?? 0);
}
