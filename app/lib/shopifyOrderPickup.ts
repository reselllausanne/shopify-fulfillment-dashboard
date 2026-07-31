export type ShopifyPickupInfo = {
  isStorePickup: boolean;
  locationName: string | null;
  label: string | null;
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
  assignedLocation?: { name?: string | null } | null;
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
    const isPickup =
      methodType === "PICK_UP" ||
      methodType === "PICKUP" ||
      methodType === "LOCAL" ||
      Boolean(presentedName && PICKUP_TITLE_RE.test(presentedName));
    if (!isPickup) continue;
    const locationName = assignedName ?? presentedName;
    if (!locationName) {
      return {
        isStorePickup: true,
        locationName: null,
        label: "Store pickup",
      };
    }
    return {
      isStorePickup: true,
      locationName,
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
      label: null,
    }
  );
}
