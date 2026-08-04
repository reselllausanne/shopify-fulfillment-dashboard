import { resolveFulfillmentHomeAddress } from "@/app/lib/fulfillmentHomeAddress";
import { LOCATIONS } from "@/shopify/inventory/locationConfig";

export type StoreShipAddress = {
  company: string;
  address1: string;
  address2: string | null;
  zip: string;
  city: string;
  country: string;
  countryCode: string;
  phone: string | null;
};

type LocationAddressInput = {
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  zip?: string | null;
  country?: string | null;
  countryCode?: string | null;
  phone?: string | null;
};

/**
 * Hardcoded pickup ship-to addresses (ops truth — not Shopify Admin location address).
 * Bussigny Shopify address is empty → warehouse/home.
 */
const STORE_ADDRESSES_BY_LOCATION_ID: Record<string, StoreShipAddress> = {
  "gid://shopify/Location/111267217794": {
    company: "Alessio Russo",
    address1: "Rue de l'arrosoir rouge 19",
    address2: null,
    zip: "2300",
    city: "La Chaux-de-Fonds",
    country: "Switzerland",
    countryCode: "CH",
    phone: null,
  },
  "gid://shopify/Location/111267250562": {
    company: "THE LAB CONCEPT",
    address1: "Rue Hans-Hugi 5",
    address2: null,
    zip: "2502",
    city: "Bienne",
    country: "Switzerland",
    countryCode: "CH",
    phone: null,
  },
  "gid://shopify/Location/111272100226": {
    company: "Maxime Schreur Sporting Bar",
    address1: "Neumarktstrasse 14",
    address2: null,
    zip: "2502",
    city: "Biel",
    country: "Switzerland",
    countryCode: "CH",
    phone: null,
  },
  "gid://shopify/Location/111267971458": {
    company: "Warehouse Bussigny",
    address1: "Chemin de Bas-de-Plan 6",
    address2: null,
    zip: "1030",
    city: "Bussigny",
    country: "Switzerland",
    countryCode: "CH",
    phone: null,
  },
  "gid://shopify/Location/72553660705": {
    company: "Website stock",
    address1: "Chemin de Bas-de-Plan 6",
    address2: null,
    zip: "1030",
    city: "Bussigny",
    country: "Switzerland",
    countryCode: "CH",
    phone: null,
  },
};

const NAME_ALIASES: Array<{ re: RegExp; locationId: string }> = [
  { re: /antica/i, locationId: "gid://shopify/Location/111267217794" },
  { re: /\blab\b|concept store|the lab concept/i, locationId: "gid://shopify/Location/111267250562" },
  { re: /cold\s*bien(ne)?|rare\s*bienne|sporting\s*bar/i, locationId: "gid://shopify/Location/111272100226" },
  { re: /bussigny|warehouse/i, locationId: "gid://shopify/Location/111267971458" },
  { re: /website|chemin|bas-de-plan|online/i, locationId: "gid://shopify/Location/72553660705" },
];

function clean(value: string | null | undefined): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed || null;
}

function addressComplete(addr: StoreShipAddress | null | undefined): addr is StoreShipAddress {
  return Boolean(addr?.address1 && addr.zip && addr.city);
}

function fromShopifyLocation(
  company: string,
  address: LocationAddressInput | null | undefined
): StoreShipAddress | null {
  if (!address) return null;
  const zip = clean(address.zip);
  const city = clean(address.city);
  const address1 = clean(address.address1);
  if (!address1 || !zip || !city) return null;
  return {
    company,
    address1,
    address2: clean(address.address2),
    zip,
    city,
    country: clean(address.country) || "Switzerland",
    countryCode: clean(address.countryCode) || "CH",
    phone: clean(address.phone),
  };
}

function byLocationId(locationId: string | null | undefined): StoreShipAddress | null {
  const id = clean(locationId);
  if (!id) return null;
  const known = STORE_ADDRESSES_BY_LOCATION_ID[id];
  return known ? { ...known } : null;
}

function byLocationName(locationName: string | null | undefined): StoreShipAddress | null {
  const name = clean(locationName);
  if (!name) return null;
  const exactId = LOCATIONS.find((l) => l.name.toLowerCase() === name.toLowerCase())?.id;
  if (exactId) {
    const hit = byLocationId(exactId);
    if (hit) return hit;
  }
  for (const alias of NAME_ALIASES) {
    if (!alias.re.test(name)) continue;
    const hit = byLocationId(alias.locationId);
    if (hit) return hit;
  }
  return null;
}

function homeAsStore(company: string | null): StoreShipAddress {
  const home = resolveFulfillmentHomeAddress();
  return {
    company: company || home.name1 || "Warehouse Bussigny",
    address1: home.street,
    address2: null,
    zip: home.zip,
    city: home.city,
    country: home.country === "CH" ? "Switzerland" : home.country,
    countryCode: home.country || "CH",
    phone: home.phone,
  };
}

/**
 * Resolve Swiss Post destination when customer chose store pickup.
 * Hardcoded store map wins (ops addresses). Shopify location address only if unknown store.
 * Last resort = fulfillment home.
 */
export function resolvePickupShipAddress(input: {
  isStorePickup: boolean;
  locationName?: string | null;
  locationId?: string | null;
  locationAddress?: LocationAddressInput | null;
}): StoreShipAddress | null {
  if (!input.isStorePickup) return null;

  const company = clean(input.locationName) || "Store pickup";

  const fromId = byLocationId(input.locationId);
  if (addressComplete(fromId)) return fromId;

  const fromName = byLocationName(input.locationName);
  if (addressComplete(fromName)) return fromName;

  const fromLive = fromShopifyLocation(company, input.locationAddress);
  if (addressComplete(fromLive)) return fromLive;

  return homeAsStore(company);
}

/** Shape compatible with Shopify shippingAddress / Swiss Post toRecipient. */
export function storeAddressAsShippingAddress(
  store: StoreShipAddress,
  customerName?: string | null
): {
  firstName: string | null;
  lastName: string | null;
  name: string | null;
  company: string;
  address1: string;
  address2: string | null;
  zip: string;
  city: string;
  province: string | null;
  country: string;
  countryCodeV2: string;
  phone: string | null;
} {
  return {
    firstName: null,
    lastName: null,
    name: clean(customerName),
    company: store.company,
    address1: store.address1,
    address2: store.address2,
    zip: store.zip,
    city: store.city,
    province: null,
    country: store.country,
    countryCodeV2: store.countryCode,
    phone: store.phone,
  };
}
