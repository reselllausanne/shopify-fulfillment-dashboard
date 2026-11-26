import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "stuck-alert-"));
const sendEmail = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/stockxAuthAlert", () => ({
  sendStockxEmail: (...a: unknown[]) => sendEmail(...a),
  postSlack: async () => false,
}));

describe("noteStuckLine", () => {
  let mod: typeof import("@/lib/stockxBuyer/stuckAlert");
  beforeAll(async () => {
    process.env.STOCKX_BUYER_DIR = path.join(tmp, "stockx-buyer");
    vi.resetModules();
    mod = await import("@/lib/stockxBuyer/stuckAlert");
  });
  afterAll(() => {
    delete process.env.STOCKX_BUYER_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });
  const line = (key: string, orderRef: string) => ({ key, source: "shopify" as const, orderRef, title: "Puffer", cls: "payment_not_completed", count: 20, detail: "x" });

  it("one email per newly stuck line, listing every stuck line; repeats are silent", async () => {
    expect(await mod.noteStuckLine(line("shopify:1", "#7842"))).toBe(true);
    expect(await mod.noteStuckLine(line("shopify:1", "#7842"))).toBe(false);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    await mod.noteStuckLine(line("shopify:2", "#7843"));
    expect(sendEmail).toHaveBeenCalledTimes(2);
    const text = (sendEmail.mock.calls[1] as unknown as [string, string])[1];
    expect(text).toContain("#7842");
    expect(text).toContain("#7843");
    expect(text).toContain("release");
  });
  it("release clears the line so it can alert again later", async () => {
    await mod.clearStuckLine("shopify:1");
    expect((await mod.readStuckLines()).map((l) => l.key)).toEqual(["shopify:2"]);
    await mod.noteStuckLine(line("shopify:1", "#7842"));
    expect(sendEmail).toHaveBeenCalledTimes(3);
  });
});
