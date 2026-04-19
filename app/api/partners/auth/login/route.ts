import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/app/lib/prisma";
import { createPartnerToken, partnerAuthCookieName } from "@/app/lib/partnerAuth";
import { verifyPassword } from "@/app/lib/passwords";

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const { email, password } = await req.json();
    if (!email || !password) {
      return NextResponse.json({ error: "Email and password required" }, { status: 400 });
    }

    const user = await (prisma as any).partnerUser.findUnique({
      where: { email },
      include: { partner: true },
    });
    if (!user || !user.partner || !user.partner.active) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    if (!verifyPassword(password, user.passwordHash)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const token = await createPartnerToken({
      partnerId: user.partnerId,
      partnerKey: user.partner.key,
      role: user.role ?? "partner",
    });

    const response = NextResponse.json({
      success: true,
      partnerKey: user.partner.key,
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
    console.error("[PARTNER_AUTH] Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
