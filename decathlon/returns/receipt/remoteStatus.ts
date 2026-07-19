import type { buildDecathlonOrdersClient } from "@/decathlon/mirakl/ordersClient";
import { extractReturnsList, normalizeMiraklReturnStatus, pickString } from "./mapReturn";

type OrdersClient = ReturnType<typeof buildDecathlonOrdersClient>;

export const MIRAKL_TERMINAL_RETURN_STATUSES = [
  "CLOSED",
  "CANCELLED",
  "CANCELED",
  "REQUEST_DECLINED",
  "DECLINED",
  "REFUNDED",
  "REJECTED",
] as const;

export function isMiraklTerminalReturnStatus(status: string): boolean {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (!normalized) return false;
  return (MIRAKL_TERMINAL_RETURN_STATUSES as readonly string[]).includes(normalized);
}

export async function resolveRemoteReturnStatus(options: {
  client: OrdersClient;
  externalReturnId: string;
}): Promise<string | null> {
  const { client, externalReturnId } = options;
  const calls: Array<() => Promise<any>> = [];
  if (typeof client.listReturnsRt11 === "function") {
    calls.push(() => client.listReturnsRt11({ return_id: externalReturnId, limit: 10 }));
  }
  if (typeof client.listReturns === "function") {
    calls.push(() => client.listReturns({ ids: externalReturnId, limit: 10 }));
  }

  for (const run of calls) {
    try {
      const payload = await run();
      const list = extractReturnsList(payload);
      const match = list.find((entry: any) => {
        const id = pickString(entry?.id, entry?.return_id, entry?.returnId);
        return id === externalReturnId;
      });
      if (match) {
        const status = normalizeMiraklReturnStatus(match);
        if (status) return status;
      }
    } catch {
      // Best-effort reconciliation across RT11 / Connect v2.
    }
  }
  return null;
}

export function mapTerminalMiraklStatusToProcessStep(
  status: string
): "close_done" | "refund_done" {
  const normalized = String(status ?? "").trim().toUpperCase();
  if (normalized === "REFUNDED") return "refund_done";
  return "close_done";
}
