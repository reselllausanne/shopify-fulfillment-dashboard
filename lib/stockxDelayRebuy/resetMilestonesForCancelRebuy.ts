import { prisma } from "@/app/lib/prisma";
import { CUSTOMER_SHIPPED_LA_POSTE_KEY } from "@/app/lib/stockxStatus";

/**
 * StockX progression milestone keys (standard + express).
 * Kept in sync with sequences in app/lib/stockxStatus.ts.
 */
export const STOCKX_PROGRESSION_MILESTONE_KEYS = [
  "PURCHASE_CONFIRMED",
  "SELLER_SHIPPED_TO_STOCKX",
  "STOCKX_VERIFIED_AND_SHIPPED",
  "DELIVERED_TO_SWISS_DISTRIBUTOR",
  "SWISS_POST_TRACKING_AVAILABLE",
  "EXPRESS_CONFIRMED",
  "EXPRESS_SHIPPED_TO_SWISS",
  "EXPRESS_DELIVERED_TO_SWISS",
  "SWISS_POST_TRACKING_AVAILABLE_EXPRESS",
] as const;

/** Customer delay / cancel / La Poste — never wiped on cancel→rebuy. */
export const CUSTOMER_MILESTONE_KEYS_KEEP = new Set<string>([
  "CUSTOMER_DELAY_SUPPLIER_CHANGE",
  "CUSTOMER_ORDER_CANCELED",
  "CUSTOMER_CANCEL_REBUY",
  CUSTOMER_SHIPPED_LA_POSTE_KEY,
]);

export type ResetMilestonesResult = {
  orderMatchId: string;
  clearedLastMilestone: boolean;
  deletedEvents: number;
  seededConfirmedKey: string | null;
};

export type ResetMilestonesOptions = {
  /**
   * After wipe, mark PURCHASE_CONFIRMED / EXPRESS_CONFIRMED as already emailed
   * (cancel-rebuy mail already covered "we ordered again"). Later steps still mail.
   */
  seedConfirmedAsEmailed?: boolean;
  checkoutType?: string | null;
  stockxOrderNumber?: string | null;
};

function confirmedMilestoneKey(opts: {
  checkoutType?: string | null;
  stockxOrderNumber?: string | null;
}): "PURCHASE_CONFIRMED" | "EXPRESS_CONFIRMED" {
  const num = String(opts.stockxOrderNumber ?? "").trim();
  if (num.startsWith("01-")) return "EXPRESS_CONFIRMED";
  if (num.startsWith("03-")) return "PURCHASE_CONFIRMED";
  if (String(opts.checkoutType ?? "").toUpperCase().startsWith("EXPRESS")) {
    return "EXPRESS_CONFIRMED";
  }
  return "PURCHASE_CONFIRMED";
}

/**
 * After a cancelled StockX buy is replaced by a new order number:
 * wipe progression StockXStatusEvent rows + lastMilestoneKey so AWB cron /
 * save-match can email the new buy's steps again.
 *
 * Keeps CUSTOMER_ORDER_CANCELED / DELAY / CANCEL_REBUY / LA_POSTE events.
 */
export async function resetProgressionMilestonesForCancelRebuy(
  orderMatchId: string,
  options?: ResetMilestonesOptions
): Promise<ResetMilestonesResult> {
  const id = String(orderMatchId || "").trim();
  if (!id) {
    return {
      orderMatchId: "",
      clearedLastMilestone: false,
      deletedEvents: 0,
      seededConfirmedKey: null,
    };
  }

  const before = await prisma.orderMatch.findUnique({
    where: { id },
    select: {
      lastMilestoneKey: true,
      stockxCheckoutType: true,
      stockxOrderNumber: true,
    },
  });

  const deleted = await prisma.stockXStatusEvent.deleteMany({
    where: {
      orderMatchId: id,
      milestoneKey: { in: [...STOCKX_PROGRESSION_MILESTONE_KEYS] },
    },
  });

  const clearedLast = Boolean(before?.lastMilestoneKey);
  let seededConfirmedKey: string | null = null;

  if (options?.seedConfirmedAsEmailed) {
    seededConfirmedKey = confirmedMilestoneKey({
      checkoutType: options.checkoutType ?? before?.stockxCheckoutType,
      stockxOrderNumber: options.stockxOrderNumber ?? before?.stockxOrderNumber,
    });
    const now = new Date();
    await prisma.stockXStatusEvent.upsert({
      where: {
        orderMatchId_milestoneKey: {
          orderMatchId: id,
          milestoneKey: seededConfirmedKey,
        },
      },
      create: {
        orderMatchId: id,
        milestoneKey: seededConfirmedKey,
        milestoneTitle: "Order Confirmed",
        statesHash: "cancel_rebuy_seed",
        emailedAt: now,
        emailTo: null,
        emailProvider: "seed",
        emailProviderId: null,
        emailError: null,
      },
      update: {
        milestoneTitle: "Order Confirmed",
        statesHash: "cancel_rebuy_seed",
        emailedAt: now,
        emailError: null,
      },
    });
    await prisma.orderMatch.update({
      where: { id },
      data: {
        lastMilestoneKey: seededConfirmedKey,
        lastMilestoneAt: now,
      },
    });
  } else if (clearedLast) {
    await prisma.orderMatch.update({
      where: { id },
      data: { lastMilestoneKey: null, lastMilestoneAt: null },
    });
  }

  console.log(
    `[STOCKX][CANCEL_REBUY] reset milestones match=${id} deletedEvents=${deleted.count} clearedLast=${clearedLast} seeded=${seededConfirmedKey ?? "-"}`
  );

  return {
    orderMatchId: id,
    clearedLastMilestone: clearedLast,
    deletedEvents: deleted.count,
    seededConfirmedKey,
  };
}

/** Pure: was this link a cancel→rebuy of a terminal StockX buy? */
export function isCancelRebuyLink(input: {
  previousStockxOrderNumber: string | null | undefined;
  previousStockxStatus: string | null | undefined;
  newStockxOrderNumber: string | null | undefined;
}): boolean {
  const prev = String(input.previousStockxOrderNumber ?? "").trim();
  const next = String(input.newStockxOrderNumber ?? "").trim();
  if (!prev || !next || prev === next) return false;
  const st = String(input.previousStockxStatus ?? "").toUpperCase();
  return st.includes("CANCEL") || st.includes("REFUND");
}
