import { NextRequest, NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/app/lib/prisma";
import { shopifyGraphQL } from "@/lib/shopifyAdmin";
import { toNumberSafe } from "@/app/utils/numbers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const PAGE_SIZE = 100;
const MAX_PAGES = 20;

const PAYOUTS_QUERY = /* GraphQL */ `
  query Payouts($first: Int!, $after: String) {
    shopifyPaymentsPayouts(first: $first, after: $after) {
      edges {
        cursor
        node {
          id
          issuedAt
          status
          transactionType
          net {
            amount
            currencyCode
          }
          summary {
            charges {
              amount
              currencyCode
            }
            refunds {
              amount
              currencyCode
            }
            adjustments {
              amount
              currencyCode
            }
          }
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

type PayoutNode = {
  id: string;
  issuedAt: string;
  status: string;
  transactionType?: string | null;
  net: { amount: string; currencyCode: string };
  summary?: {
    charges?: { amount: string; currencyCode: string }[];
    refunds?: { amount: string; currencyCode: string }[];
    adjustments?: { amount: string; currencyCode: string }[];
  } | null;
};

type PayoutQueryResponse = {
  shopifyPaymentsPayouts: {
    edges: { cursor: string; node: PayoutNode }[];
    pageInfo: { hasNextPage: boolean; endCursor?: string | null };
  };
};

function parseDateParam(value: string, endOfDay: boolean) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [yearRaw, monthRaw, dayRaw] = value.split("-");
  const year = Number(yearRaw);
  const month = Number(monthRaw);
  const day = Number(dayRaw);
  if (!year || !month || !day) return null;
  return new Date(
    Date.UTC(
      year,
      month - 1,
      day,
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0
    )
  );
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");

  const where: { issuedAt?: { gte?: Date; lte?: Date } } = {};

  if (fromParam) {
    const parsed = parseDateParam(fromParam, false);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid from parameter. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    where.issuedAt = { ...(where.issuedAt || {}), gte: parsed };
  }

  if (toParam) {
    const parsed = parseDateParam(toParam, true);
    if (!parsed) {
      return NextResponse.json(
        { error: "Invalid to parameter. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }
    where.issuedAt = { ...(where.issuedAt || {}), lte: parsed };
  }

  const payouts = await prisma.shopifyPayout.findMany({
    where,
    orderBy: { issuedAt: "desc" },
  });

  return NextResponse.json({ items: payouts });
}

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const maxPages = Math.min(
      Math.max(parseInt(searchParams.get("maxPages") || `${MAX_PAGES}`), 1),
      MAX_PAGES
    );

    const fromParam = searchParams.get("from");
    const toParam = searchParams.get("to");
    const fromDate = fromParam ? parseDateParam(fromParam, false) : null;
    const toDate = toParam ? parseDateParam(toParam, true) : null;
    if ((fromParam && !fromDate) || (toParam && !toDate)) {
      return NextResponse.json(
        { error: "Invalid from/to parameter. Use YYYY-MM-DD." },
        { status: 400 }
      );
    }

    let cursor: string | null = null;
    let hasNextPage = true;
    let pages = 0;
    let processed = 0;
    let upserted = 0;
    let skipped = 0;

    while (hasNextPage && pages < maxPages) {
      pages += 1;
      const result: { data: PayoutQueryResponse; errors?: Array<{ message: string; extensions?: any }> } =
        await shopifyGraphQL<PayoutQueryResponse>(PAYOUTS_QUERY, {
        first: PAGE_SIZE,
        after: cursor,
      });
      const { data, errors } = result;

      if (errors?.length) {
        return NextResponse.json(
          { error: "Shopify GraphQL errors", details: errors },
          { status: 502 }
        );
      }

      const connection = data.shopifyPaymentsPayouts;
      for (const edge of connection.edges) {
        const node = edge.node;
        processed += 1;
        const issuedAt = new Date(node.issuedAt);
        if ((fromDate && issuedAt < fromDate) || (toDate && issuedAt > toDate)) {
          skipped += 1;
          continue;
        }

        const netAmount = toNumberSafe(node.net?.amount, 0);
        await prisma.shopifyPayout.upsert({
          where: { id: node.id },
          create: {
            id: node.id,
            issuedAt,
            status: node.status,
            transactionType: node.transactionType ?? null,
            netAmount,
            currencyCode: node.net?.currencyCode || "CHF",
            summaryJson: node.summary ?? Prisma.DbNull,
            rawJson: node as any,
          },
          update: {
            issuedAt,
            status: node.status,
            transactionType: node.transactionType ?? null,
            netAmount,
            currencyCode: node.net?.currencyCode || "CHF",
            summaryJson: node.summary ?? Prisma.DbNull,
            rawJson: node as any,
          },
        });
        upserted += 1;
      }

      hasNextPage = connection.pageInfo.hasNextPage;
      cursor = connection.pageInfo.endCursor ?? null;
      if (!cursor) break;
    }

    return NextResponse.json({
      success: true,
      processed,
      upserted,
      skipped,
      pages,
      limitedByMaxPages: hasNextPage,
    });
  } catch (error: any) {
    console.error("[CASHFLOW/PAYOUTS] Sync error:", error);
    return NextResponse.json(
      { error: "Failed to sync Shopify payouts", details: error.message },
      { status: 500 }
    );
  }
}
