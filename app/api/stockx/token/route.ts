import { NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_TOKEN_FILE = path.join(process.cwd(), ".data", "stockx-token.json");
const DEFAULT_SESSION_META_FILE = path.join(process.cwd(), ".data", "stockx-session-meta.json");

type StockxSessionMeta = {
  cookieHeader?: string | null;
  updatedAt?: string | null;
};

type StockxTokenFile = {
  token?: unknown;
  updatedAt?: string | null;
};

type TokenCandidate = {
  source: "session_cookie" | "token_file";
  token: string;
  exp: number | null;
  updatedAtMs: number | null;
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

function parseIsoMs(raw: unknown): number | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const payloadPart = String(token || "").split(".")[1] || "";
    if (!payloadPart) return null;
    const normalized = payloadPart.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const payloadRaw = Buffer.from(padded, "base64").toString("utf8");
    return JSON.parse(payloadRaw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function jwtExp(token: string): number | null {
  const payload = decodeJwtPayload(token);
  const exp = typeof payload?.exp === "number" ? payload.exp : null;
  return exp && Number.isFinite(exp) ? exp : null;
}

function isExpiredJwt(token: string, skewSeconds = 45): boolean {
  const exp = jwtExp(token);
  if (!exp) return false;
  const now = Math.floor(Date.now() / 1000);
  return exp <= now + skewSeconds;
}

function pickBestCandidate(candidates: TokenCandidate[]): TokenCandidate | null {
  if (candidates.length === 0) return null;
  const ranked = [...candidates].sort((a, b) => {
    const expA = a.exp ?? -1;
    const expB = b.exp ?? -1;
    if (expA !== expB) return expB - expA;
    const updatedA = a.updatedAtMs ?? -1;
    const updatedB = b.updatedAtMs ?? -1;
    return updatedB - updatedA;
  });
  return ranked[0] || null;
}

export async function GET() {
  try {
    let fileToken: string | null = null;
    let cookieToken: string | null = null;
    let fileUpdatedAtMs: number | null = null;
    let sessionUpdatedAtMs: number | null = null;

    try {
      const raw = await fs.readFile(DEFAULT_TOKEN_FILE, "utf8");
      fileToken = extractTokenCandidate(raw);
      try {
        const parsed = JSON.parse(raw) as StockxTokenFile;
        const parsedToken =
          normalizeToken(parsed?.token) ||
          (typeof parsed?.token === "string" ? extractTokenCandidate(parsed.token) : null);
        if (parsedToken) fileToken = parsedToken;
        fileUpdatedAtMs = parseIsoMs(parsed?.updatedAt);
      } catch {
        fileUpdatedAtMs = null;
      }
    } catch {
      fileToken = null;
      fileUpdatedAtMs = null;
    }

    try {
      const rawMeta = await fs.readFile(DEFAULT_SESSION_META_FILE, "utf8");
      const parsedMeta = JSON.parse(rawMeta) as StockxSessionMeta;
      cookieToken = normalizeToken(readCookieValue(parsedMeta?.cookieHeader ?? null, "token"));
      sessionUpdatedAtMs = parseIsoMs(parsedMeta?.updatedAt);
    } catch {
      cookieToken = null;
      sessionUpdatedAtMs = null;
    }

    const candidates: TokenCandidate[] = [];
    if (cookieToken) {
      candidates.push({
        source: "session_cookie",
        token: cookieToken,
        exp: jwtExp(cookieToken),
        updatedAtMs: sessionUpdatedAtMs,
      });
    }
    if (fileToken) {
      candidates.push({
        source: "token_file",
        token: fileToken,
        exp: jwtExp(fileToken),
        updatedAtMs: fileUpdatedAtMs,
      });
    }

    if (candidates.length === 0) {
      return NextResponse.json(
        {
          ok: false,
          error: "No StockX token found in session metadata or token file",
        },
        { status: 404 }
      );
    }

    const validCandidates = candidates.filter((candidate) => !isExpiredJwt(candidate.token));
    const selected = pickBestCandidate(validCandidates);
    if (!selected) {
      return NextResponse.json(
        {
          ok: false,
          error: "All known StockX tokens are expired. Re-run StockX Playwright login.",
        },
        { status: 401 }
      );
    }

    const expiresAt = selected.exp ? new Date(selected.exp * 1000).toISOString() : null;
    const expiresInSeconds = selected.exp ? Math.max(0, selected.exp - Math.floor(Date.now() / 1000)) : null;

    return NextResponse.json({
      ok: true,
      token: selected.token,
      source: selected.source,
      accountMismatch:
        Boolean(cookieToken) && Boolean(fileToken) && String(cookieToken) !== String(fileToken),
      expiresAt,
      expiresInSeconds,
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
