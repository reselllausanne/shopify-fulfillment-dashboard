export type FulfillmentHomeAddress = {
  name1: string;
  name2: string | null;
  street: string;
  zip: string;
  city: string;
  country: string;
  phone: string | null;
  email: string | null;
};

/** Default return destination when fulfillment scans inbound StockX AWB. Override via env. */
export function resolveFulfillmentHomeAddress(): FulfillmentHomeAddress {
  return {
    name1: String(process.env.FULFILLMENT_HOME_NAME1 || "Solutions Manzinali").trim(),
    name2: String(process.env.FULFILLMENT_HOME_NAME2 || "").trim() || null,
    street: String(
      process.env.FULFILLMENT_HOME_STREET || "Chemin de bas de plan 6"
    ).trim(),
    zip: String(process.env.FULFILLMENT_HOME_ZIP || "1030").trim(),
    city: String(process.env.FULFILLMENT_HOME_CITY || "Bussigny").trim(),
    country: String(process.env.FULFILLMENT_HOME_COUNTRY || "CH").trim() || "CH",
    phone: String(process.env.FULFILLMENT_HOME_PHONE || "").trim() || null,
    email: String(process.env.FULFILLMENT_HOME_EMAIL || "").trim() || null,
  };
}
