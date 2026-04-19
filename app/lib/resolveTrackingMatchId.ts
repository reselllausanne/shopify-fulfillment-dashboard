import { prisma } from "@/app/lib/prisma";
import { verifyTrackingToken } from "@/app/lib/trackingToken";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Resolves an order match id from a public tracking URL segment.
 * 1) Persistent token stored on OrderMatch (no expiry).
 * 2) Legacy signed token (HMAC + TTL).
 */
export async function resolveOrderMatchIdFromTrackingToken(
  token: string
): Promise<string | null> {
  const trimmed = (token || "").trim();
  if (!trimmed) return null;

  if (UUID_RE.test(trimmed)) {
    const row = await prisma.orderMatch.findFirst({
      where: { customerTrackingToken: trimmed },
      select: { id: true },
    });
    if (row) return row.id;
  }

  const legacy = verifyTrackingToken(trimmed);
  return legacy?.orderMatchId || null;
}
