import { XMLParser } from "fast-xml-parser";
import { createHash } from "crypto";
import { parseCsv } from "@/app/lib/csv";

export type ParsedBankAccount = {
  iban?: string | null;
  currencyCode?: string | null;
  name?: string | null;
};

export type ParsedBankTransaction = {
  externalId?: string | null;
  bookingDate: Date;
  valueDate?: Date | null;
  amount: number;
  currencyCode: string;
  direction: "IN" | "OUT";
  counterpartyName?: string | null;
  counterpartyIban?: string | null;
  reference?: string | null;
  remittanceInfo?: string | null;
  transactionType?: string | null;
  rawJson?: any;
  fingerprint?: string;
};

export type ParsedBankStatement = {
  account: ParsedBankAccount;
  statementFrom?: Date | null;
  statementTo?: Date | null;
  transactions: ParsedBankTransaction[];
};

type CsvMapping = {
  bookingDate?: string;
  valueDate?: string;
  amount?: string;
  debit?: string;
  credit?: string;
  currency?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
  reference?: string;
  remittanceInfo?: string;
  externalId?: string;
  transactionType?: string;
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseAttributeValue: true,
  parseTagValue: true,
  trimValues: true,
});

const asArray = <T>(value: T | T[] | undefined | null): T[] => {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
};

const parseDate = (value?: string | null): Date | null => {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date;
};

const normalizeText = (value?: string | null): string | null => {
  if (!value) return null;
  const trimmed = String(value).trim();
  return trimmed.length ? trimmed : null;
};

const parseAmount = (value?: string | number | null): number => {
  if (value === null || value === undefined) return 0;
  const raw = String(value).replace(/[^0-9,.-]/g, "");
  const normalized = raw.includes(",") && !raw.includes(".")
    ? raw.replace(",", ".")
    : raw;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
};

export function buildFingerprint(seed: string) {
  return createHash("sha256").update(seed).digest("hex");
}

export function parseCamt053(xml: string): ParsedBankStatement {
  const parsed = parser.parse(xml);
  const stmtRoot =
    parsed?.Document?.BkToCstmrStmt ??
    parsed?.BkToCstmrStmt ??
    parsed?.Document?.BkToCstmrStmtV02 ??
    null;

  const statements = asArray(stmtRoot?.Stmt);
  const statement = statements[0] ?? {};
  const account = statement?.Acct ?? {};
  const iban = account?.Id?.IBAN ?? account?.Id?.Othr?.Id ?? null;
  const currencyCode = account?.Ccy ?? statement?.Ccy ?? null;
  const accountName = account?.Nm ?? null;

  const statementFrom = parseDate(statement?.FrToDt?.FrDtTm ?? statement?.FrToDt?.FrDt);
  const statementTo = parseDate(statement?.FrToDt?.ToDtTm ?? statement?.FrToDt?.ToDt);

  const transactions: ParsedBankTransaction[] = [];
  const entries = asArray(statement?.Ntry);
  for (const entry of entries) {
    const amountValue = entry?.Amt?.["#text"] ?? entry?.Amt ?? 0;
    const currency = entry?.Amt?.["@_Ccy"] ?? currencyCode ?? "CHF";
    const creditDebit = String(entry?.CdtDbtInd ?? "").toUpperCase();
    const signedAmount = parseAmount(amountValue);
    const direction = creditDebit === "DBIT" ? "OUT" : "IN";
    const amount = direction === "OUT" ? -Math.abs(signedAmount) : Math.abs(signedAmount);

    const bookingDate = parseDate(entry?.BookgDt?.Dt ?? entry?.BookgDt?.DtTm) ?? new Date();
    const valueDate = parseDate(entry?.ValDt?.Dt ?? entry?.ValDt?.DtTm);

    const entryRef = normalizeText(entry?.NtryRef);
    const acctRef = normalizeText(entry?.AcctSvcrRef);
    const txDetails = asArray(entry?.NtryDtls?.TxDtls);
    const tx = txDetails[0] ?? {};
    const refs = tx?.Refs ?? {};

    const endToEndId = normalizeText(refs?.EndToEndId);
    const txId = normalizeText(refs?.TxId);
    const refParts = [entryRef, acctRef, endToEndId, txId].filter(Boolean);
    const reference = refParts.length ? refParts.join(" | ") : null;

    const remittance = asArray(tx?.RmtInf?.Ustrd).filter(Boolean);
    const remittanceInfo = remittance.length ? remittance.join(" / ") : null;

    const counterparty =
      tx?.RltdPties?.Cdtr?.Nm ??
      tx?.RltdPties?.Dbtr?.Nm ??
      tx?.RltdPties?.UltmtCdtr?.Nm ??
      tx?.RltdPties?.UltmtDbtr?.Nm ??
      null;
    const counterpartyIban =
      tx?.RltdPties?.CdtrAcct?.Id?.IBAN ??
      tx?.RltdPties?.DbtrAcct?.Id?.IBAN ??
      null;

    const transactionType =
      tx?.BkTxCd?.Prtry?.Cd ??
      tx?.BkTxCd?.Domn?.Fmly?.SubFmlyCd ??
      tx?.BkTxCd?.Domn?.Fmly?.Cd ??
      null;

    transactions.push({
      externalId: entryRef || txId || acctRef || null,
      bookingDate,
      valueDate,
      amount,
      currencyCode: String(currency || "CHF"),
      direction,
      counterpartyName: normalizeText(counterparty),
      counterpartyIban: normalizeText(counterpartyIban),
      reference,
      remittanceInfo,
      transactionType: normalizeText(transactionType),
      rawJson: entry,
    });
  }

  return {
    account: {
      iban: normalizeText(iban),
      currencyCode: normalizeText(currencyCode),
      name: normalizeText(accountName),
    },
    statementFrom,
    statementTo,
    transactions,
  };
}

