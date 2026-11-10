/**
 * Galaxus warehouse ship-to.
 *
 * ORDP delivery party is the source of truth. Wohlen (Villmergen) and Bülach
 * (Fiege) can both appear. Invoice / buyer stays Zürich and is not this module.
 */

export type GalaxusWarehouseSiteKey = "wohlen" | "buelach";

export type GalaxusWarehouseSite = {
  key: GalaxusWarehouseSiteKey;
  label: string;
  gln: string;
  name: string;
  /** Printed when the order has no second address line. */
  careOf: string | null;
  street: string;
  postalCode: string;
  city: string;
};

export const GALAXUS_WAREHOUSE_SITES: readonly GalaxusWarehouseSite[] = [
  {
    key: "wohlen",
    label: "Wohlen",
    gln: "7640151820015",
    name: "Digitec Galaxus AG",
    careOf: null,
    street: "Ferroring 23",
    postalCode: "5612",
    city: "Villmergen",
  },
  {
    key: "buelach",
    label: "Bülach",
    gln: "7640151820107",
    name: "Digitec Galaxus AG",
    careOf: "c/o Fiege Logistik Schweiz AG",
    street: "Schützenmattstrasse 133/137",
    postalCode: "8180",
    city: "Bülach",
  },
] as const;

export type GalaxusShipToInput = {
  galaxusOrderId?: string | null;
  orderNumber?: string | null;
  deliveryPartyGln?: string | null;
  recipientName?: string | null;
  recipientAddress1?: string | null;
  recipientAddress2?: string | null;
  recipientPostalCode?: string | null;
  recipientCity?: string | null;
  recipientCountry?: string | null;
};

export type GalaxusShipToView = {
  siteKey: GalaxusWarehouseSiteKey | null;
  label: string;
  known: boolean;
  gln: string | null;
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
  summary: string;
};

function trim(value: unknown): string {
  return String(value ?? "").trim();
}

export function foldGalaxusAddressText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/ß/g, "ss")
    .toLowerCase();
}

export function galaxusPostalDigits(value: string | null | undefined): string {
  return foldGalaxusAddressText(trim(value)).replace(/^ch[\s-]*/, "").replace(/\D/g, "");
}

export function galaxusStreetKey(value: string | null | undefined): string {
  return foldGalaxusAddressText(trim(value)).replace(/[^a-z0-9]/g, "");
}

export function galaxusGlnDigits(value: string | null | undefined): string {
  return trim(value).replace(/\D/g, "");
}

export function formatGalaxusPostalCode(
  postalCode: string,
  country?: string | null
): string {
  const raw = trim(postalCode);
  const digits = galaxusPostalDigits(raw);
  const countryFold = foldGalaxusAddressText(trim(country));
  const isCh =
    !countryFold ||
    countryFold === "ch" ||
    countryFold === "schweiz" ||
    countryFold === "switzerland" ||
    countryFold === "suisse" ||
    countryFold === "svizzera" ||
    /^ch[\s-]/i.test(raw);
  if (isCh && /^\d{4}$/.test(digits)) return `CH-${digits}`;
  return raw;
}

function matchGalaxusWarehouseSiteByAddress(
  input: GalaxusShipToInput
): GalaxusWarehouseSite | null {
  const postal = galaxusPostalDigits(input.recipientPostalCode);
  const street = galaxusStreetKey(input.recipientAddress1);
  const city = foldGalaxusAddressText(trim(input.recipientCity));
  if (!street) return null;
  for (const site of GALAXUS_WAREHOUSE_SITES) {
    const siteStreet = galaxusStreetKey(site.street);
    const streetHit =
      street.includes(siteStreet) || (siteStreet.length >= 8 && siteStreet.includes(street));
    if (!streetHit) continue;
    if (postal && postal === site.postalCode) return site;
    if (city && city === foldGalaxusAddressText(site.city)) return site;
  }
  return null;
}

