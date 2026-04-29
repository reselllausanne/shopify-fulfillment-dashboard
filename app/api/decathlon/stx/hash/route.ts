import { NextRequest, NextResponse } from "next/server";
import {
  STOCKX_GET_BUY_ORDER_OPERATION_NAME,
} from "@/app/lib/constants";
import {
  readStockxPersistedHashes,
  resolveStockxPersistedHash,
  writeStockxPersistedHashes,
} from "@/app/lib/stockxPersistedHashes";
import { GALAXUS_STOCKX_PERSISTED_HASHES_FILE } from "@/lib/stockxGalaxusAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeHash(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(cleaned)) return null;
  return cleaned;
}

function normalizeOperationName(raw: unknown): string {
  const cleaned = String(raw ?? "").trim();
  return cleaned || STOCKX_GET_BUY_ORDER_OPERATION_NAME;
}

export async function GET() {
  try {
    const hashes = await readStockxPersistedHashes(GALAXUS_STOCKX_PERSISTED_HASHES_FILE);
    const operationName = STOCKX_GET_BUY_ORDER_OPERATION_NAME;
    const hash = resolveStockxPersistedHash(operationName, hashes) ?? "";
    return NextResponse.json({
      ok: true,
      operationName,
      hash,
      file: GALAXUS_STOCKX_PERSISTED_HASHES_FILE,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to read hash" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const operationName = normalizeOperationName(body?.operationName);
    const hash = normalizeHash(body?.hash);
    if (!hash) {
      return NextResponse.json(
        { ok: false, error: "Invalid hash (expected 64-char hex)" },
        { status: 400 }
      );
    }
    const hashes = await readStockxPersistedHashes(GALAXUS_STOCKX_PERSISTED_HASHES_FILE);
    const merged = { ...hashes, [operationName]: hash };
    await writeStockxPersistedHashes(merged, GALAXUS_STOCKX_PERSISTED_HASHES_FILE);
    return NextResponse.json({
      ok: true,
      operationName,
      hash,
      file: GALAXUS_STOCKX_PERSISTED_HASHES_FILE,
    });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message ?? "Failed to save hash" },
      { status: 500 }
    );
  }
}
