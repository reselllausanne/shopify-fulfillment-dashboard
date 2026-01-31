import { NextRequest, NextResponse } from "next/server";
import { SignJWT } from "jose";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();

    const adminPass = process.env.ADMIN_PASSWORD;
    const logisticsPass = process.env.LOGISTICS_PASSWORD;
    const jwtSecret = process.env.JWT_SECRET;

    if (!adminPass || !logisticsPass || !jwtSecret) {
      console.error("[AUTH] Missing configuration in env vars");
      return NextResponse.json(
        { error: "Server authentication not configured" },
        { status: 500 }
      );
    }

    let role: "admin" | "logistics" | null = null;

    if (password === adminPass) {
      role = "admin";
    } else if (password === logisticsPass) {
      role = "logistics";
    }

    if (!role) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    // Create JWT
    const secret = new TextEncoder().encode(jwtSecret);
    const token = await new SignJWT({ role })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("30d") // Long session for convenience
      .sign(secret);

    const response = NextResponse.json({
      success: true,
      role,
      redirect: role === "logistics" ? "/scan" : "/",
    });

    // Set HTTP-only cookie
    response.cookies.set("auth_token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 30, // 30 days
    });

    return response;
  } catch (error: any) {
    console.error("[AUTH] Login error:", error);
    return NextResponse.json({ error: "Authentication failed" }, { status: 500 });
  }
}
