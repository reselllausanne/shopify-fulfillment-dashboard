import { NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createPartnerToken, partnerAuthCookieName } from "@/app/lib/partnerAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeKey(value: string) {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

function resolveAccessCode(partnerKey: string) {
  const normalized = normalizeKey(partnerKey);
  const perPartner = process.env[`PARTNER_ACCESS_${normalized}`];
  const global = process.env.PARTNER_ACCESS_CODE;
  return {
    expected: perPartner ?? global ?? null,
    name: process.env[`PARTNER_NAME_${normalized}`] ?? null,
    source: perPartner ? "partner" : global ? "global" : "none",
  };
}

function isAllowed(accessCode: string | null | undefined, partnerKey: string) {
  const resolved = resolveAccessCode(partnerKey);
  if (resolved.expected) {
    return accessCode === resolved.expected;
  }
  return process.env.NODE_ENV !== "production";
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const partnerKey = String(body?.partnerKey ?? "").trim();
    const partnerName = String(body?.partnerName ?? "").trim() || null;
    const accessCode = body?.accessCode ? String(body.accessCode) : null;

    if (!partnerKey) {
      return NextResponse.json({ ok: false, error: "partnerKey is required" }, { status: 400 });
    }
    if (!/^[a-z0-9_-]{2,20}$/i.test(partnerKey)) {
      return NextResponse.json({ ok: false, error: "partnerKey format is invalid" }, { status: 400 });
    }

    const resolved = resolveAccessCode(partnerKey);
    if (!isAllowed(accessCode, partnerKey)) {
      const message =
        resolved.source === "none"
          ? "Access code not configured for this partner"
          : "Access code is invalid";
      return NextResponse.json({ ok: false, error: message }, { status: 403 });
    }

    const prismaAny = prisma as any;
    if (!prismaAny.partner) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Partner model not available. Restart the server after Prisma generate/db push.",
        },
        { status: 500 }
      );
    }
    const partner = await prismaAny.partner.upsert({
      where: { key: partnerKey },
      create: {
        key: partnerKey,
        name: partnerName ?? resolved.name ?? partnerKey,
        active: true,
      },
      update: {
        name: partnerName ?? resolved.name ?? undefined,
        active: true,
      },
    });

    const token = await createPartnerToken({
      partnerId: partner.id,
      partnerKey: partner.key,
      role: "partner",
    });

    const response = NextResponse.json({
      ok: true,
      partnerId: partner.id,
      partnerKey: partner.key,
      redirect: "/partners/dashboard",
    });
    response.cookies.set(partnerAuthCookieName, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30,
    });
    return response;
  } catch (error: any) {
    console.error("[PARTNER][AUTH][QUICK] Failed:", error);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }
}
