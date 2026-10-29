import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("stockxAuthAlert durable dedupe", () => {
  let tmp: string;
  let prevCwd: string;

  beforeEach(async () => {
    tmp = await fs.mkdtemp(path.join(os.tmpdir(), "stockx-auth-alert-"));
    prevCwd = process.cwd();
    process.chdir(tmp);
    vi.resetModules();
  });

  afterEach(async () => {
    process.chdir(prevCwd);
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
  });

  it("first failure may send; second within window is deduped via file", async () => {
    const mod = await import("./stockxAuthAlert");
    const key = "stockx-auth:galaxus";
    expect(await mod.shouldSendStockxAuthAlert(key)).toBe(true);

    // Simulate successful send stamp (mark via notify path internals: write file).
    await fs.mkdir(path.join(tmp, ".data"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".data", "stockx-auth-alert-dedupe.json"),
      JSON.stringify({ lastAlerts: { [key]: new Date().toISOString() } })
    );
    vi.resetModules();
    const mod2 = await import("./stockxAuthAlert");
    expect(await mod2.shouldSendStockxAuthAlert(key)).toBe(false);
    expect(await mod2.shouldSendStockxAuthAlert(key, { force: true })).toBe(true);
  });

  it("force bypasses dedupe", async () => {
    const mod = await import("./stockxAuthAlert");
    await fs.mkdir(path.join(tmp, ".data"), { recursive: true });
    await fs.writeFile(
      path.join(tmp, ".data", "stockx-auth-alert-dedupe.json"),
      JSON.stringify({
        lastAlerts: { "stockx-auth:default": new Date().toISOString() },
      })
    );
    vi.resetModules();
    const mod2 = await import("./stockxAuthAlert");
    expect(await mod2.shouldSendStockxAuthAlert("stockx-auth:default", { force: true })).toBe(
      true
    );
  });
});
