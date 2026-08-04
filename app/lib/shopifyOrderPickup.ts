export type ShopifyPickupInfo = {
  isStorePickup: boolean;
  locationName: string | null;
  locationId: string | null;
  label: string | null;
  locationAddress: {
    address1?: string | null;
    address2?: string | null;
    city?: string | null;
    zip?: string | null;
    country?: string | null;
    countryCode?: string | null;
    phone?: string | null;
  } | null;
};

type ShippingLineInput = {
  title?: string | null;
  isRemoved?: boolean | null;
};

type FulfillmentOrderInput = {
  deliveryMethod?: {
    methodType?: string | null;
    presentedName?: string | null;
  } | null;
  assignedLocation?: {
    name?: string | null;
    location?: {
      id?: string | null;
      name?: string | null;
      address?: {
        address1?: string | null;
        address2?: string | null;
        city?: string | null;
        zip?: string | null;
        country?: string | null;
        countryCode?: string | null;
        phone?: string | null;
      } | null;
    } | null;
  } | null;
};

const PICKUP_TITLE_RE = /pick\s?up|retrait|click\s?&?\s?collect|ramassage|collecte en magasin|store pickup/i;

function cleanLabel(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function pickupFromShippingLines(lines: ShippingLineInput[]): ShopifyPickupInfo | null {
  for (const line of lines) {
    if (line.isRemoved) continue;
    const title = cleanLabel(line.title);
    if (!title || !PICKUP_TITLE_RE.test(title)) continue;
    return {
      isStorePickup: true,
      locationName: title,
      locationId: null,
      locationAddress: null,
      label: `Pickup · ${title}`,
    };
  }
  return null;
}

function pickupFromFulfillmentOrders(orders: FulfillmentOrderInput[]): ShopifyPickupInfo | null {
  for (const fo of orders) {
    const methodType = String(fo.deliveryMethod?.methodType ?? "").trim().toUpperCase();
    const presentedName = cleanLabel(fo.deliveryMethod?.presentedName);
    const assignedName = cleanLabel(fo.assignedLocation?.name);
    const loc = fo.assignedLocation?.location;
    const locationId = cleanLabel(loc?.id);
    const locationAddress = loc?.address ?? null;
    const isPickup =
      methodType === "PICK_UP" ||
      methodType === "PICKUP" ||
      methodType === "LOCAL" ||
      Boolean(presentedName && PICKUP_TITLE_RE.test(presentedName));
    if (!isPickup) continue;
    const locationName = assignedName ?? cleanLabel(loc?.name) ?? presentedName;
    if (!locationName) {
      return {
        isStorePickup: true,
        locationName: null,
        locationId,
        locationAddress,
        label: "Store pickup",
      };
    }
    return {
      isStorePickup: true,
      locationName,
      locationId,
      locationAddress,
      label: `Pickup · ${locationName}`,
    };
  }
  return null;
}

export function parseShopifyOrderPickup(input: {
  shippingLines?: ShippingLineInput[] | null;
  fulfillmentOrders?: FulfillmentOrderInput[] | null;
}): ShopifyPickupInfo {
  const shippingLines = input.shippingLines ?? [];
  const fulfillmentOrders = input.fulfillmentOrders ?? [];
  return (
    pickupFromFulfillmentOrders(fulfillmentOrders) ??
    pickupFromShippingLines(shippingLines) ?? {
      isStorePickup: false,
      locationName: null,
      locationId: null,
      locationAddress: null,
      label: null,
    }
  );
}
