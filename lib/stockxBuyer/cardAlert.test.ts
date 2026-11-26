import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "card-alert-"));
const sendEmail = vi.fn(async () => true);
const sendSlack = vi.fn(async () => false);

vi.mock("@/lib/stockxAuthAlert", () => ({
  sendStockxEmail: (...a: unknown[]) => (sendEmail as unknown as (...x: unknown[]) => Promise<boolean>)(...a),
  postSlack: (...a: unknown[]) => (sendSlack as unknown as (...x: unknown[]) => Promise<boolean>)(...a),
}));

describe("raiseCardDeclined", () => {
  let mod: typeof import("@/lib/stockxBuyer/cardAlert");
  beforeAll(async () => {
    process.env.STOCKX_BUYER_DIR = path.join(tmp, "stockx-buyer");
    process.env.NIGHT_BUYER_DATA_DIR = tmp;
    vi.resetModules();
    mod = await import("@/lib/stockxBuyer/cardAlert");
  });
  afterAll(() => {
    delete process.env.STOCKX_BUYER_DIR;
    delete process.env.NIGHT_BUYER_DATA_DIR;
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it("halts both buyers, writes the alert, emails once, never re-sends while active", async () => {
    const a = await mod.raiseCardDeclined({
      source: "shopify",
      orderRef: "#7847",
      title: "adidas AE 1 Low MX Grey",
      detail: "Une erreur s'est produite avec votre mode de paiement.",
    });
    expect(a.active).toBe(true);
    expect(a.emailSent).toBe(true);
    expect(fs.readFileSync(path.join(tmp, "stockx-buyer", "buyer.halt"), "utf8")).toContain("card declined — fund/unlock card");
    expect(fs.readFileSync(path.join(tmp, "night-buyer.halt"), "utf8")).toContain("card declined — fund/unlock card");
    expect(fs.existsSync(path.join(tmp, "stockx-buyer", "card-alert.json"))).toBe(true);
    expect(sendEmail).toHaveBeenCalledTimes(1);
    const [subject, text] = sendEmail.mock.calls[0] as unknown as [string, string];
    expect(subject).toContain("CARTE REFUSEE");
    expect(text).toContain("#7847");
    expect(text).toContain("resume");

    await mod.raiseCardDeclined({ source: "galaxus", orderRef: "212181338", title: "Ugg Lowmel", detail: "again" });
    expect(sendEmail).toHaveBeenCalledTimes(1); // same halt: no spam
    const ledger = fs.readFileSync(path.join(tmp, "stockx-buyer", "ledger.jsonl"), "utf8");
    expect(ledger).toContain("payment_declined:shopify:#7847");
    expect(ledger).toContain("payment_declined:galaxus:212181338");
  });

  it("clearCardAlert marks the alert inactive (resume)", async () => {
    await mod.clearCardAlert();
    expect((await mod.readCardAlert())?.active).toBe(false);
  });
});
