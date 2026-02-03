import path from "path";

export const SUPABASE_DOCS_BUCKET = process.env.SUPABASE_DOCS_BUCKET ?? "Galaxus-invoice";
export const SUPABASE_URL = process.env.SUPABASE_URL ?? "";
export const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";

export const SUPABASE_SERVICE_ROLE_KEY_SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY_SECRET ?? "";

export const GALAXUS_DOCS_LOCAL_DIR =
  process.env.GALAXUS_DOCS_LOCAL_DIR ?? path.join(process.cwd(), "galaxus-docs");

export const GOLDEN_SUPPLIER_API_BASE_URL =
  process.env.GOLDEN_SUPPLIER_API_BASE_URL ?? "https://www.goldensneakers.net/api";
export const GOLDEN_SUPPLIER_API_KEY = process.env.GOLDEN_SUPPLIER_API_KEY ?? "";
export const GOLDEN_SUPPLIER_API_KEY_HEADER =
  process.env.GOLDEN_SUPPLIER_API_KEY_HEADER ?? "Authorization";
export const GOLDEN_SUPPLIER_API_KEY_PREFIX =
  process.env.GOLDEN_SUPPLIER_API_KEY_PREFIX ?? "Bearer ";

export const KICKDB_API_BASE_URL = process.env.KICKDB_API_BASE_URL ?? "https://api.kicks.dev/v3";
export const KICKDB_API_KEY = process.env.KICKDB_API_KEY ?? "";
export const KICKDB_API_KEY_HEADER = process.env.KICKDB_API_KEY_HEADER ?? "Authorization";
export const KICKDB_API_KEY_PREFIX = process.env.KICKDB_API_KEY_PREFIX ?? "Bearer ";

export const GALAXUS_SUPPLIER_NAME = process.env.GALAXUS_SUPPLIER_NAME ?? "Supplier Name";
export const GALAXUS_SUPPLIER_ADDRESS_LINES =
  (process.env.GALAXUS_SUPPLIER_ADDRESS_LINES ?? "Street 1|8000 Zurich|Switzerland")
    .split("|")
    .map((line) => line.trim())
    .filter(Boolean);
export const GALAXUS_SUPPLIER_PHONE = process.env.GALAXUS_SUPPLIER_PHONE ?? "";
export const GALAXUS_SUPPLIER_EMAIL = process.env.GALAXUS_SUPPLIER_EMAIL ?? "";
export const GALAXUS_SUPPLIER_WEBSITE = process.env.GALAXUS_SUPPLIER_WEBSITE ?? "";
export const GALAXUS_SUPPLIER_VAT_ID = process.env.GALAXUS_SUPPLIER_VAT_ID ?? "";

// Galaxus buyer address is fixed for PDF invoices.
export const GALAXUS_BUYER_NAME = "Digitec Galaxus AG";
export const GALAXUS_BUYER_ADDRESS1 = "Pfingstweidstrasse 60b";
export const GALAXUS_BUYER_ADDRESS2 = null;
export const GALAXUS_BUYER_POSTAL_CODE = "CH-8005";
export const GALAXUS_BUYER_CITY = "Zürich";
export const GALAXUS_BUYER_COUNTRY = "Switzerland";