const normalizeHeader = (value: string) =>
  value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");

const buildHeaderMap = (headers: string[]) => {
  const map = new Map<string, string>();
  for (const header of headers) {
    map.set(normalizeHeader(header), header);
  }
  return map;
};

const pickHeader = (map: Map<string, string>, keys: string[]) => {
  for (const key of keys) {
    const header = map.get(normalizeHeader(key));
    if (header) return header;
  }
  return null;
};

export function parseBankCsv(
  text: string,
  mapping: CsvMapping = {},
  defaultCurrency = "CHF"
): ParsedBankStatement {
  const rows = parseCsv(text);
  const header = rows[0] ?? [];
  const headerMap = buildHeaderMap(header);

  const bookingHeader =
    mapping.bookingDate ??
    pickHeader(headerMap, ["bookingdate", "buchungstag", "date", "datum", "valuedate"]);
  const valueHeader =
    mapping.valueDate ??
    pickHeader(headerMap, ["valuedate", "valutadatum"]);
  const amountHeader =
    mapping.amount ??
    pickHeader(headerMap, ["amount", "betrag", "montant", "value"]);
  const debitHeader = mapping.debit ?? pickHeader(headerMap, ["debit", "soll"]);
  const creditHeader = mapping.credit ?? pickHeader(headerMap, ["credit", "haben"]);
  const currencyHeader =
    mapping.currency ?? pickHeader(headerMap, ["currency", "ccy", "whrg", "waehrung"]);
  const counterpartyHeader =
    mapping.counterpartyName ??
    pickHeader(headerMap, ["counterparty", "beneficiary", "name", "receiver", "empfaenger"]);
  const ibanHeader =
    mapping.counterpartyIban ??
    pickHeader(headerMap, ["iban", "counterpartyiban", "konto"]);
  const referenceHeader =
    mapping.reference ??
    pickHeader(headerMap, ["reference", "referenz", "verwendungszweck", "purpose"]);
  const remittanceHeader =
    mapping.remittanceInfo ??
    pickHeader(headerMap, ["remittance", "message", "mitteilung", "zusatz"]);
  const externalIdHeader =
    mapping.externalId ??
    pickHeader(headerMap, ["transactionid", "id", "externalid"]);
  const typeHeader =
    mapping.transactionType ??
    pickHeader(headerMap, ["type", "transactiontype", "buchungstext"]);

  const transactions: ParsedBankTransaction[] = [];
  for (const row of rows.slice(1)) {
    const rowMap: Record<string, string> = {};
    header.forEach((head, idx) => {
      rowMap[head] = row[idx] ?? "";
    });

    const bookingDate = parseDate(rowMap[bookingHeader ?? ""]);
    if (!bookingDate) continue;
    const valueDate = parseDate(rowMap[valueHeader ?? ""]);

    let amount = 0;
    let direction: "IN" | "OUT" = "IN";
    if (debitHeader && parseAmount(rowMap[debitHeader]) > 0) {
      amount = -Math.abs(parseAmount(rowMap[debitHeader]));
      direction = "OUT";
    } else if (creditHeader && parseAmount(rowMap[creditHeader]) > 0) {
      amount = Math.abs(parseAmount(rowMap[creditHeader]));
      direction = "IN";
    } else if (amountHeader) {
      amount = parseAmount(rowMap[amountHeader]);
      direction = amount < 0 ? "OUT" : "IN";
    }

    if (!amount) continue;
    const currencyCode = normalizeText(rowMap[currencyHeader ?? ""]) ?? defaultCurrency;

    transactions.push({
      externalId: normalizeText(rowMap[externalIdHeader ?? ""]),
      bookingDate,
      valueDate,
      amount,
      currencyCode,
      direction,
      counterpartyName: normalizeText(rowMap[counterpartyHeader ?? ""]),
      counterpartyIban: normalizeText(rowMap[ibanHeader ?? ""]),
      reference: normalizeText(rowMap[referenceHeader ?? ""]),
      remittanceInfo: normalizeText(rowMap[remittanceHeader ?? ""]),
      transactionType: normalizeText(rowMap[typeHeader ?? ""]),
      rawJson: rowMap,
    });
  }

  return {
    account: {},
    transactions,
  };
}
