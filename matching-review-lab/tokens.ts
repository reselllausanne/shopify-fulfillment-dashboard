/**
 * Lab tokens = exact same stores as production matching.
 *
 * Shopify: `.data/stockx-token.json` (+ optional DB) — never galaxus file.
 * Galaxus: `.data/stockx-token-galaxus.json` ONLY — same as stx/sync.
 */

import fs from "node:fs/promises";
import {
  GALAXUS_STOCKX_TOKEN_FILE,
  readGalaxusStockxToken,
  writeGalaxusStockxToken,
} from "@/lib/stockxGalaxusAuth";
import {
  DASHBOARD_STOCKX_TOKEN_FILE,
  writeServerStockxToken,
  stockxTokenExpiresAt,
} from "@/lib/stockxServerToken";
import { getSupplierToken, persistSupplierToken } from "@/lib/stockxToken";
import {
  stockxAccountKeyForGalaxus,
  stockxAccountKeyForShopify,
} from "./accountKeys";
import type { StockxAccountKey } from "./types";

export type LabTokenSlot = {
  role: "shopify" | "galaxus";
  token: string;
  accountKey: StockxAccountKey;
  source: string;
  expiresAt: string | null;
};

function expiresIso(token: string): string | null {
  const d = stockxTokenExpiresAt(token);
  return d ? d.toISOString() : null;
}

/** Same store Galaxus Direct Delivery / stx/sync uses. */
export async function resolveGalaxusLabToken(): Promise<LabTokenSlot | null> {
  const token = await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE);
  if (!token) return null;
  return {
    role: "galaxus",
    token,
    accountKey: stockxAccountKeyForGalaxus({ source: "galaxus" }),
    source: "file:stockx-token-galaxus.json",
    expiresAt: expiresIso(token),
  };
}

/**
 * Shopify store only — dashboard file, then DB.
 * Does NOT fall back to galaxus file.
 * Returns null if the candidate JWT is the same as the Galaxus file (stale overwrite leftover).
 */
export async function resolveShopifyLabToken(options?: {
  /** When set, skip shopify candidates that equal this Galaxus JWT. */
  galaxusToken?: string | null;
}): Promise<LabTokenSlot | null> {
  const galaxusToken = options?.galaxusToken ?? (await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE));

  const file = await readGalaxusStockxToken(DASHBOARD_STOCKX_TOKEN_FILE);
  if (file && file !== galaxusToken) {
    return {
      role: "shopify",
      token: file,
      accountKey: stockxAccountKeyForShopify({ source: "dashboard" }),
      source: "file:stockx-token.json",
      expiresAt: expiresIso(file),
    };
  }

  const db = await getSupplierToken();
  if (db && db !== galaxusToken) {
    return {
      role: "shopify",
      token: db,
      accountKey: stockxAccountKeyForShopify({ source: "db" }),
      source: "db:StockXToken",
      expiresAt: expiresIso(db),
    };
  }

  return null;
}

/** True when dashboard file or DB still holds the Galaxus JWT (old dual-write leftover). */
export async function shopifyStorePollutedByGalaxus(): Promise<boolean> {
  const g = await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE);
  if (!g) return false;
  const s = await readGalaxusStockxToken(DASHBOARD_STOCKX_TOKEN_FILE);
  if (s && s === g) return true;
  const db = await getSupplierToken();
  if (db && db === g) return true;
  return false;
}

async function clearPollutedShopifyDashboardFile(galaxusToken: string): Promise<boolean> {
  try {
    const raw = await fs.readFile(DASHBOARD_STOCKX_TOKEN_FILE, "utf8");
    const parsed = JSON.parse(raw) as { token?: string };
    const fileToken = String(parsed?.token ?? "").trim();
    if (!fileToken || fileToken !== galaxusToken) return false;
    await fs.writeFile(
      DASHBOARD_STOCKX_TOKEN_FILE,
      `${JSON.stringify(
        {
          token: null,
          clearedAt: new Date().toISOString(),
          reason: "cleared_galaxus_jwt_leftover",
        },
        null,
        2
      )}\n`,
      "utf8"
    );
    return true;
  } catch {
    return false;
  }
}

