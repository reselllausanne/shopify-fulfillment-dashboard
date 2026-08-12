/**
 * Hourly StockX AWB sync.
 *
 * Keeps `OrderMatch.stockxAwb` populated for parcels still travelling to the warehouse, so the
 * scan page always resolves a label. Mints a fresh bearer from the persistent browser profile when
 * the stored one is close to expiry; alerts (Slack) when only a human can fix it.
 *
 * Usage: npx tsx scripts/stockx-awb-sync.ts [--days=21] [--limit=60] [--dry-run] [--force-refresh]
 */
import fs from "node:fs/promises";
import path from "node:path";
import { runAwbBackfill } from "@/lib/stockxAwbBackfill";
import { refreshStockxToken } from "@/lib/stockxSessionRefresh";
import { readServerStockxToken } from "@/lib/stockxServerToken";

const STATE_FILE = path.join(process.cwd(), ".data", "stockx-awb-sync-state.json");
const ALERT_DEDUPE_MS = 6 * 60 * 60 * 1000;

type SyncState = { lastAlerts?: Record<string, string> };

function arg(name: string, fallback: number): number {
  const raw = process.argv.find((value) => value.startsWith(`--${name}=`));
  if (!raw) return fallback;
  const parsed = Number(raw.split("=")[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function readState(): Promise<SyncState> {
  try {
    return JSON.parse(await fs.readFile(STATE_FILE, "utf8")) as SyncState;
  } catch {
    return {};
  }
}

async function writeState(state: SyncState): Promise<void> {
  await fs.mkdir(path.dirname(STATE_FILE), { recursive: true });
  await fs.writeFile(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function webhookUrl(): string {
  return (
    process.env.STOCKX_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.GALAXUS_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.BEATBOT_ALERT_SLACK_WEBHOOK_URL?.trim() ||
    process.env.SLACK_WEBHOOK_URL?.trim() ||
    ""
  );
}

/** Cron runs in a fresh process each hour, so dedupe state lives on disk. */
async function alert(key: string, text: string): Promise<void> {
  const state = await readState();
  const lastAlerts = state.lastAlerts ?? {};
  const last = lastAlerts[key] ? Date.parse(lastAlerts[key]) : 0;
  if (Number.isFinite(last) && Date.now() - last < ALERT_DEDUPE_MS) {
    console.log(`[STOCKX-AWB-SYNC] Alert "${key}" deduped`);
    return;
  }

  const webhook = webhookUrl();
  console.error(`[STOCKX-AWB-SYNC] ALERT ${key}: ${text}`);
  if (webhook) {
    try {
      const response = await fetch(webhook, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text }),
      });
      if (!response.ok) {
        console.error(`[STOCKX-AWB-SYNC] Slack webhook HTTP ${response.status}`);
      }
    } catch (error: any) {
      console.error("[STOCKX-AWB-SYNC] Slack webhook failed:", error?.message || error);
    }
  }

  lastAlerts[key] = new Date().toISOString();
  await writeState({ ...state, lastAlerts });
}

async function main(): Promise<void> {
  const days = arg("days", 21);
  const limit = arg("limit", 60);
  const dryRun = flag("dry-run");
  const forceRefresh = flag("force-refresh");

  const refresh = await refreshStockxToken({ force: forceRefresh });
  if (refresh.ok) {
    console.log(
      `[STOCKX-AWB-SYNC] Token ${refresh.reused ? "reused" : "minted"}, expires ${
        refresh.expiresAt?.toISOString() ?? "unknown"
      }`
    );
  } else {
    console.warn(`[STOCKX-AWB-SYNC] Token refresh failed: ${refresh.error}`);
  }

  const token = refresh.token ?? (await readServerStockxToken())?.token ?? null;
  if (!token) {
    await alert(
      "no_token",
      [
        ":rotating_light: *StockX AWB sync cannot authenticate*",
        `Reason: ${refresh.error ?? "no valid stored bearer"}`,
        refresh.needsManualLogin
          ? "Action: log in once on the VPS (noVNC :6080) to rebuild the browser profile."
          : "Action: check the StockX login route logs.",
        "Until fixed, warehouse scans may hit missing AWBs.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const result = await runAwbBackfill({ token, days, limit, dryRun, includeFulfilled: false });
  console.log(
    `[STOCKX-AWB-SYNC] candidates=${result.candidates} scanned=${result.scanned} updated=${result.updated} authFailures=${result.authFailures}`
  );
  for (const item of result.items.filter((entry) => entry.status === "UPDATED")) {
    console.log(
      `[STOCKX-AWB-SYNC] ${item.shopifyOrderName ?? "?"} ${item.stockxOrderNumber} -> ${item.awb} (${item.carrier ?? "?"})`
    );
  }

  if (result.abortedReason) {
    await alert(
      "auth_rejected",
      [
        ":rotating_light: *StockX AWB sync aborted*",
        result.abortedReason,
        "Action: log in on the VPS (noVNC :6080) to refresh the StockX session.",
      ].join("\n")
    );
    process.exitCode = 1;
    return;
  }

  const errors = result.items.filter((entry) => entry.status === "ERROR");
  if (errors.length > 0 && errors.length === result.scanned && result.scanned > 0) {
    await alert(
      "all_errors",
      [
        ":warning: *StockX AWB sync failing*",
        `Every one of ${result.scanned} orders errored. First: ${errors[0]?.error ?? "unknown"}`,
      ].join("\n")
    );
    process.exitCode = 1;
  }
}

main()
  .catch(async (error) => {
    console.error("[STOCKX-AWB-SYNC] Fatal:", error?.message || error);
    await alert("fatal", `:rotating_light: *StockX AWB sync crashed*\n${error?.message || error}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    const { prisma } = await import("@/app/lib/prisma");
    await prisma.$disconnect().catch(() => undefined);
    // A stray browser handle would otherwise keep this cron process alive forever.
    process.exit(process.exitCode ?? 0);
  });
