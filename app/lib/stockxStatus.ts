import { StockXState } from "@/app/lib/stockxTracking";

type MilestoneDefinition = {
  key: string;
  title: string;
  description: string;
  etaMessage?: string;
};

const STANDARD_SEQUENCE: MilestoneDefinition[] = [
  {
    key: "PURCHASE_CONFIRMED",
    title: "Order Confirmed",
    description: "Commande confirmée.",
  },
  {
    key: "SELLER_SHIPPED_TO_STOCKX",
    title: "Waiting for Seller to Ship to StockX",
    description: "Commande expédiée en direction de notre centre.",
  },
  {
    key: "STOCKX_VERIFIED_AND_SHIPPED",
    title: "Awaiting StockX Verification",
    description: "Contrôle d’authenticité en cours.",
  },
  {
    key: "DELIVERED_TO_SWISS_DISTRIBUTOR",
    title: "Awaiting Packaging",
    description: "Préparation et expédition vers la Suisse.",
  },
  {
    key: "SWISS_POST_TRACKING_AVAILABLE",
    title: "Awaiting Order Delivery",
    description: "Livraison en cours.",
  },
];

const EXPRESS_SEQUENCE: MilestoneDefinition[] = [
  {
    key: "EXPRESS_CONFIRMED",
    title: "Order Confirmed",
    description: "Commande Express confirmée.",
  },
  {
    key: "EXPRESS_SHIPPED_TO_SWISS",
    title: "Seller Preparing Shipment",
    description: "Acheminement accéléré vers la Suisse.",
  },
  {
    key: "EXPRESS_DELIVERED_TO_SWISS",
    title: "Order On Its Way To You",
    description: "Arrivé en Suisse, en préparation.",
  },
  {
    key: "SWISS_POST_TRACKING_AVAILABLE_EXPRESS",
    title: "Awaiting Order Delivery",
    description: "En cours de livraison.",
  },
];



function sequenceForCheckout(checkoutType: string | null): MilestoneDefinition[] {
  if (!checkoutType) return STANDARD_SEQUENCE;
  if (checkoutType.startsWith("EXPRESS")) {
    return EXPRESS_SEQUENCE;
  }
  return STANDARD_SEQUENCE;
}

export function getStepTitles(checkoutType: string | null): string[] {
  const seq = sequenceForCheckout(checkoutType);
  return seq.map((m) => m.title);
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

export function detectMilestone(
  checkoutType: string | null,
  states: StockXState[] | null
): MilestoneDefinition | null {
  if (!states || states.length === 0) return null;

  const sequence = sequenceForCheckout(checkoutType);
  const stateTitles = new Map<string, StockXState>();

  for (const state of states) {
    if (state?.title) {
      stateTitles.set(normalizeTitle(state.title), state);
    }
  }

  // Return the MOST advanced completed milestone (iterate backwards)
  for (let i = sequence.length - 1; i >= 0; i--) {
    const milestone = sequence[i];
    const candidate = stateTitles.get(normalizeTitle(milestone.title));
    if (!candidate) continue;
    const isCompleted =
      candidate.progress === "COMPLETED" ||
      (candidate.status === "SUCCESS" && candidate.progress !== "UPCOMING");
    if (isCompleted) {
      return milestone;
    }
  }

  // Fallback: if StockX uses different titles, map by completed count
  const completedCount = states.filter((s) => {
    if (!s) return false;
    if (s.status === "UPCOMING" || s.progress === "UPCOMING") return false;
    return s.progress === "COMPLETED" || s.status === "SUCCESS";
  }).length;

  if (completedCount > 0) {
    const idx = Math.min(sequence.length, Math.max(1, completedCount)) - 1;
    return sequence[idx];
  }


  return null;
}

export function milestoneKeyExists(milestone: MilestoneDefinition | null): string | null {
  return milestone?.key || null;
}

