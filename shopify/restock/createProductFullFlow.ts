import { spawn } from "node:child_process";
import path from "node:path";

/**
 * Bridge to the Python "portable_product_upsert" package (full product
 * creation pipeline: StockX/Kicks data -> productCreate -> images ->
 * metafields -> variants -> publish).
 *
 * Used whenever the restock flow hits a product that does not exist on
 * Shopify yet (Case 1 GTIN-miss, Case 2 Shopify returns, Case 3 hand stock).
 *
 * Accepts any identifier the Python side can resolve: StockX slug, URL,
 * style SKU, or GTIN/barcode.
 */

const PACKAGE_DIR = path.join(process.cwd(), "portable_product_upsert");
const PYTHON_BIN = process.env.PRODUCT_UPSERT_PYTHON ?? "python3";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

export type CreateProductFullFlowResult = {
  ok: boolean;
  action: "create" | "update" | "skipped" | null;
  input: string;
  slug: string | null;
  productId: string | null;
  error: string | null;
  lockedVariants?: Array<{ id: string; size: string }>;
  raw?: unknown;
  stdoutTail?: string;
};

function runPythonCli(
  args: string[],
  timeoutMs: number
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, ["product_upsert_api.py", ...args], {
      cwd: PACKAGE_DIR,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error(`product_upsert_api timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
  });
}

/**
 * The CLI mixes pipeline logs and a final pretty-printed JSON result on
 * stdout. Extract the last parseable top-level JSON object.
 */
export function extractLastJsonObject(stdout: string): unknown | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trim() !== "{") continue;
    const candidate = lines.slice(i).join("\n").trim();
    // Trim trailing non-JSON output after the closing brace.
    const lastBrace = candidate.lastIndexOf("}");
    if (lastBrace === -1) continue;
    try {
      return JSON.parse(candidate.slice(0, lastBrace + 1));
    } catch {
      continue;
    }
  }
  return null;
}

/**
 * Create the product on Shopify if missing, full update if it exists.
 *
 * @param identifier StockX slug / URL / style SKU / GTIN
 * @param options.lock lock variant prices after upsert (protects manual sale
 *   prices from being overwritten by the main pricing automation)
 */
export async function createProductFullFlow(
  identifier: string,
  options: { lock?: boolean; timeoutMs?: number } = {}
): Promise<CreateProductFullFlowResult> {
  const cleaned = String(identifier ?? "").trim();
  const base: CreateProductFullFlowResult = {
    ok: false,
    action: null,
    input: cleaned,
    slug: null,
    productId: null,
    error: null,
  };
  if (!cleaned) {
    return { ...base, error: "empty_identifier" };
  }

  const args = ["upsert", cleaned];
  if (options.lock) args.push("--lock");

  let cliResult: Awaited<ReturnType<typeof runPythonCli>>;
  try {
    cliResult = await runPythonCli(args, options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  } catch (error) {
    return {
      ...base,
      error: `python_bridge_failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsed = extractLastJsonObject(cliResult.stdout) as Record<string, unknown> | null;
  const stdoutTail = cliResult.stdout.slice(-2000);

  if (!parsed) {
    return {
      ...base,
      error: `no_json_output (exit=${cliResult.code}) stderr: ${cliResult.stderr.slice(-500)}`,
      stdoutTail,
    };
  }

  const lockedVariants = Array.isArray(parsed.locked_variants)
    ? (parsed.locked_variants as Array<{ id: string; size: string }>)
    : undefined;

  return {
    ok: parsed.ok === true,
    action: (parsed.action as CreateProductFullFlowResult["action"]) ?? null,
    input: cleaned,
    slug: typeof parsed.slug === "string" ? parsed.slug : null,
    productId: typeof parsed.product_id === "string" ? parsed.product_id : null,
    error: typeof parsed.error === "string" ? parsed.error : null,
    lockedVariants,
    raw: parsed,
    stdoutTail: parsed.ok === true ? undefined : stdoutTail,
  };
}

/**
 * Unlock the `custom.price_locked` metafield on the variant holding this
 * barcode, so the main pricing automation can price it again after sale.
 */
export async function unlockShopifyPriceByBarcode(barcode: string): Promise<{
  ok: boolean;
  error: string | null;
}> {
  const clean = String(barcode ?? "").replace(/\D/g, "").trim();
  if (!clean) return { ok: false, error: "empty_barcode" };
  try {
    const cliResult = await runPythonCli(["unlock", clean], 60_000);
    const parsed = extractLastJsonObject(cliResult.stdout) as Record<string, unknown> | null;
    if (!parsed) {
      return { ok: false, error: `no_json_output (exit=${cliResult.code})` };
    }
    return { ok: parsed.ok === true, error: typeof parsed.error === "string" ? parsed.error : null };
  } catch (error) {
    return {
      ok: false,
      error: `python_bridge_failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/**
 * Resolve-only helper (no writes): what would this identifier map to?
 */
export async function resolveProductIdentifier(identifier: string): Promise<{
  ok: boolean;
  kind: string | null;
  slug: string | null;
  onShopify: boolean;
  error: string | null;
  raw?: unknown;
}> {
  const cleaned = String(identifier ?? "").trim();
  if (!cleaned) {
    return { ok: false, kind: null, slug: null, onShopify: false, error: "empty_identifier" };
  }

  let cliResult: Awaited<ReturnType<typeof runPythonCli>>;
  try {
    cliResult = await runPythonCli(["resolve", cleaned], 60_000);
  } catch (error) {
    return {
      ok: false,
      kind: null,
      slug: null,
      onShopify: false,
      error: `python_bridge_failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const parsed = extractLastJsonObject(cliResult.stdout) as Record<string, unknown> | null;
  if (!parsed) {
    return {
      ok: false,
      kind: null,
      slug: null,
      onShopify: false,
      error: `no_json_output (exit=${cliResult.code})`,
    };
  }

  return {
    ok: !parsed.error,
    kind: typeof parsed.kind === "string" ? parsed.kind : null,
    slug: typeof parsed.slug === "string" ? parsed.slug : null,
    onShopify: Boolean(parsed.shopify_product),
    error: typeof parsed.error === "string" ? parsed.error : null,
    raw: parsed,
  };
}
