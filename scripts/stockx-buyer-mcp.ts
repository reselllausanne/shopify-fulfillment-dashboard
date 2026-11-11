/**
 * Minimal MCP server (stdio, JSON-RPC 2.0, newline-delimited) for the StockX buyer.
 * No SDK dependency. All logging goes to stderr; stdout carries protocol only.
 *
 * Cursor config (runs on the VPS through ssh, next to the worker's .data):
 *   {
 *     "mcpServers": {
 *       "stockx-buyer": {
 *         "command": "ssh",
 *         "args": ["resell-vps", "docker exec -i resell-web-1 npx tsx scripts/stockx-buyer-mcp.ts"]
 *       }
 *     }
 *   }
 */
import "dotenv/config";
import readline from "node:readline";
import * as control from "@/lib/stockxBuyer/control";

// stdout is the protocol channel: send every log to stderr.
console.log = (...a: unknown[]) => console.error(...a);
console.warn = (...a: unknown[]) => console.error(...a);
console.info = (...a: unknown[]) => console.error(...a);

type Tool = {
  name: string;
  description: string;
  inputSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
  run: (a: any) => Promise<unknown>;
};

const str = (description: string) => ({ type: "string", description });

const TOOLS: Tool[] = [
  {
    name: "buyer_status",
    description:
      "Worker health: on/off, halted reason, heartbeat age, job counts by status, in-flight pairs, whether a Chrome holds each buyer profile.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.status(),
  },
  {
    name: "buyer_queue",
    description:
      "Open Shopify lines (and cancelled-pair rebuys) that still need a StockX buy, with the ledger state of each (new / blocked / retry...).",
    inputSchema: { type: "object", properties: { limit: { type: "number" } } },
    run: (a) => control.queue({ limit: a?.limit }),
  },
  {
    name: "buyer_report",
    description: "Markdown report of everything bought, held, needing review, too expensive, sold out, parked.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.report(),
  },
  {
    name: "buyer_learnings",
    description: "Grouped failure signatures with the playbook lesson and remedy for each. Unknown ones are flagged UNKNOWN.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.learnings(),
  },
  {
    name: "buyer_explain",
    description: "Why is this job in its current state? Ledger state, recheck time, in-flight marker, recent learnings.",
    inputSchema: { type: "object", properties: { key: str("job key, e.g. shopify:1234567890 or galaxus:<lineId>:0") }, required: ["key"] },
    run: (a) => control.explain(String(a.key)),
  },
  {
    name: "buyer_order_links",
    description: "DB lookup: StockX orders already linked to a Shopify order name (dedupe check).",
    inputSchema: { type: "object", properties: { orderName: str("#7661") }, required: ["orderName"] },
    run: (a) => control.orderLinks(String(a.orderName)),
  },
  {
    name: "buyer_start",
    description: "Write buyer.on. The worker loop picks it up. Safe to call twice.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.startBuyer(),
  },
  {
    name: "buyer_stop",
    description: "Remove buyer.on. The worker finishes the current pair and exits cleanly.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.stopBuyer(),
  },
  {
    name: "buyer_halt",
    description: "Stop buying immediately (no new pair) until buyer_resume. Use if something looks wrong.",
    inputSchema: { type: "object", properties: { reason: str("why") }, required: ["reason"] },
    run: (a) => control.haltNow(String(a.reason)),
  },
  {
    name: "buyer_resume",
    description: "Clear the halt file(s). Only after you checked why it halted (paid-without-number, proxy 402...).",
    inputSchema: { type: "object", properties: {} },
    run: () => control.resume(),
  },
  {
    name: "buyer_hold",
    description:
      "Never buy this on StockX (e.g. you buy it on GOAT by hand). Pass a job key or a Shopify order name like #7707.",
    inputSchema: { type: "object", properties: { target: str("job key or #order"), reason: str("why") }, required: ["target"] },
    run: async (a) => {
      const t = String(a.target);
      const why = String(a.reason || "manual");
      return t.startsWith("shopify:") || t.startsWith("galaxus:") ? control.hold(t, why) : control.holdOrder(t, why);
    },
  },
  {
    name: "buyer_release",
    description: "Drop the ledger state of a job so it is eligible again (undo a hold, retry a parked pair).",
    inputSchema: { type: "object", properties: { key: str("job key") }, required: ["key"] },
    run: (a) => control.release(String(a.key)),
  },
  {
    name: "buyer_goat_check",
    description:
      "Is GOAT cheaper than StockX for this style id + EU size? Estimate in CHF (ask + shipping + import VAT). Alert only, never buys.",
    inputSchema: {
      type: "object",
      properties: { sku: str("style id, e.g. DZ5485-612"), sizeEU: str("EU size, e.g. 43"), stockxAllInChf: { type: "number" } },
      required: ["sku", "sizeEU"],
    },
    run: (a) => control.goat(String(a.sku), String(a.sizeEU), a.stockxAllInChf != null ? Number(a.stockxAllInChf) : null),
  },
  {
    name: "buyer_run_once",
    description:
      "Detached one-shot buy run (optionally only these Shopify orders, optionally dry). Returns pid + log path. Refuses to double up if the worker already holds the lock.",
    inputSchema: {
      type: "object",
      properties: {
        orders: { type: "array", items: { type: "string" }, description: "e.g. [\"#7661\"]" },
        dry: { type: "boolean", description: "lane check only, no Place Order" },
        shopifyOnly: { type: "boolean" },
      },
    },
    run: (a) => control.runOnce({ orders: a?.orders, dry: Boolean(a?.dry), shopifyOnly: Boolean(a?.shopifyOnly) }),
  },
  {
    name: "buyer_chrome_hygiene",
    description:
      "Kill leftover Chromium processes bound to the two buyer profiles (stockx-profile, stockx-profile-galaxus). Never touches any other Chrome.",
    inputSchema: { type: "object", properties: {} },
    run: () => control.chromeHygiene(),
  },
];

const send = (msg: unknown) => process.stdout.write(`${JSON.stringify(msg)}\n`);

async function handle(req: any): Promise<void> {
  const { id, method, params } = req;
  const reply = (result: unknown) => id !== undefined && send({ jsonrpc: "2.0", id, result });
  const fail = (code: number, message: string) => id !== undefined && send({ jsonrpc: "2.0", id, error: { code, message } });
  try {
    if (method === "initialize") {
      return void reply({
        protocolVersion: params?.protocolVersion || "2024-11-05",
        capabilities: { tools: {} },
        serverInfo: { name: "stockx-buyer", version: "1.0.0" },
      });
    }
    if (method === "notifications/initialized" || method?.startsWith("notifications/")) return;
    if (method === "ping") return void reply({});
    if (method === "tools/list") {
      return void reply({ tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    }
    if (method === "tools/call") {
      const tool = TOOLS.find((t) => t.name === params?.name);
      if (!tool) return void fail(-32602, `unknown tool ${params?.name}`);
      try {
        const out = await tool.run(params?.arguments ?? {});
        const text = typeof out === "string" ? out : JSON.stringify(out, null, 2);
        return void reply({ content: [{ type: "text", text }] });
      } catch (e: any) {
        return void reply({ isError: true, content: [{ type: "text", text: String(e?.message || e) }] });
      }
    }
    return void fail(-32601, `method not found: ${method}`);
  } catch (e: any) {
    return void fail(-32603, String(e?.message || e));
  }
}

const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const s = line.trim();
  if (!s) return;
  let req: any;
  try {
    req = JSON.parse(s);
  } catch {
    return void send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } });
  }
  void handle(req);
});
rl.on("close", () => process.exit(0));
