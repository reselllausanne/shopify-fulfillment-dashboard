import { describe, expect, it } from "vitest";
import { orderMatchesDirectDeliveryTab } from "./orderListTab";

describe("direct delivery list tab", () => {
  it("keeps open and shipped orders on À traiter", () => {
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "to_process" }, "to_process")).toBe(true);
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "shipped" }, "to_process")).toBe(true);
    expect(orderMatchesDirectDeliveryTab({}, "to_process")).toBe(true);
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "fulfilled" }, "to_process")).toBe(false);
  });

  it("keeps only fulfilled orders on Fulfilled", () => {
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "fulfilled" }, "fulfilled")).toBe(true);
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "to_process" }, "fulfilled")).toBe(false);
    expect(orderMatchesDirectDeliveryTab({ fulfillmentState: "shipped" }, "fulfilled")).toBe(false);
    expect(orderMatchesDirectDeliveryTab({}, "fulfilled")).toBe(false);
  });
});
