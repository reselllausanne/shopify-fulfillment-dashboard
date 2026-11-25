import http from "node:http";
import fs from "node:fs";
import { Agent } from "@cursor/sdk";

const PORT = Number(process.env.PORT || 3100);
const TOKEN = process.env.SAV_AGENT_TOKEN;
const API_KEY = process.env.CURSOR_API_KEY;
const MODEL = process.env.SAV_MODEL || "composer-2.5";
const CWD = process.env.SAV_CWD || "/app";
const DATA = process.env.SAV_DATA_DIR || "/app/.data/sav";
fs.mkdirSync(DATA, { recursive: true });
const LOG = DATA + "/log.jsonl";
const IDLE_MS = 30 * 60 * 1000;
if (!TOKEN || !API_KEY) { console.error("SAV_AGENT_TOKEN and CURSOR_API_KEY required"); process.exit(1); }

const PREAMBLE = "Lis d'abord sav-agent/workspace/SAV.md et suis-le. Question de la SAV :\n\n";
const sessions = new Map(); // id -> { agent, last, busy }

const log = (rec) => fs.appendFileSync(LOG, JSON.stringify({ ts: new Date().toISOString(), ...rec }) + "\n");

async function getSession(id) {
  let s = sessions.get(id);
  if (!s) {
    const agent = await Agent.create({ apiKey: API_KEY, model: { id: MODEL }, local: { cwd: CWD } });
    s = { agent, last: Date.now(), busy: false, first: true };
    sessions.set(id, s);
  }
  s.last = Date.now();
  return s;
}

setInterval(async () => {
  for (const [id, s] of sessions) {
    if (!s.busy && Date.now() - s.last > IDLE_MS) {
      sessions.delete(id);
      await s.agent[Symbol.asyncDispose]?.().catch(() => {});
    }
  }
}, 60_000).unref();

async function ask(sessionId, question, res) {
  const s = await getSession(sessionId);
  if (s.busy) { res.write("Une question est déjà en cours, attends la réponse."); return; }
  s.busy = true;
  let answer = "";
  try {
    const run = await s.agent.send((s.first ? PREAMBLE : "Question suivante de la SAV :\n\n") + question);
    s.first = false;
    for await (const ev of run.stream()) {
      if (ev.type === "assistant") {
        for (const b of ev.message.content) if (b.type === "text") { answer += b.text; res.write(b.text); }
      }
    }
    const r = await run.wait();
    if (r.status === "error") { res.write("\n[erreur agent, réessaie]"); log({ kind: "error", sessionId, question }); }
  } finally { s.busy = false; }
  log({ kind: "qa", sessionId, question, answer });
}

async function recap() {
  const since = Date.now() - 24 * 3600e3;
  const rows = fs.existsSync(LOG) ? fs.readFileSync(LOG, "utf8").trim().split("\n").map((l) => JSON.parse(l)).filter((r) => Date.parse(r.ts) > since) : [];
  if (!rows.length) return;
  const prompt = `Résume pour Théo, en français, très court. Section "À FAIRE CE SOIR" (escalations, par priorité, avec n° commande), section "RÉSOLU PAR L'IA" (une ligne par question). Données :\n${JSON.stringify(rows).slice(0, 60000)}`;
  const r = await Agent.prompt(prompt, { apiKey: API_KEY, model: { id: MODEL }, local: { cwd: "/tmp" } });
  const text = String(r.result ?? "").slice(0, 3500);
  if (process.env.SAV_NTFY_TOPIC && text) {
    await fetch(`${process.env.SAV_NTFY_URL || "https://ntfy.sh"}/${process.env.SAV_NTFY_TOPIC}`, {
      method: "POST", headers: { Title: "SAV recap du soir", Tags: "clipboard" }, body: text,
    });
  }
}

let lastRecapDay = "";
setInterval(() => {
  const z = new Date(new Date().toLocaleString("en-US", { timeZone: "Europe/Zurich" }));
  const day = z.toDateString();
  if (z.getHours() === Number(process.env.SAV_RECAP_HOUR || 18) && lastRecapDay !== day) {
    lastRecapDay = day;
    recap().catch((e) => console.error("recap failed", e));
  }
}, 60_000).unref();

http.createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") { res.end("ok"); return; }
  if (req.method !== "POST" || req.url !== "/ask" || req.headers["x-sav-token"] !== TOKEN) {
    res.statusCode = 404; res.end(); return;
  }
  let body = ""; for await (const c of req) { body += c; if (body.length > 20000) break; }
  let j; try { j = JSON.parse(body); } catch { res.statusCode = 400; res.end("bad json"); return; }
  const question = String(j.question ?? "").trim().slice(0, 4000);
  const sessionId = String(j.sessionId ?? "default").slice(0, 64);
  if (!question) { res.statusCode = 400; res.end("empty"); return; }
  res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
  try { await ask(sessionId, question, res); } catch (e) { console.error(e); res.write("\n[erreur serveur agent]"); log({ kind: "error", sessionId, err: String(e?.message ?? e) }); }
  res.end();
}).listen(PORT, "0.0.0.0", () => console.log("sav-agent on " + PORT));
