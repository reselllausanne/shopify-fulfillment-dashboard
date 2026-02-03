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



function sequenceForCheckout(checkoutType: string | null, orderNumber?: string | null): MilestoneDefinition[] {
  if (orderNumber?.startsWith("01-")) return EXPRESS_SEQUENCE;
  if (orderNumber?.startsWith("03-")) return STANDARD_SEQUENCE;
  if (checkoutType && checkoutType.startsWith("EXPRESS")) return EXPRESS_SEQUENCE;
  return STANDARD_SEQUENCE;
}

export function getStepTitles(checkoutType: string | null, orderNumber?: string | null): string[] {
  const seq = sequenceForCheckout(checkoutType, orderNumber);
  return seq.map((m) => m.title);
}

function normalizeTitle(value: string): string {
  return value.trim().toLowerCase();
}

const STANDARD_TITLE_ALIASES: Record<string, string> = {
  "order on its way to stockx": "SELLER_SHIPPED_TO_STOCKX",
  "awaiting item arrival at stockx": "STOCKX_VERIFIED_AND_SHIPPED",
  "awaiting stockx verification": "STOCKX_VERIFIED_AND_SHIPPED",
  "awaiting packaging": "DELIVERED_TO_SWISS_DISTRIBUTOR",
  "awaiting carrier pickup": "DELIVERED_TO_SWISS_DISTRIBUTOR",
  "awaiting order delivery": "SWISS_POST_TRACKING_AVAILABLE",
};

const EXPRESS_TITLE_ALIASES: Record<string, string> = {
  "seller preparing shipment": "EXPRESS_SHIPPED_TO_SWISS",
  "order on its way to you": "EXPRESS_DELIVERED_TO_SWISS",
  "awaiting order delivery": "SWISS_POST_TRACKING_AVAILABLE_EXPRESS",
};

export function detectMilestone(
  checkoutType: string | null,
  states: StockXState[] | null,
  orderNumber?: string | null
): MilestoneDefinition | null {
  if (!states || states.length === 0) return null;

  const sequence = sequenceForCheckout(checkoutType, orderNumber);
  const stateTitles = new Map<string, StockXState>();
  const mappedByAlias = new Map<string, StockXState>();
  const isExpressFlow = orderNumber?.startsWith("01-")
    ? true
    : orderNumber?.startsWith("03-")
      ? false
      : checkoutType
        ? checkoutType.startsWith("EXPRESS")
        : false;
  const aliasMap = isExpressFlow ? EXPRESS_TITLE_ALIASES : STANDARD_TITLE_ALIASES;

  for (const state of states) {
    if (state?.title) {
      const normalized = normalizeTitle(state.title);
      stateTitles.set(normalized, state);
      const aliasKey = aliasMap[normalized];
      if (aliasKey) {
        mappedByAlias.set(aliasKey, state);
      }
    }
  }

  // Prefer completed count to align with the step UI
  const completedCount = states.filter((s) => {
    if (!s) return false;
    if (s.status === "UPCOMING" || s.progress === "UPCOMING") return false;
    return s.progress === "COMPLETED" || s.status === "SUCCESS";
  }).length;

  if (completedCount > 0) {
    const idx = Math.min(sequence.length, Math.max(1, completedCount)) - 1;
    return sequence[idx];
  }

  // Fallback: match by title aliases if nothing completed
  for (let i = sequence.length - 1; i >= 0; i--) {
    const milestone = sequence[i];
    const candidate =
      mappedByAlias.get(milestone.key) || stateTitles.get(normalizeTitle(milestone.title));
    if (!candidate) continue;
    const isCompleted =
      candidate.progress === "COMPLETED" ||
      (candidate.status === "SUCCESS" && candidate.progress !== "UPCOMING");
    if (isCompleted) {
      return milestone;
    }
  }

  return null;
}

export function milestoneKeyExists(milestone: MilestoneDefinition | null): string | null {
  return milestone?.key || null;
}

