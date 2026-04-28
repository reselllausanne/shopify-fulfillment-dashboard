import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token.json");
const DEFAULT_SESSION_META_FILE = path.join(process.cwd(), ".data", "stockx-session-meta.json");

type StockxSessionMeta = {
  cookieHeader?: string | null;
};

function normalizeToken(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.trim().replace(/^bearer\s+/i, "").replace(/^"+|"+$/g, "");
  return cleaned.length > 0 ? cleaned : null;
}

function extractTokenCandidate(raw: string): string | null {
  const trimmed = String(raw ?? "").trim();
  if (!trimmed) return null;
  if (!trimmed.startsWith("{")) {
    return normalizeToken(trimmed);
  }
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    return (
      normalizeToken(parsed?.token) ||
      normalizeToken(parsed?.value) ||
      normalizeToken(parsed?.accessToken) ||
      normalizeToken(parsed?.access_token) ||
      normalizeToken(parsed?.authToken)
    );
  } catch {
    return null;
  }
}

function readCookieValue(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader || !name) return null;
  const parts = cookieHeader.split(";");
  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const eqIndex = trimmed.indexOf("=");
    if (eqIndex <= 0) continue;
    const key = trimmed.slice(0, eqIndex).trim();
    if (key !== name) continue;
    const value = trimmed.slice(eqIndex + 1).trim();
    return value || null;
  }
  return null;
}

export async function GET() {
  try {
    let fileToken: string | null = null;
    let cookieToken: string | null = null;

    try {
      const raw = await fs.readFile(DEFAULT_TOKEN_FILE, "utf8");
      fileToken = extractTokenCandidate(raw);
    } catch {
      fileToken = null;
    }

    try {
      const rawMeta = await fs.readFile(DEFAULT_SESSION_META_FILE, "utf8");
      const parsedMeta = JSON.parse(rawMeta) as StockxSessionMeta;
      cookieToken = normalizeToken(readCookieValue(parsedMeta?.cookieHeader ?? null, "token"));
    } catch {
      cookieToken = null;
    }

    const token = cookieToken || fileToken;
    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "No StockX token found in session metadata or token file",
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      ok: true,
      token,
      source: cookieToken ? "session_cookie" : "token_file",
      accountMismatch:
        Boolean(cookieToken) && Boolean(fileToken) && String(cookieToken) !== String(fileToken),
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        ok: false,
        error: error?.message || "Failed to read StockX token",
      },
      { status: 500 }
    );
  }
}
