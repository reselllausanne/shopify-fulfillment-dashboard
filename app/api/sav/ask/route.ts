import { NextRequest } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Proxy to the isolated sav-agent container. Auth: proxy.ts (admin or sav role). */
export async function POST(req: NextRequest) {
  const base = process.env.SAV_AGENT_URL || "http://sav-agent:3100";
  const token = process.env.SAV_AGENT_TOKEN;
  if (!token) return new Response("SAV_AGENT_TOKEN missing", { status: 500 });
  const body = await req.text();
  const upstream = await fetch(`${base}/ask`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-sav-token": token },
    body,
    signal: AbortSignal.timeout(280_000),
  }).catch(() => null);
  if (!upstream || !upstream.body) return new Response("Agent SAV injoignable.", { status: 502 });
  return new Response(upstream.body, {
    status: upstream.status,
    headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" },
  });
}
