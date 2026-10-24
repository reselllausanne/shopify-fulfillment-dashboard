import { describe, expect, it } from "vitest";
import {
  buildOosReportEmailable,
  formatOosReportTable,
  groupForOosReason,
  groupOosRows,
  normalizeOosReason,
  type OosReportRow,
} from "@/scripts/stockx-oos-report";

describe("normalizeOosReason", () => {
  it("maps known reasons", () => {
    expect(normalizeOosReason("oos_no_ask")).toBe("oos_no_ask");
    expect(normalizeOosReason("express_only")).toBe("express_only");
    expect(normalizeOosReason("margin")).toBe("negative_margin");
    expect(normalizeOosReason("price_moved")).toBe("price_moved");
  });

  it("maps unknown/null to other", () => {
    expect(normalizeOosReason("bot_fail")).toBe("other");
    expect(normalizeOosReason(null)).toBe("other");
    expect(normalizeOosReason(undefined)).toBe("other");
  });
});

describe("groupForOosReason", () => {
  it("oos_no_ask → true_oos (only safe-to-tell-customer)", () => {
    expect(groupForOosReason("oos_no_ask")).toBe("true_oos");
  });
  it("express_only / price_moved → buyable_missed", () => {
    expect(groupForOosReason("express_only")).toBe("buyable_missed");
    expect(groupForOosReason("price_moved")).toBe("buyable_missed");
  });
  it("negative_margin / other → other", () => {
    expect(groupForOosReason("negative_margin")).toBe("other");
    expect(groupForOosReason("other")).toBe("other");
  });
});

const rows: OosReportRow[] = [
  {
    orderName: "#7302",
    title: "Nike Air Max Pulse",
    sizeEU: "EU 47",
    saleChf: 180,
    reason: "oos_no_ask",
    lastSeen: "2026-10-24",
  },
  {
    orderName: "#7536",
    title: "adidas Ultra Boost 4.0",
    sizeEU: "EU 42",
    saleChf: 316,
    reason: "express_only",
    lastSeen: "2026-10-24",
  },
  {
    orderName: "#7999",
    title: "Some Shoe",
    sizeEU: "?",
    saleChf: 90,
    reason: "negative_margin",
    lastSeen: null,
  },
];

describe("groupOosRows", () => {
  it("splits rows into the three action groups", () => {
    const g = groupOosRows(rows);
    expect(g.true_oos.map((r) => r.orderName)).toEqual(["#7302"]);
    expect(g.buyable_missed.map((r) => r.orderName)).toEqual(["#7536"]);
    expect(g.other.map((r) => r.orderName)).toEqual(["#7999"]);
  });
});

describe("formatOosReportTable", () => {
  it("renders a header + a line per row", () => {
    const out = formatOosReportTable(rows);
    expect(out).toContain("order");
    expect(out).toContain("#7302");
    expect(out).toContain("oos_no_ask");
  });
  it("empty → (none)", () => {
    expect(formatOosReportTable([])).toContain("(none)");
  });
});

describe("buildOosReportEmailable", () => {
  it("credit candidates are the TRUE OOS rows only; send still pending (TODO)", () => {
    const g = groupOosRows(rows);
    const email = buildOosReportEmailable(g);
    expect(email.creditCandidates.map((r) => r.orderName)).toEqual(["#7302"]);
    expect(email.subject).toContain("1 true OOS");
    expect(email.text).toContain("TODO(credit-email)");
  });
});
