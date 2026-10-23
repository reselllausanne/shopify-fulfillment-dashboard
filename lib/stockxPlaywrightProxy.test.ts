import { describe, expect, it } from "vitest";
import { parsePlaywrightProxyUrl } from "@/lib/stockxPlaywrightProxy";

describe("parsePlaywrightProxyUrl", () => {
  it("parses host:port:user:pass (LemonProxy)", () => {
    const p = parsePlaywrightProxyUrl(
      "gw-eu.lemonclub.io:5555:pkg-user-country-de:secret:with:colons"
    );
    expect(p).toEqual({
      server: "http://gw-eu.lemonclub.io:5555",
      username: "pkg-user-country-de",
      password: "secret:with:colons",
      label: "gw-eu.lemonclub.io:5555",
    });
  });

  it("parses http URL with credentials", () => {
    const p = parsePlaywrightProxyUrl("http://u%40x:p%40ss@proxy.example:8080");
    expect(p?.server).toBe("http://proxy.example:8080");
    expect(p?.username).toBe("u@x");
    expect(p?.password).toBe("p@ss");
  });

  it("returns null for empty", () => {
    expect(parsePlaywrightProxyUrl("")).toBeNull();
  });
});