export async function resolveLabTokenSlots(roles?: Array<"shopify" | "galaxus">): Promise<{
  slots: LabTokenSlot[];
  warnings: string[];
}> {
  const wanted = new Set(roles ?? ["shopify", "galaxus"]);
  const slots: LabTokenSlot[] = [];
  const warnings: string[] = [];

  const galaxus = wanted.has("galaxus") || wanted.has("shopify")
    ? await resolveGalaxusLabToken()
    : null;

  if (wanted.has("galaxus")) {
    if (galaxus) slots.push(galaxus);
    else {
      warnings.push(
        "Galaxus StockX: no token in .data/stockx-token-galaxus.json — paste Galaxus slot"
      );
    }
  }

  if (wanted.has("shopify")) {
    const shopify = await resolveShopifyLabToken({
      galaxusToken: galaxus?.token ?? null,
    });
    if (shopify) {
      slots.push(shopify);
    } else if (await shopifyStorePollutedByGalaxus()) {
      // Leftover from old DD dual-write into DB/dashboard — user did not paste Shopify in the lab.
      warnings.push(
        "Shopify store ignored: still has Galaxus JWT leftover (old DD save). Uncheck Shopify or paste real Shopify bearer."
      );
    } else {
      warnings.push(
        "Shopify StockX: no token — uncheck Shopify, or paste Shopify bearer"
      );
    }
  }

  return { slots, warnings };
}

export async function saveShopifyLabToken(raw: string): Promise<LabTokenSlot> {
  const token = String(raw ?? "")
    .trim()
    .replace(/^bearer\s+/i, "");
  if (!token) throw new Error("Empty Shopify token");
  const galaxus = await readGalaxusStockxToken(GALAXUS_STOCKX_TOKEN_FILE);
  if (galaxus && galaxus === token) {
    throw new Error(
      "That JWT is the Galaxus account token — refuse to save it as Shopify. Paste the other StockX account."
    );
  }
  await writeServerStockxToken(token, DASHBOARD_STOCKX_TOKEN_FILE);
  await persistSupplierToken(token).catch(() => undefined);
  const resolved = await resolveShopifyLabToken({ galaxusToken: galaxus });
  if (!resolved) throw new Error("Shopify token saved but not readable (expired?)");
  return resolved;
}

export async function saveGalaxusLabToken(raw: string): Promise<LabTokenSlot> {
  const token = String(raw ?? "")
    .trim()
    .replace(/^bearer\s+/i, "");
  if (!token) throw new Error("Empty Galaxus token");
  await writeGalaxusStockxToken(token, GALAXUS_STOCKX_TOKEN_FILE);
  // Old DD route copied Galaxus JWT into stockx-token.json — wipe that leftover.
  const cleared = await clearPollutedShopifyDashboardFile(token);
  const resolved = await resolveGalaxusLabToken();
  if (!resolved) throw new Error("Galaxus token saved but not readable (expired?)");
  if (cleared) {
    (resolved as LabTokenSlot & { clearedShopifyLeftover?: boolean }).clearedShopifyLeftover =
      true;
  }
  return resolved;
}

export async function labTokenStatus() {
  const galaxus = await resolveGalaxusLabToken();
  const polluted = await shopifyStorePollutedByGalaxus();
  const shopify = await resolveShopifyLabToken({
    galaxusToken: galaxus?.token ?? null,
  });
  return {
    shopify: shopify
      ? {
          ok: true,
          source: shopify.source,
          accountKey: shopify.accountKey,
          expiresAt: shopify.expiresAt,
          preview: `${shopify.token.slice(0, 8)}…${shopify.token.slice(-6)}`,
        }
      : {
          ok: false,
          pollutedByGalaxus: polluted,
          hint: polluted
            ? "stockx-token.json still had Galaxus JWT leftover (ignored)"
            : "no distinct Shopify token",
        },
    galaxus: galaxus
      ? {
          ok: true,
          source: galaxus.source,
          accountKey: galaxus.accountKey,
          expiresAt: galaxus.expiresAt,
          preview: `${galaxus.token.slice(0, 8)}…${galaxus.token.slice(-6)}`,
        }
      : { ok: false },
    files: {
      shopify: ".data/stockx-token.json",
      galaxus: ".data/stockx-token-galaxus.json",
    },
  };
}
