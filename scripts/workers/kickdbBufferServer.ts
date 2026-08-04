#!/usr/bin/env npx tsx
/**
 * Internal KickDB buffer HTTP server — all heavy kickdb routes off Next.js web.
 * SSE listener, sweeper, bootstrap, and main_from_db.py target :3002 instead of :3000.
 */
import http from "node:http";
import { handleKickdbBufferRequest } from "@/galaxus/kickdb/bufferApi";

const PORT = Number(process.env.KICKDB_BUFFER_PORT ?? process.env.KICKDB_UPSERT_PORT ?? 3002);
const HOST = process.env.KICKDB_BUFFER_HOST ?? "0.0.0.0";

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  let body: unknown = undefined;
  if (req.method === "POST") {
    try {
      const raw = await readBody(req);
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ ok: false, error: "invalid_json" }));
      return;
    }
  }

  try {
    const out = await handleKickdbBufferRequest(
      req.method ?? "GET",
      url.pathname,
      url.searchParams,
      body,
      req.headers as Record<string, string | string[] | undefined>
    );
    res.writeHead(out.status, { "content-type": "application/json" });
    res.end(JSON.stringify(out.json));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[kickdb-buffer] error", err);
    res.writeHead(500, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: false, error: message }));
  }
});

server.listen(PORT, HOST, () => {
  console.info("[kickdb-buffer] listening", { host: HOST, port: PORT });
});
