import { prisma } from "@/app/lib/prisma";

/**
 * Idempotency for the post-sale flow (webhook + 5-min recent-paid cron).
 *
 * The cron scans a rolling paid-orders window, so the same line was converged
 * every 5 minutes: each pass re-ran Shopify writes and main.py, run time grew
 * cycle after cycle until the 120s cron timeout killed it and nothing converged.
 * A processed line is skipped; a failed line is retried up to RETRY_LIMIT.
 */
const RETRY_LIMIT = 3;

export type PaidLineKeyInput = {
  orderId: string;
  lineItemId: string | null;
  gtin?: string | null;
  variantId?: string | null;
  quantity?: number | null;
};

/** Webhook sends REST numeric ids, the cron reads GraphQL gids — key on the numeric id. */
function numericId(idish: string | null | undefined): string {
  const raw = String(idish ?? "").trim();
  if (!raw) return "";
  const tail = raw.match(/(\d+)\s*$/);
  return tail?.[1] ?? raw;
}

function keyParts(line: PaidLineKeyInput): { orderId: string; lineItemId: string } {
  return {
    orderId: numericId(line.orderId) || String(line.orderId ?? "").trim(),
    // Fall back to GTIN when Shopify gives no line id, so the key is still stable.
    lineItemId: numericId(line.lineItemId) || `gtin:${line.gtin ?? "unknown"}`,
  };
}

export type PaidLineState = {
  ok: boolean;
  attempts: number;
};

/** Processed/attempt state for the given order lines, keyed by `orderId::lineItemId`. */
export async function loadPaidLineStates(
  lines: PaidLineKeyInput[]
): Promise<Map<string, PaidLineState>> {
  const out = new Map<string, PaidLineState>();
  const orderIds = Array.from(
    new Set(lines.map((l) => keyParts(l).orderId).filter(Boolean))
  );
  if (orderIds.length === 0) return out;

  const rows = await (prisma as any).shopifyPaidLineState.findMany({
    where: { orderId: { in: orderIds } },
    select: { orderId: true, lineItemId: true, ok: true, attempts: true },
  });
  for (const row of rows as Array<{
    orderId: string;
    lineItemId: string;
    ok: boolean;
    attempts: number;
  }>) {
    out.set(`${row.orderId}::${row.lineItemId}`, { ok: row.ok, attempts: row.attempts });
  }
  return out;
}

export function shouldProcessPaidLine(
  states: Map<string, PaidLineState>,
  line: PaidLineKeyInput
): boolean {
  const { orderId, lineItemId } = keyParts(line);
  const state = states.get(`${orderId}::${lineItemId}`);
  if (!state) return true;
  if (state.ok) return false;
  return state.attempts < RETRY_LIMIT;
}

export async function markPaidLineProcessed(
  line: PaidLineKeyInput,
  result: { ok: boolean; error?: string | null }
): Promise<void> {
  const { orderId, lineItemId } = keyParts(line);
  const now = new Date();
  try {
    await (prisma as any).shopifyPaidLineState.upsert({
      where: { orderId_lineItemId: { orderId, lineItemId } },
      create: {
        orderId,
        lineItemId,
        gtin: line.gtin ?? null,
        variantId: line.variantId ?? null,
        quantity: Math.max(1, Math.trunc(Number(line.quantity ?? 1))),
        ok: result.ok,
        attempts: 1,
        lastError: result.error ?? null,
        processedAt: now,
      },
      update: {
        gtin: line.gtin ?? null,
        variantId: line.variantId ?? null,
        ok: result.ok,
        attempts: { increment: 1 },
        lastError: result.error ?? null,
        processedAt: now,
      },
    });
  } catch (err: any) {
    console.warn("[shopify][paid-line-state] upsert failed", {
      orderId,
      lineItemId,
      error: err?.message ?? err,
    });
  }
}
