import { prisma } from "@/app/lib/prisma";
import { resolveOrderMatchIdFromTrackingToken } from "@/app/lib/resolveTrackingMatchId";
import { detectMilestone } from "@/app/lib/stockxStatus";
import { StockXState } from "@/app/lib/stockxTracking";

type Params = {
  params: { token: string };
};

export const dynamic = "force-dynamic";

type Step = {
  key: string;
  title: string;
  description: string;
};

const STANDARD_STEPS: Step[] = [
  {
    key: "CONFIRMED",
    title: "Order confirmed",
    description: "Your order is confirmed and being prepared.",
  },
  {
    key: "QUALITY_CHECK",
    title: "Quality check completed",
    description: "Product verification has been completed.",
  },
  {
    key: "IN_TRANSIT",
    title: "International transit",
    description: "Your order is moving through international transit.",
  },
  {
    key: "ARRIVED_CH",
    title: "Arrived in Switzerland",
    description: "Your order has reached Switzerland and is being processed.",
  },
  {
    key: "LOCAL_DELIVERY",
    title: "Final delivery with local carrier",
    description: "Final delivery is handled by the local carrier.",
  },
];

const EXPRESS_STEPS: Step[] = [
  {
    key: "CONFIRMED",
    title: "Order confirmed",
    description: "Your order is confirmed and prioritized.",
  },
  {
    key: "IN_TRANSIT",
    title: "International transit",
    description: "Your order is moving through international transit.",
  },
  {
    key: "ARRIVED_CH",
    title: "Arrived in Switzerland",
    description: "Your order has reached Switzerland and is being processed.",
  },
  {
    key: "LOCAL_DELIVERY",
    title: "Final delivery with local carrier",
    description: "Final delivery is handled by the local carrier.",
  },
];

const GOAT_NORMAL_STEPS = STANDARD_STEPS;
const GOAT_INSTANT_STEPS = EXPRESS_STEPS;

type StageKey = "confirmed" | "quality" | "transit" | "switzerland" | "delivery";

const stageFromStatus = (statusRaw: string | null): StageKey => {
  const status = (statusRaw || "").toLowerCase();
  if (/deliver|delivered|completed|complete/.test(status)) return "delivery";
  if (/switzerland|swiss|customs|local carrier|post|final mile/.test(status)) {
    return "switzerland";
  }
  if (/transit|shipped|shipping|in transit|departure|arrival/.test(status)) {
    return "transit";
  }
  if (/auth|verify|verification|inspection|quality/.test(status)) return "quality";
  return "confirmed";
};

const indexFromStage = (stage: StageKey, steps: Step[]): number => {
  const order = steps.length === 4
    ? ["confirmed", "transit", "switzerland", "delivery"]
    : ["confirmed", "quality", "transit", "switzerland", "delivery"];
  const idx = order.indexOf(stage);
  if (idx < 0) return 1;
  return idx + 1;
};

const normalizeMilestoneIndex = (milestoneKey: string | null, isExpress: boolean): number | null => {
  if (!milestoneKey) return null;
  const standardMap: Record<string, number> = {
    PURCHASE_CONFIRMED: 1,
    SELLER_SHIPPED_TO_STOCKX: 2,
    STOCKX_VERIFIED_AND_SHIPPED: 3,
    DELIVERED_TO_SWISS_DISTRIBUTOR: 4,
    SWISS_POST_TRACKING_AVAILABLE: 5,
  };
  const expressMap: Record<string, number> = {
    EXPRESS_CONFIRMED: 1,
    EXPRESS_SHIPPED_TO_SWISS: 2,
    EXPRESS_DELIVERED_TO_SWISS: 3,
    SWISS_POST_TRACKING_AVAILABLE_EXPRESS: 4,
  };
  const selectedMap = isExpress ? expressMap : standardMap;
  return selectedMap[milestoneKey] || null;
};

export default async function TrackingPage({ params }: Params) {
  const orderMatchId = await resolveOrderMatchIdFromTrackingToken(params.token);
  if (!orderMatchId) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-700">Lien invalide ou expiré.</p>
      </div>
    );
  }

  const match = await prisma.orderMatch.findUnique({
    where: { id: orderMatchId },
  });

  if (!match) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-700">Commande introuvable.</p>
      </div>
    );
  }

  const states = (match.stockxStates as StockXState[]) || [];
  const orderNumber = match.stockxOrderNumber || "";
  const statusRaw = match.stockxStatus ? String(match.stockxStatus) : null;
  const isGoat = match.supplierSource === "OTHER" || /GOAT/i.test(orderNumber);
  const isGoatInstant =
    isGoat && /instant|insta-?ship|instantship|fast/.test(`${orderNumber} ${statusRaw || ""}`.toLowerCase());
  const isStockxExpress =
    !isGoat &&
    (orderNumber.startsWith("01-") || (match.stockxCheckoutType || "").startsWith("EXPRESS"));
  const steps = isGoat
    ? isGoatInstant
      ? GOAT_INSTANT_STEPS
      : GOAT_NORMAL_STEPS
    : isStockxExpress
      ? EXPRESS_STEPS
      : STANDARD_STEPS;

  const milestone = !isGoat ? detectMilestone(match.stockxCheckoutType, states, orderNumber) : null;
  const milestoneIndex = normalizeMilestoneIndex(milestone?.key || null, isStockxExpress);
  const fallbackIndex = indexFromStage(stageFromStatus(statusRaw), steps);
  const activeIndex = milestoneIndex || fallbackIndex;

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-6 space-y-4">
        <h1 className="text-2xl font-semibold text-gray-900">Suivi de commande</h1>
        <p className="text-sm text-gray-600">Commande {match.shopifyOrderName}</p>
        <div className="bg-gray-100 rounded-lg p-4">
          <p className="text-xs uppercase tracking-wide text-gray-500">Étape actuelle</p>
          <p className="text-lg font-semibold text-gray-900">
            {steps[activeIndex - 1]?.title || "En attente"}
          </p>
          <p className="text-sm text-gray-700">
            {steps[activeIndex - 1]?.description || "Nous préparons votre commande."}
          </p>
        </div>
        <div className="space-y-3">
          {steps.map((step, index) => {
            const stepIndex = index + 1;
            const isDone = stepIndex < activeIndex;
            const isActive = stepIndex === activeIndex;
            return (
              <div
                key={step.key}
                className={`border rounded-lg p-3 ${
                  isActive ? "border-blue-300 bg-blue-50" : isDone ? "border-green-200 bg-green-50" : "border-gray-200"
                }`}
              >
                <div className="flex justify-between items-center">
                  <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
                  <span className="text-xs text-gray-500">
                    {isActive ? "En cours" : isDone ? "Terminé" : "À venir"}
                  </span>
                </div>
                <p className="text-xs text-gray-700">{step.description}</p>
              </div>
            );
          })}
        </div>
        <div className="text-xs text-gray-500">
          La livraison finale est assurée par le transporteur local (ex. Swiss Post).
        </div>
      </div>
    </div>
  );
}

