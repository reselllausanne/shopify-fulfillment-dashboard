import { describe, expect, it } from "vitest";

import {
  DESTINATION_LABEL,
  DESTINATIONS,
  destinationForLabel,
  destinationOperation,
  isDestination,
  labelForDestination,
  EXPLORER_ACTIVE_LABEL,
  LONG_TAIL_ALL_LABEL,
  ROUTED_LABELS,
  type Destination,
} from "@/adsanalytics/explorer/destinations";

describe("destination label mapping", () => {
  it("maps each destination to exactly one custom_label_3 state", () => {
    expect(labelForDestination("CORE_ALL")).toBeNull();
    expect(labelForDestination("EXPLORER_ALL")).toBe(EXPLORER_ACTIVE_LABEL);
    expect(labelForDestination("LONG_TAIL_ALL")).toBe(LONG_TAIL_ALL_LABEL);
  });

  it("round trips every destination through its label", () => {
    for (const destination of DESTINATIONS) {
      expect(destinationForLabel(labelForDestination(destination))).toBe(destination);
    }
  });

  it("treats empty, whitespace and unknown labels as CORE_ALL", () => {
    expect(destinationForLabel(null)).toBe("CORE_ALL");
    expect(destinationForLabel("")).toBe("CORE_ALL");
    expect(destinationForLabel("   ")).toBe("CORE_ALL");
    expect(destinationForLabel("some_other_feed_label")).toBe("CORE_ALL");
  });

  it("owns exactly the two routed labels", () => {
    expect([...ROUTED_LABELS].sort()).toEqual([EXPLORER_ACTIVE_LABEL, LONG_TAIL_ALL_LABEL].sort());
    const labels = DESTINATIONS.map((d) => DESTINATION_LABEL[d]).filter((l): l is string => l != null);
    expect(labels.sort()).toEqual([...ROUTED_LABELS].sort());
  });

  it("validates destination strings", () => {
    expect(isDestination("EXPLORER_ALL")).toBe(true);
    expect(isDestination("explorer_all")).toBe(false);
    expect(isDestination(undefined)).toBe(false);
  });
});

describe("the three label transitions", () => {
  const transitions: Array<{
    from: Destination;
    to: Destination;
    expectedLabel: string | null;
    merchantAction: "insert" | "delete";
  }> = [
    { from: "CORE_ALL", to: "EXPLORER_ALL", expectedLabel: EXPLORER_ACTIVE_LABEL, merchantAction: "insert" },
    { from: "EXPLORER_ALL", to: "LONG_TAIL_ALL", expectedLabel: LONG_TAIL_ALL_LABEL, merchantAction: "insert" },
    { from: "LONG_TAIL_ALL", to: "CORE_ALL", expectedLabel: null, merchantAction: "delete" },
  ];

  for (const t of transitions) {
    it(`${t.from} -> ${t.to} writes ${t.expectedLabel ?? "no label"} via ${t.merchantAction}`, () => {
      const target = labelForDestination(t.to);
      expect(target).toBe(t.expectedLabel);
      expect(target === null ? "delete" : "insert").toBe(t.merchantAction);
      expect(labelForDestination(t.from)).not.toBe(target);
      expect(destinationForLabel(target)).toBe(t.to);
    });
  }

  it("EXPLORER_ALL -> CORE_ALL removes the label instead of writing an empty one", () => {
    expect(labelForDestination("CORE_ALL")).toBeNull();
  });

  it("scopes one outbox operation per destination", () => {
    const operations = DESTINATIONS.map(destinationOperation);
    expect(new Set(operations).size).toBe(DESTINATIONS.length);
    expect(operations).toContain("set:LONG_TAIL_ALL");
  });
});
