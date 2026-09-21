import { describe, expect, it } from "vitest";
import { quotePostPacEconomy } from "./swissPostEconomy";

describe("quotePostPacEconomy", () => {
  it("bands 2026 list prices by weight", () => {
    expect(quotePostPacEconomy({ weightKg: 0.4 }).shippingChf).toBe(9);
    expect(quotePostPacEconomy({ weightKg: 2 }).shippingChf).toBe(9);
    expect(quotePostPacEconomy({ weightKg: 5 }).shippingChf).toBe(12);
    expect(quotePostPacEconomy({ weightKg: 10 }).shippingChf).toBe(12);
    expect(quotePostPacEconomy({ weightKg: 18 }).shippingChf).toBe(21);
    expect(quotePostPacEconomy({ weightKg: 30 }).shippingChf).toBe(21);
  });

  it("unknown weight is not a flat 10", () => {
    const q = quotePostPacEconomy({ weightKg: null });
    expect(q.shippable).toBe(false);
    expect(q.shippingChf).toBeNull();
    expect(q.reason).toBe("weight_unknown");
  });

  it("over 30kg is not PostPac", () => {
    const q = quotePostPacEconomy({ weightKg: 31 });
    expect(q.shippable).toBe(false);
    expect(q.reason).toBe("over_30kg_not_postpac");
  });

  it("bulky is 31 when still within 30kg", () => {
    expect(quotePostPacEconomy({ weightKg: 8, bulky: true }).shippingChf).toBe(31);
  });
});
