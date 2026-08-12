/**
 * Swiss Post Barcode / DCAPI recipient addressing.
 *
 * Docs (handbuch.post.ch + developer.post.ch):
 * - personallyAddressed=true (default): person first (particulier)
 * - personallyAddressed=false: company first, then recipient (professionnel)
 * - Name1: last name (+ first if no Firstname) OR company name (max 35)
 * - Firstname: person first name (optional)
 * - Name2: dept / company suffix / contact
 * - Name3: Attn/FAO / c/o / further contact
 *
 * Always put the natural person on the label when known (Name2/Name3 for business).
 */

export const SWISS_POST_RECIPIENT_NAME_MAX = 35;

export type SwissPostRecipientPayload = {
  personallyAddressed: boolean;
  name1: string;
  firstName: string | null;
  name2: string | null;
  name3: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
};

export type SwissPostRecipientNameFields = Pick<
  SwissPostRecipientPayload,
  "personallyAddressed" | "name1" | "firstName" | "name2" | "name3"
>;

export function normalizeSwissPostText(value: unknown): string {
  return String(value ?? "")
    .replace(/[\r\n\t]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function truncateSwissPostName(value: string, max = SWISS_POST_RECIPIENT_NAME_MAX): string {
  if (value.length <= max) return value;
  return value.slice(0, max).trim();
}

export function isSwissPostBusinessCustomerType(customerType?: string | null): boolean {
  const t = normalizeSwissPostText(customerType).toLowerCase();
  return ["company", "business", "organisation", "organization", "b2b"].includes(t);
}

export function isSwissPostPrivateCustomerType(customerType?: string | null): boolean {
  const t = normalizeSwissPostText(customerType).toLowerCase();
  return ["private_customer", "private", "person", "individual", "b2c"].includes(t);
}

export function looksLikeSwissPostBusinessName(name: string): boolean {
  const normalized = ` ${name.toLowerCase()} `;
  return [
    " ag ",
    " gmbh ",
    " sa ",
    " sarl ",
    " ltd ",
    " llc ",
    " inc ",
    " company ",
    " co ",
    " shop ",
    " digitec ",
    " galaxus ",
    " sàrl ",
    " s.a. ",
    " s.a ",
    " bv ",
    " nv ",
  ].some((needle) => normalized.includes(needle));
}

function sameName(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeSwissPostText(a).toLowerCase();
  const right = normalizeSwissPostText(b).toLowerCase();
  return Boolean(left) && left === right;
}

function joinPersonName(firstName?: string | null, lastName?: string | null): string {
  return [normalizeSwissPostText(firstName), normalizeSwissPostText(lastName)].filter(Boolean).join(" ");
}

function splitPersonName(rawName: string): { firstName: string | null; name1: string } {
  const cleaned = normalizeSwissPostText(rawName);
  if (!cleaned) return { firstName: null, name1: "" };
  if (looksLikeSwissPostBusinessName(cleaned)) {
    return { firstName: null, name1: cleaned };
  }
  const parts = cleaned.split(" ").filter(Boolean);
  if (parts.length < 2) {
    return { firstName: null, name1: cleaned };
  }
  const firstName = parts[0];
  const name1 = parts.slice(1).join(" ").trim();
  if (!name1) return { firstName: null, name1: cleaned };
  return { firstName, name1 };
}

/**
 * Resolve Name1 / Firstname / Name2 / Name3 + personallyAddressed for Post labels.
 */
export function buildSwissPostRecipientNameFields(input: {
  /** Explicit company / organisation (Shopify `company`, Galaxus business recipientName). */
  company?: string | null;
  /** Natural person full name (customer / contact / reference person). */
  personName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  /** Galaxus UDX.DG.CUSTOMER_TYPE: `company` | `private_customer` */
  customerType?: string | null;
  /** Department / NAME2 leftover when not the person. */
  department?: string | null;
}): SwissPostRecipientNameFields {
  const company = normalizeSwissPostText(input.company) || null;
  const department = normalizeSwissPostText(input.department) || null;
  const explicitFirst = normalizeSwissPostText(input.firstName) || null;
  const explicitLast = normalizeSwissPostText(input.lastName) || null;
  const joinedExplicit = joinPersonName(explicitFirst, explicitLast) || null;
  const personName =
    normalizeSwissPostText(input.personName) || joinedExplicit || null;

  const forcedPrivate = isSwissPostPrivateCustomerType(input.customerType);
  const forcedBusiness = isSwissPostBusinessCustomerType(input.customerType);

  const companyLooksBusiness = company ? looksLikeSwissPostBusinessName(company) : false;
  const personLooksBusiness = personName ? looksLikeSwissPostBusinessName(personName) : false;

  const hasDistinctCompany =
    Boolean(company) && (!personName || !sameName(company, personName));

  const isBusiness =
    !forcedPrivate &&
    (forcedBusiness ||
      hasDistinctCompany ||
      companyLooksBusiness ||
      (!company && personLooksBusiness));

  if (isBusiness) {
    const companyName =
      company ||
      (personLooksBusiness ? personName : null) ||
      personName ||
      "";

    let contact: string | null = null;
    if (personName && !sameName(personName, companyName) && !looksLikeSwissPostBusinessName(personName)) {
      contact = personName;
    } else if (
      joinedExplicit &&
      !sameName(joinedExplicit, companyName) &&
      !looksLikeSwissPostBusinessName(joinedExplicit)
    ) {
      contact = joinedExplicit;
    }

    const name2 = contact
      ? truncateSwissPostName(contact)
      : department && !sameName(department, companyName)
        ? truncateSwissPostName(department)
        : null;

    const name3 =
      contact && department && !sameName(department, contact) && !sameName(department, companyName)
        ? truncateSwissPostName(department)
        : null;

    return {
      personallyAddressed: false,
      name1: truncateSwissPostName(companyName),
      firstName: null,
      name2,
      name3,
    };
  }

  // Particulier
  let firstName: string | null = explicitFirst;
  let name1 = explicitLast || "";

  if (!name1) {
    const source = personName || company || "";
    if (explicitFirst && personName && personName.toLowerCase().startsWith(explicitFirst.toLowerCase())) {
      const rest = personName.slice(explicitFirst.length).trim();
      name1 = rest || source;
    } else {
      const split = splitPersonName(source);
      firstName = firstName || split.firstName;
      name1 = split.name1 || source;
    }
  }

  const name2 =
    department && !sameName(department, name1) && !sameName(department, joinPersonName(firstName, name1))
      ? truncateSwissPostName(department)
      : null;

  return {
    personallyAddressed: true,
    name1: truncateSwissPostName(name1 || personName || company || ""),
    firstName: firstName ? truncateSwissPostName(firstName) : null,
    name2,
    name3: null,
  };
}

export function sanitizeStreetForSwissPost(baseStreet: unknown, extraStreet?: unknown): string {
  const base = normalizeSwissPostText(baseStreet);
  const extra = normalizeSwissPostText(extraStreet);
  let street = base;

  if (!street && extra) {
    street = extra;
  }

  // Some marketplaces append department/notes after a comma. Swiss Post street pattern rejects this.
  if (street.includes(",")) {
    street = street.split(",")[0]?.trim() ?? street;
  }

  if (!/\d/.test(street) && extra && /\d/.test(extra)) {
    street = `${street} ${extra}`.trim();
  }

  street = street
    .replace(/[^\p{L}\p{N}\s.\-/'’]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  return street;
}

export function normalizeSwissPostCountryCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const upper = raw.toUpperCase();
  if (/^[A-Z]{2}$/.test(upper)) return upper;
  const lower = raw.toLowerCase();
  if (["schweiz", "suisse", "svizzera", "switzerland", "swiss"].includes(lower)) return "CH";
  if (["deutschland", "germany"].includes(lower)) return "DE";
  if (["france"].includes(lower)) return "FR";
  if (["italy", "italia"].includes(lower)) return "IT";
  if (["austria", "österreich", "osterreich"].includes(lower)) return "AT";
  return null;
}

export function normalizeSwissPostPostalCode(value: unknown): string | null {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  return raw.replace(/^CH[\s-]*/i, "").trim();
}

export function buildSwissPostRecipient(input: {
  company?: string | null;
  personName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  customerType?: string | null;
  department?: string | null;
  address1?: unknown;
  address2?: unknown;
  postalCode?: unknown;
  city?: unknown;
  countryCodeOrName?: unknown;
  phone?: string | null;
  email?: string | null;
}): SwissPostRecipientPayload {
  const names = buildSwissPostRecipientNameFields({
    company: input.company,
    personName: input.personName,
    firstName: input.firstName,
    lastName: input.lastName,
    customerType: input.customerType,
    department: input.department,
  });

  const country = normalizeSwissPostCountryCode(input.countryCodeOrName) ?? "CH";
  const zip = normalizeSwissPostPostalCode(input.postalCode) ?? "";
  const baseStreet = normalizeSwissPostText(input.address1);
  const extraStreet = normalizeSwissPostText(input.address2);
  const street = sanitizeStreetForSwissPost(baseStreet, extraStreet);

  // If address2 was not used as street continuation and is not already a name field, keep as name2/3 filler.
  let { name2, name3 } = names;
  const leftover =
    extraStreet &&
    extraStreet !== street &&
    !sameName(extraStreet, names.name1) &&
    !sameName(extraStreet, names.name2) &&
    !sameName(extraStreet, joinPersonName(names.firstName, names.name1))
      ? extraStreet
      : null;

  if (leftover) {
    if (!name2) name2 = truncateSwissPostName(leftover);
    else if (!name3) name3 = truncateSwissPostName(leftover);
  }

  return {
    ...names,
    name2,
    name3,
    street,
    zip,
    city: normalizeSwissPostText(input.city) || "",
    country,
    phone: normalizeSwissPostText(input.phone) || null,
    email: normalizeSwissPostText(input.email) || null,
  };
}

/** Galaxus order → Post recipient (company vs private_customer + referencePerson). */
export function buildSwissPostRecipientFromGalaxusOrder(order: {
  recipientName?: string | null;
  recipientAddress1?: string | null;
  recipientAddress2?: string | null;
  recipientPostalCode?: string | null;
  recipientCity?: string | null;
  recipientCountry?: string | null;
  recipientCountryCode?: string | null;
  recipientPhone?: string | null;
  recipientEmail?: string | null;
  customerName?: string | null;
  customerAddress1?: string | null;
  customerAddress2?: string | null;
  customerPostalCode?: string | null;
  customerCity?: string | null;
  customerCountry?: string | null;
  customerCountryCode?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  referencePerson?: string | null;
  customerType?: string | null;
}): SwissPostRecipientPayload {
  const hasRecipient =
    Boolean(order.recipientName) ||
    Boolean(order.recipientAddress1) ||
    Boolean(order.recipientPostalCode) ||
    Boolean(order.recipientCity) ||
    Boolean(order.recipientCountry) ||
    Boolean(order.recipientCountryCode);

  const primaryName = hasRecipient
    ? normalizeSwissPostText(order.recipientName)
    : normalizeSwissPostText(order.customerName);
  const customerName = normalizeSwissPostText(order.customerName) || null;
  const contact = normalizeSwissPostText(order.referencePerson) || null;
  const customerType = order.customerType ?? null;
  const isBusiness =
    isSwissPostBusinessCustomerType(customerType) ||
    (!isSwissPostPrivateCustomerType(customerType) &&
      (looksLikeSwissPostBusinessName(primaryName) ||
        Boolean(contact && primaryName && !sameName(contact, primaryName))));

  // Always prefer a natural-person line when known (reference person, else distinct customer name).
  const businessPerson =
    contact ||
    (customerName && !sameName(customerName, primaryName) && !looksLikeSwissPostBusinessName(customerName)
      ? customerName
      : null);

  return buildSwissPostRecipient({
    company: isBusiness ? primaryName || null : null,
    personName: isBusiness ? businessPerson : primaryName || contact || customerName,
    customerType,
    department: null,
    address1: hasRecipient ? order.recipientAddress1 : order.customerAddress1,
    address2: hasRecipient ? order.recipientAddress2 : order.customerAddress2,
    postalCode: hasRecipient ? order.recipientPostalCode : order.customerPostalCode,
    city: hasRecipient ? order.recipientCity : order.customerCity,
    countryCodeOrName: hasRecipient
      ? order.recipientCountryCode ?? order.recipientCountry
      : order.customerCountryCode ?? order.customerCountry,
    phone: hasRecipient
      ? order.recipientPhone ?? null
      : order.customerPhone ?? order.recipientPhone ?? null,
    email: hasRecipient
      ? order.recipientEmail ?? order.customerEmail ?? null
      : order.customerEmail ?? null,
  });
}
