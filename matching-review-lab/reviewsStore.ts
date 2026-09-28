/**
 * Local JSONL persistence for Matching Review Lab decisions.
 * Path is under data/ — never writes Prisma OrderMatch rows.
 */

import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { normalizeGtin, normalizeSkuKey, normalizeSizeLabel } from "./normalize";
import type {
  LabMatchProposal,
  LabReviewRecord,
  LabStockxBuy,
  MatchingReviewDecision,
  MatchingReviewReasonCode,
} from "./types";

export const DEFAULT_REVIEWS_PATH = path.join(
  process.cwd(),
  "data",
  "matching-review-lab",
  "reviews.jsonl"
);

function ensureDir(filePath: string) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}

export function readReviews(filePath: string = DEFAULT_REVIEWS_PATH): LabReviewRecord[] {
  if (!fs.existsSync(filePath)) return [];
  const text = fs.readFileSync(filePath, "utf8");
  const rows: LabReviewRecord[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as LabReviewRecord);
    } catch {
      // skip corrupt line
    }
  }
  return rows;
}

export function appendReview(
  record: LabReviewRecord,
  filePath: string = DEFAULT_REVIEWS_PATH
): LabReviewRecord {
  ensureDir(filePath);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, "utf8");
  return record;
}

export type BuildReviewInput = {
  proposal: LabMatchProposal;
  decision: MatchingReviewDecision;
  reasonCodes: MatchingReviewReasonCode[];
  reasonNote?: string | null;
  chosenBuy?: LabStockxBuy | null;
};

/** Build a structured review record. Always sets wroteLiveMatch: false. */
export function buildReviewRecord(input: BuildReviewInput): LabReviewRecord {
  const { proposal, decision, reasonCodes, reasonNote, chosenBuy } = input;
  const unit = proposal.unit;
  const proposed = proposal.proposed?.supplierOrder ?? null;

  return {
    id: randomUUID(),
    reviewedAt: new Date().toISOString(),
    decision,
    reasonCodes,
    reasonNote: reasonNote ?? null,
    channel: unit.channel,
    orderId: unit.orderId,
    orderNumber: unit.orderNumber,
    orderDate: unit.orderDate,
    lineId: unit.lineId,
    unitIndex: unit.unitIndex,
    unitKey: unit.unitKey,
    productTitle: unit.productTitle,
    gtinRaw: unit.gtin,
    gtinNormalized: normalizeGtin(unit.gtin),
    skuRaw: unit.sku,
    skuNormalized: normalizeSkuKey(unit.sku) || null,
    sizeRaw: unit.sizeRaw,
    sizeNormalized: normalizeSizeLabel(unit.sizeRaw),
    proposedBuyOrderNumber: proposed?.supplierOrderNumber ?? null,
    proposedBuyOrderId: proposed?.orderId ?? null,
    proposedAccountKey: proposal.stockxAccountKey,
    proposedPurchaseDate: proposed?.purchaseDate ?? null,
    proposedAwb: proposed?.awb ?? null,
    proposedReasons: proposal.proposed?.reasons ?? proposal.refusalReasons,
    chosenBuyOrderNumber: chosenBuy?.supplierOrderNumber ?? null,
    chosenBuyOrderId: chosenBuy?.orderId ?? null,
    chosenAccountKey: chosenBuy?.stockxAccountKey ?? null,
    chosenPurchaseDate: chosenBuy?.purchaseDate ?? null,
    chosenAwb: chosenBuy?.awb ?? null,
    chosenPrice: chosenBuy?.offerAmount ?? null,
    evidence: {
      matchMethod: proposal.matchMethod,
      needsGenderOrSizeReview: proposal.needsGenderOrSizeReview,
      refusalReasons: proposal.refusalReasons,
      topCandidateNumbers: proposal.topCandidates.map(
        (c) => c.supplierOrder.supplierOrderNumber
      ),
      proposed: proposed
        ? {
            supplierOrderNumber: proposed.supplierOrderNumber,
            orderId: proposed.orderId,
            purchaseDate: proposed.purchaseDate,
            skuKey: proposed.skuKey,
            sizeEU: proposed.sizeEU,
            productTitle: proposed.productTitle,
            awb: proposed.awb ?? null,
            offerAmount: proposed.offerAmount,
          }
        : null,
      chosen: chosenBuy
        ? {
            supplierOrderNumber: chosenBuy.supplierOrderNumber,
            orderId: chosenBuy.orderId,
            purchaseDate: chosenBuy.purchaseDate,
            skuKey: chosenBuy.skuKey,
            sizeEU: chosenBuy.sizeEU,
            productTitle: chosenBuy.productTitle,
            awb: chosenBuy.awb ?? null,
            offerAmount: chosenBuy.offerAmount,
            stockxAccountKey: chosenBuy.stockxAccountKey,
            gtin: chosenBuy.gtin,
          }
        : null,
    },
    wroteLiveMatch: false,
  };
}

export function saveReview(
  input: BuildReviewInput,
  filePath: string = DEFAULT_REVIEWS_PATH
): LabReviewRecord {
  return appendReview(buildReviewRecord(input), filePath);
}
