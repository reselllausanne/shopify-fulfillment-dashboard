import { format } from "date-fns";

export type EdiDocType =
  | "ORDP"
  | "ORDR"
  | "DELR"
  | "EXPINV"
  | "INVO"
  | "EOLN"
  | "CANP"
  | "CANR";

const FORBIDDEN_CHARS = /[\\/:*?"<>|]/g;

function sanitize(value: string): string {
  return value.replace(FORBIDDEN_CHARS, "_");
}

export function buildTimestamp(date = new Date()): string {
  return format(date, "yyyyMMdd-HHmmss");
}

export function buildEdiFilename(options: {
  docType: EdiDocType;
  supplierId: string;
  orderId: string;
  docNo?: string | null;
  timestamp?: string;
  extension?: string;
}): string {
  const timestamp = options.timestamp ?? buildTimestamp();
  const supplierId = sanitize(options.supplierId);
  const orderId = sanitize(options.orderId);
  const docNo = options.docNo ? sanitize(options.docNo) : null;
  const extension = options.extension ?? "xml";

  const prefix = `G${options.docType}`;
  const parts = [prefix, supplierId, orderId];
  if (docNo) parts.push(docNo);
  if (options.docType !== "ORDP") parts.push(timestamp);
  return `${parts.join("_")}.${extension}`;
}

export function buildExpinvFilename(options: {
  orderId: string;
  invoiceNoPartner: string;
}): string {
  const orderId = sanitize(options.orderId);
  const invoiceNo = sanitize(options.invoiceNoPartner);
  return `${orderId}_${invoiceNo}.pdf`;
}
