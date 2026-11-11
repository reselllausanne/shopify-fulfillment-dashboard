import { describe, expect, it } from "vitest";
import { redactSecrets } from "@/lib/stockxBuyer/redact";

describe("redactSecrets", () => {
  it("hides proxy credentials", () => {
    const out = redactSecrets("Command failed: curl --proxy http://user-1:s3cretpass@gw-eu.example.io:5555/ -w x");
    expect(out).not.toContain("s3cretpass");
    expect(out).toContain("http://***@gw-eu.example.io:5555/");
  });
  it("hides bearer tokens and cookies", () => {
    expect(redactSecrets("Authorization: Bearer abcdefghijklmnopqrstuvwxyz0123")).not.toContain("abcdefghij");
    expect(redactSecrets("sent Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.abc.def")).toBe("sent Bearer ***");
    expect(redactSecrets('cookie: "sessionid=abcdef123456789; other=1"')).not.toContain("abcdef123456789");
  });
  it("leaves normal text alone", () => {
    expect(redactSecrets("size_us_map EU 38 not found")).toBe("size_us_map EU 38 not found");
    expect(redactSecrets(null)).toBe("");
  });
});
