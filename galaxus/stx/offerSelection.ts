export type StxDeliveryType = "express_standard" | "express_expedited";

export type SelectedStxOffer = {
  deliveryType: StxDeliveryType;
  price: number;
  asks: number;
};

const EXPRESS_DELIVERY_RANK: Record<StxDeliveryType, number> = {
  express_expedited: 0,
  express_standard: 1,
};

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function toInt(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeDeliveryType(value: unknown): StxDeliveryType | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (normalized === "express_standard") return "express_standard";
  if (normalized === "express_expedited") return "express_expedited";
  return null;
}

export function selectStxActiveOffer(prices: unknown): SelectedStxOffer | null {
  const list = Array.isArray(prices) ? prices : [];
  const candidates: Array<SelectedStxOffer & { idx: number }> = [];

  for (let idx = 0; idx < list.length; idx += 1) {
    const row = list[idx] as any;
    const deliveryType = normalizeDeliveryType(row?.type);
    if (!deliveryType) continue;

    const price = toNumber(row?.price);
    const asks = toInt(row?.asks);
    if (!price || price <= 0) continue;
    if (asks === null || asks < 0) continue;

    candidates.push({ deliveryType, price, asks, idx });
  }

  if (candidates.length === 0) return null;

  candidates.sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    const rankDiff = EXPRESS_DELIVERY_RANK[a.deliveryType] - EXPRESS_DELIVERY_RANK[b.deliveryType];
    if (rankDiff !== 0) return rankDiff;
    return a.idx - b.idx;
  });

  const winner = candidates[0];
  return {
    deliveryType: winner.deliveryType,
    price: winner.price,
    asks: winner.asks,
  };
}
