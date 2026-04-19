import { FALLBACK_SIZE_CHARTS } from "@/galaxus/kickdb/sizeCharts";

type GoatRawOrder = Record<string, any>;

export type NormalizedGoatOrder = {
  provider: "GOAT";
  chainId: string;
  orderId: string;
  orderNumber: string;
  purchaseDate: string | null;
  purchaseDateFormatted: string | null;
  statusKey: string | null;
  statusTitle: string | null;
  amount: number | null;
  currencyCode: string | null;
  productName: string | null;
  productTitle: string | null;
  displayName: string;
  styleId: string | null;
  model: string | null;
  skuKey: string;
  size: string | null;
  sizeType: string | null;
  estimatedDeliveryDate: string | null;
  estimatedDeliveryFormatted: string | null;
  latestEstimatedDeliveryDate: string | null;
  productVariantId: string | null;
  thumbUrl: string | null;
  supplierCost: number | null;
  trackingUrl: string | null;
  awb: string | null;
};

const pickFirst = (...values: Array<unknown>): string | null => {
  for (const value of values) {
    if (value == null) continue;
    const str = String(value).trim();
    if (!str) continue;
    return str;
  }
  return null;
};

const pickNested = (obj: GoatRawOrder, path: string): unknown => {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (!current || typeof current !== "object") return null;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
};

const toNumberOrNull = (value: unknown): number | null => {
  if (value == null) return null;
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const cleaned = value.replace(/[^\d,.-]/g, "").trim();
    if (!cleaned) return null;
    const normalized = cleaned.includes(".") ? cleaned.replace(/,/g, "") : cleaned.replace(",", ".");
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
};

