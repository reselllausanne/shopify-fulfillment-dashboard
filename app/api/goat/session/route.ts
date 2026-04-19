import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SESSION_FILE = path.join(process.cwd(), ".data", "goat-session.json");

async function ensureSessionDir() {
  await fs.mkdir(path.dirname(SESSION_FILE), { recursive: true });
}

function isValidStorageState(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const state = value as { cookies?: unknown; origins?: unknown };
  return Array.isArray(state.cookies) && Array.isArray(state.origins);
}

export async function GET() {
  try {
    const raw = await fs.readFile(SESSION_FILE, "utf8");
    const parsed = JSON.parse(raw);
    if (!isValidStorageState(parsed)) {
      return NextResponse.json({ ok: false, error: "Invalid stored GOAT session format" }, { status: 500 });
    }
    return NextResponse.json({
      ok: true,
      session: parsed,
      sessionFile: SESSION_FILE,
    });
  } catch {
    return NextResponse.json({ ok: false, error: "GOAT session not found" }, { status: 404 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const session = body?.session;
    if (!isValidStorageState(session)) {
      return NextResponse.json(
        { ok: false, error: "Invalid payload. Expected Playwright storageState JSON." },
        { status: 400 }
      );
    }
    await ensureSessionDir();
    await fs.writeFile(SESSION_FILE, JSON.stringify(session, null, 2), "utf8");
    return NextResponse.json({ ok: true, sessionFile: SESSION_FILE });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message ?? "Failed to import GOAT session" }, { status: 500 });
  }
}
