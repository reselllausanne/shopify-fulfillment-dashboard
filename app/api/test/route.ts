import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({ success: true, message: "API routes working!" });
}

export async function POST() {
  return NextResponse.json({ success: true, message: "POST working!" });
}