const toFormattedDate = (dateString: string | null): string | null => {
  if (!dateString) return null;
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString("fr-CH", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
};

const normalizeGender = (value?: string | string[] | null): "men" | "women" | "youth" => {
  if (!value) return "men";
  const raw = Array.isArray(value) ? value.join(" ") : value;
  const lower = raw.toLowerCase();
  if (/(women|womens|woman|female|w\b)/.test(lower)) return "women";
  if (/(youth|kids|kid|gs|grade school|child|children)/.test(lower)) return "youth";
  return "men";
};

const normalizeBrand = (value?: string | null): string | null => {
  if (!value) return null;
  return String(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const normalizeUsSize = (value: string): string => {
  let cleaned = value.trim();
  cleaned = cleaned.replace(/^US\s*M\s*/i, "");
  cleaned = cleaned.replace(/^US\s*W\s*/i, "");
  cleaned = cleaned.replace(/^US\s*/i, "");
  return cleaned.trim();
};

const convertUsToEu = (usValue: string, brand?: string | null, gender?: string | null): string | null => {
  if (!usValue) return null;
  const normalizedBrand = normalizeBrand(brand);
  if (!normalizedBrand) return null;
  const normalizedGender = normalizeGender(gender ?? null);
  const chart = FALLBACK_SIZE_CHARTS.find(
    (entry) => entry.brand.toLowerCase() === normalizedBrand && entry.gender === normalizedGender
  );
  if (!chart) return null;
  const normalized = normalizeUsSize(usValue).replace(/\s+/g, "");
  if (!normalized) return null;
  const index = chart.sizes.US.findIndex(
    (entry) => entry.replace(/\s+/g, "") === normalized
  );
  if (index < 0 || index >= chart.sizes.EU.length) return null;
  return chart.sizes.EU[index] ?? null;
};

const centsToAmount = (cents: number | null): number | null => {
  if (cents == null) return null;
  return Number((cents / 100).toFixed(2));
};

export const normalizeGoatOrder = (raw: GoatRawOrder): NormalizedGoatOrder | null => {
  const rawOrderId = pickFirst(raw.id, raw.orderId, raw.order_id, raw.orderNumber);
  if (!rawOrderId) return null;

  const rawOrderNumber = pickFirst(raw.orderNumber, raw.order_number, rawOrderId);
  const orderNumber = rawOrderNumber && rawOrderNumber.toUpperCase().startsWith("GOAT-")
    ? rawOrderNumber
    : `GOAT-${rawOrderNumber}`;

  const purchaseDate = pickFirst(raw.purchasedAt, raw.purchased_at, raw.createdAt, raw.created_at);

  const totalCents = toNumberOrNull(
    pickFirst(
      raw.totalCents,
      raw.total_cents,
      raw.buyerTotalCents,
      raw.buyer_total_cents,
      pickNested(raw, "buyerTotalCents"),
      pickNested(raw, "buyer_total_cents")
    )
  );
  const subtotalCents = toNumberOrNull(
    pickFirst(
      raw.subtotalCents,
      raw.subtotal_cents,
      raw.buyerSubtotalCents,
      raw.buyer_subtotal_cents,
      pickNested(raw, "buyerSubtotalCents"),
      pickNested(raw, "buyer_subtotal_cents")
    )
  );
  const shippingCents = toNumberOrNull(
    pickFirst(
      raw.shippingCents,
      raw.shipping_cents,
      raw.shippingFeeCents,
      raw.shipping_fee_cents,
      pickNested(raw, "shippingFeeCents"),
      pickNested(raw, "shipping_fee_cents")
    )
  );
  const priceCents = toNumberOrNull(pickNested(raw, "product.priceCents"));
  const localizedCents = toNumberOrNull(pickNested(raw, "product.localizedPriceCents.amount"));
  const amountCents =
    totalCents ??
    (subtotalCents != null && shippingCents != null ? subtotalCents + shippingCents : null) ??
    localizedCents ??
    priceCents;
  const amount = centsToAmount(amountCents);

  const currencyCode = pickFirst(
    pickNested(raw, "product.localizedPriceCents.currency"),
    raw.currency,
    "CHF"
  );

  const productTitle = pickFirst(
    pickNested(raw, "product.productTemplate.name"),
    pickNested(raw, "product.productTemplate.nickname"),
    pickNested(raw, "product.slug")
  );

  const skuKeyRaw = pickFirst(
    pickNested(raw, "product.productTemplate.sku"),
    pickNested(raw, "product.productTemplate.slug"),
    rawOrderId
  );
  const skuKey = skuKeyRaw ? skuKeyRaw.replace(/\s+/g, "-").trim() : null;

  const sizeUnit = pickFirst(pickNested(raw, "product.productTemplate.sizeUnit")) || "us";
  const sizePresentation = pickFirst(
    pickNested(raw, "product.sizeOption.presentation"),
    pickNested(raw, "product.size"),
    pickNested(raw, "product.sizeOption.value")
  );
  const brand = pickFirst(
    pickNested(raw, "product.productTemplate.sizeBrand"),
    pickNested(raw, "product.productTemplate.brandName")
  );
  const gender = pickFirst(
    pickNested(raw, "product.productTemplate.singleGender"),
    pickNested(raw, "product.productTemplate.gender")
  );
  let size = sizePresentation ? `${sizeUnit.toUpperCase()} ${sizePresentation}` : null;
  let sizeType = sizeUnit ? sizeUnit.toUpperCase() : null;
  if (sizePresentation && sizeUnit.toLowerCase() === "us") {
    const eu = convertUsToEu(sizePresentation, brand, gender);
    if (eu) {
      size = `EU ${eu}`;
      sizeType = "EU";
    }
  }
  if (size?.toUpperCase().startsWith("EU ")) {
    sizeType = "EU";
  }

  const statusKey = pickFirst(raw.status, raw.saleStatus, raw.state, raw.buyerTitle);
  const statusTitle = statusKey;

  const trackingUrl = pickFirst(raw.trackingToBuyerCodeUrl, raw.tracking_to_buyer_code_url);
  const awb = pickFirst(raw.trackingToBuyerCode, raw.tracking_to_buyer_code);

  const thumbUrl = pickFirst(
    pickNested(raw, "product.mainPictureUrl"),
    pickNested(raw, "product.pictureUrl"),
    pickNested(raw, "product.mainGlowPictureUrl")
  );

  return {
    provider: "GOAT",
    chainId: "",
    orderId: rawOrderId,
    orderNumber,
    purchaseDate,
    purchaseDateFormatted: toFormattedDate(purchaseDate),
    statusKey,
    statusTitle,
    amount,
    currencyCode,
    productName: productTitle,
    productTitle,
    displayName: productTitle || "—",
    styleId: null,
    model: null,
    skuKey: skuKey || "unknown",
    size,
    sizeType,
    estimatedDeliveryDate: null,
    estimatedDeliveryFormatted: null,
    latestEstimatedDeliveryDate: null,
    productVariantId: null,
    thumbUrl,
    supplierCost: amount,
    trackingUrl,
    awb,
  };
};

export const extractOrdersArray = (json: unknown): GoatRawOrder[] => {
  if (Array.isArray(json)) return json as GoatRawOrder[];
  if (!json || typeof json !== "object") return [];
  const data = json as Record<string, unknown>;
  const candidates = [data.orders, data.data, data.items, data.results];
  for (const candidate of candidates) {
    if (Array.isArray(candidate)) return candidate as GoatRawOrder[];
  }
  return [];
};
