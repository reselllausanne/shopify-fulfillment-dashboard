import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { createHash } from "crypto";
import { prisma } from "@/app/lib/prisma";
import {
  parseBankCsv,
  parseCamt053,
  buildFingerprint,
  ParsedBankTransaction,
} from "@/app/lib/bank/import";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type ImportPayload = {
  sourceType?: "CAMT053" | "CSV";
  accountId?: string;
  accountIban?: string;
  accountName?: string;
  currencyCode?: string;
  fileName?: string;
  content?: string;
  mapping?: Record<string, string>;
};

const detectSourceType = (fileName?: string | null, contentType?: string | null) => {
  const name = (fileName ?? "").toLowerCase();
  if (name.endsWith(".xml") || contentType?.includes("xml")) return "CAMT053";
  if (name.endsWith(".csv") || contentType?.includes("csv")) return "CSV";
  return null;
};

const ensureAccount = async (payload: {
  accountId?: string;
  accountIban?: string | null;
  accountName?: string | null;
  currencyCode?: string | null;
}) => {
  const { accountId, accountIban, accountName, currencyCode } = payload;
  if (accountId) {
    const account = await prisma.bankAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      throw new Error("Bank account not found");
    }
    return account;
  }

  if (!accountIban) {
    throw new Error("Missing bank account identifier (accountId or accountIban required).");
  }

  const account = await prisma.bankAccount.upsert({
    where: { iban: accountIban },
    update: {},
    create: {
      name: accountName || accountIban,
      iban: accountIban,
      currencyCode: currencyCode || "CHF",
      accountType: "BANK",
    },
  });
  return account;
};

const normalizeTransactions = (
  rows: ParsedBankTransaction[],
  defaultCurrency: string
): ParsedBankTransaction[] =>
  rows
    .filter((row) => row.bookingDate)
    .map((row) => {
      const amount = Number(row.amount.toFixed(2));
      const currencyCode = row.currencyCode || defaultCurrency || "CHF";
      const direction: "IN" | "OUT" = amount < 0 ? "OUT" : "IN";
      return {
        ...row,
        amount,
        currencyCode,
        direction,
      };
    });

const buildFingerprintSeed = (accountId: string, row: ParsedBankTransaction) => {
  const dateKey = row.bookingDate.toISOString().slice(0, 10);
  const parts = [
    accountId,
    dateKey,
    row.amount?.toFixed?.(2) ?? String(row.amount),
    row.currencyCode ?? "",
    row.externalId ?? "",
    row.reference ?? "",
    row.counterpartyName ?? "",
  ];
  return parts.join("|");
};

export async function GET() {
  try {
    const items = await prisma.bankStatementImport.findMany({
      orderBy: { importedAt: "desc" },
      include: { bankAccount: true },
    });
    return NextResponse.json({ success: true, items });
  } catch (error: any) {
    console.error("[BANK][IMPORTS] GET error:", error);
    return NextResponse.json(
      { error: "Failed to fetch imports", details: error.message },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const contentType = req.headers.get("content-type") || "";
    let payload: ImportPayload = {};
    let rawContent = "";
    let sourceType: "CAMT053" | "CSV" | null = null;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      const file = formData.get("file") as File | null;
      if (!file) {
        return NextResponse.json({ error: "Missing file" }, { status: 400 });
      }
      rawContent = await file.text();
      payload = {
        sourceType: (formData.get("sourceType") as string | null) as any,
        accountId: (formData.get("accountId") as string | null) ?? undefined,
        accountIban: (formData.get("accountIban") as string | null) ?? undefined,
        accountName: (formData.get("accountName") as string | null) ?? undefined,
        currencyCode: (formData.get("currencyCode") as string | null) ?? undefined,
        fileName: file.name,
      };
      sourceType = payload.sourceType || detectSourceType(file.name, file.type);
    } else if (contentType.includes("application/json")) {
      payload = (await req.json()) as ImportPayload;
      rawContent = payload.content ?? "";
      sourceType = payload.sourceType || detectSourceType(payload.fileName, contentType);
    } else {
      rawContent = await req.text();
      sourceType = detectSourceType(undefined, contentType);
    }

    if (!rawContent) {
      return NextResponse.json({ error: "Empty file" }, { status: 400 });
    }
    if (!sourceType) {
      return NextResponse.json({ error: "Unknown sourceType (CAMT053 or CSV)" }, { status: 400 });
    }

    const fileHash = createHash("sha256").update(rawContent).digest("hex");
    let parsed: ReturnType<typeof parseCamt053> | ReturnType<typeof parseBankCsv>;

    if (sourceType === "CAMT053") {
      parsed = parseCamt053(rawContent);
    } else {
      parsed = parseBankCsv(rawContent, payload.mapping, payload.currencyCode || "CHF");
    }

    const account = await ensureAccount({
      accountId: payload.accountId,
      accountIban: payload.accountIban ?? parsed.account.iban ?? null,
      accountName: payload.accountName ?? parsed.account.name ?? null,
      currencyCode: payload.currencyCode ?? parsed.account.currencyCode ?? "CHF",
    });

    const existing = await prisma.bankStatementImport.findFirst({
      where: { bankAccountId: account.id, fileHash },
    });
    if (existing) {
      return NextResponse.json({
        success: true,
        message: "File already imported",
        importId: existing.id,
        skipped: true,
      });
    }

    const transactions = normalizeTransactions(parsed.transactions, account.currencyCode);

    const importRow = await prisma.bankStatementImport.create({
      data: {
        bankAccountId: account.id,
        sourceType,
        sourceFileName: payload.fileName ?? null,
        fileHash,
        statementFrom: "statementFrom" in parsed ? parsed.statementFrom ?? null : null,
        statementTo: "statementTo" in parsed ? parsed.statementTo ?? null : null,
        metadataJson: {
          sourceType,
          accountIban: account.iban,
          fileName: payload.fileName ?? null,
        },
      },
    });

    const rows = transactions.map((tx) => {
      const seed = buildFingerprintSeed(account.id, tx);
      const fingerprint = buildFingerprint(seed);
      return {
        bankAccountId: account.id,
        statementImportId: importRow.id,
        externalId: tx.externalId ?? null,
        bookingDate: tx.bookingDate,
        valueDate: tx.valueDate ?? null,
        amount: new Prisma.Decimal(tx.amount),
        currencyCode: tx.currencyCode || account.currencyCode,
        direction: tx.direction,
        counterpartyName: tx.counterpartyName ?? null,
        counterpartyIban: tx.counterpartyIban ?? null,
        reference: tx.reference ?? null,
        remittanceInfo: tx.remittanceInfo ?? null,
        transactionType: tx.transactionType ?? null,
        fingerprint,
        rawJson: tx.rawJson ?? null,
      };
    });

    const created = await prisma.bankTransaction.createMany({
      data: rows,
      skipDuplicates: true,
    });

    return NextResponse.json({
      success: true,
      importId: importRow.id,
      totalParsed: transactions.length,
      inserted: created.count,
      skipped: transactions.length - created.count,
    });
  } catch (error: any) {
    console.error("[BANK][IMPORTS] POST error:", error);
    return NextResponse.json(
      { error: "Failed to import bank statement", details: error.message },
      { status: 500 }
    );
  }
}