export function matchGalaxusWarehouseSite(
  input: GalaxusShipToInput
): GalaxusWarehouseSite | null {
  const byAddress = matchGalaxusWarehouseSiteByAddress(input);
  const gln = galaxusGlnDigits(input.deliveryPartyGln);
  const byGln = gln ? GALAXUS_WAREHOUSE_SITES.find((site) => site.gln === gln) ?? null : null;
  // Street on the label is what the carrier delivers. If GLN and street name different sites, follow the street.
  if (byAddress && byGln && byAddress.key !== byGln.key) return byAddress;
  return byGln ?? byAddress;
}

export function describeGalaxusWarehouseShipTo(input: GalaxusShipToInput): GalaxusShipToView {
  const site = matchGalaxusWarehouseSite(input);
  const line1 = trim(input.recipientAddress1);
  const orderLine2 = trim(input.recipientAddress2);
  const line2 = orderLine2 || (site?.careOf ?? "") || null;
  const city = trim(input.recipientCity);
  const postalCode = formatGalaxusPostalCode(trim(input.recipientPostalCode), input.recipientCountry);
  const name = trim(input.recipientName) || site?.name || "Digitec Galaxus AG";
  const country = trim(input.recipientCountry) || "Schweiz";
  const gln = galaxusGlnDigits(input.deliveryPartyGln) || site?.gln || null;
  const label = site?.label ?? (line1 || city ? "Unknown warehouse" : "No delivery address");
  const parts = [label, line2, line1, [postalCode, city].filter(Boolean).join(" ")].filter(
    (part): part is string => Boolean(part)
  );
  return {
    siteKey: site?.key ?? null,
    label,
    known: Boolean(site),
    gln,
    name,
    line1,
    line2: line2 || null,
    postalCode,
    city,
    country,
    summary: parts.join(" · "),
  };
}

export type SsccRecipientAddress = {
  name: string;
  line1: string;
  line2: string | null;
  postalCode: string;
  city: string;
  country: string;
  vatId: null;
};

/** Physical SSCC / Swiss Post warehouse recipient. Never substitutes another warehouse. */
export function ssccRecipientFromGalaxusOrder(input: GalaxusShipToInput): SsccRecipientAddress {
  const view = describeGalaxusWarehouseShipTo(input);
  if (!view.line1 || !view.city || !view.postalCode) {
    const ref = trim(input.orderNumber) || trim(input.galaxusOrderId) || "unknown";
    throw new Error(
      `Galaxus order ${ref} has no delivery address on the ORDP. SSCC label not printed.`
    );
  }
  return {
    name: view.name,
    line1: view.line1,
    line2: view.line2,
    postalCode: view.postalCode,
    city: view.city,
    country: view.country,
    vatId: null,
  };
}

function addressKey(input: GalaxusShipToInput): string {
  return [
    galaxusPostalDigits(input.recipientPostalCode),
    galaxusStreetKey(input.recipientAddress1),
    foldGalaxusAddressText(trim(input.recipientCity)),
  ].join("|");
}

/**
 * True when two orders must not share one parcel.
 * Same GLN wins over small street-text differences. Missing GLN falls back to street + postal + city.
 */
export function galaxusWarehouseShipToConflict(
  a: GalaxusShipToInput,
  b: GalaxusShipToInput
): boolean {
  const glnA = galaxusGlnDigits(a.deliveryPartyGln);
  const glnB = galaxusGlnDigits(b.deliveryPartyGln);
  if (glnA && glnB) return glnA !== glnB;
  return addressKey(a) !== addressKey(b);
}

export function galaxusWarehouseMixMessage(a: GalaxusShipToInput, b: GalaxusShipToInput): string {
  const left = describeGalaxusWarehouseShipTo(a);
  const right = describeGalaxusWarehouseShipTo(b);
  return `Different Galaxus warehouse. This box is ${left.summary}. Scanned order ships to ${right.summary}. Pack a separate box.`;
}
