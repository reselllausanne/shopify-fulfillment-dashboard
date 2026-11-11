import { describe, expect, it } from "vitest";
import {
  makeLearning,
  playbookFor,
  signatureOf,
  summarizeLearnings,
  unknownSignatureEscalations,
} from "@/lib/stockxBuyer/learnings";

describe("learnings", () => {
  it("signature ignores ids, numbers and urls", () => {
    const a = signatureOf("bot_fail", "total 212.42 at https://stockx.com/x?size=9 order #7661");
    const b = signatureOf("bot_fail", "total 99.1 at https://stockx.com/y?size=11 order #7722");
    expect(a).toBe(b);
  });

  it("known failures map to a remedy", () => {
    expect(playbookFor("bot_fail", "Profile error occurred")?.remedy).toBe("dismiss_popup");
    expect(playbookFor("bot_fail", "CONNECT tunnel failed, response 400")?.remedy).toBe("rotate_session");
    expect(playbookFor("proxy_402", null)?.remedy).toBe("halt_all");
    expect(playbookFor("bot_fail", "paid but no StockX order number")?.remedy).toBe("halt_all");
    expect(playbookFor("size_us_map", null)?.remedy).toBe("park_for_review");
  });

  it("unknown failure has no playbook and escalates after 3 hits", () => {
    const mk = (i: number) => makeLearning({ key: `k${i}`, reason: "weird_new_thing", detail: `x${i}`, now: i });
    const list = [mk(1), mk(2)];
    expect(unknownSignatureEscalations(summarizeLearnings(list), 3)).toHaveLength(0);
    list.push(mk(3));
    const esc = unknownSignatureEscalations(summarizeLearnings(list), 3);
    expect(esc).toHaveLength(1);
    expect(esc[0]?.count).toBe(3);
    expect(esc[0]?.playbookId).toBeNull();
  });

  it("summaries sort most frequent first", () => {
    const s = summarizeLearnings([
      makeLearning({ key: "a", reason: "margin", detail: null, now: 1 }),
      makeLearning({ key: "b", reason: "bot_fail", detail: "lane click attempt", now: 2 }),
      makeLearning({ key: "c", reason: "bot_fail", detail: "lane click attempt", now: 3 }),
    ]);
    expect(s[0]?.count).toBe(2);
  });
});
