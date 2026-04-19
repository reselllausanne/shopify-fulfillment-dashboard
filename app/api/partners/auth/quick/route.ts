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
  // No per-partner or global access code configured: allow partner key only ("no extra code").
  // Set PARTNER_ACCESS_CODE or PARTNER_ACCESS_<KEY> when you want to require a secret again.
  return true;
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
      return NextResponse.json({ ok: false, error: "Access code is invalid" }, { status: 403 });
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

    const allowQuickUpsert =
      resolved.expected != null || process.env.PARTNER_QUICK_UPSERT === "1";

    let partner: { id: string; key: string };
    if (allowQuickUpsert) {
      partner = await prismaAny.partner.upsert({
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
    } else {
      const existing = await prismaAny.partner.findUnique({
        where: { key: partnerKey },
      });
      if (!existing?.active) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "Partner key not found or inactive. Use email and password above, or ask your administrator to create your partner account.",
          },
          { status: 403 }
        );
      }
      partner = existing;
      if (partnerName ?? resolved.name) {
        await prismaAny.partner.update({
          where: { id: existing.id },
          data: { name: partnerName ?? resolved.name ?? undefined },
        });
      }
    }

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
  } catch (error: unknown) {
    console.error("[PARTNER][AUTH][QUICK] Failed:", error);
    const code =
      error && typeof error === "object" && "code" in error
        ? String((error as { code?: string }).code)
        : "";
    if (code === "PARTNER_SIGNING_NOT_CONFIGURED") {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Server setup is incomplete. Ask your administrator to add the same secret used for the main staff login page (environment), then restart the app.",
        },
        { status: 500 }
      );
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
