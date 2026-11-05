import { describe, expect, it } from "vitest";
import {
  mailLanguageFromEmailDomain,
  mailLanguageFromLocale,
  resolveMailLanguage,
} from "@/app/lib/mailer/language";

describe("resolveMailLanguage", () => {
  it("uses Shopify locale before the email domain", () => {
    expect(
      resolveMailLanguage({
        customerLocale: "de-CH",
        email: "buyer@gmail.com",
      })
    ).toBe("de");
    expect(mailLanguageFromLocale("fr-CH")).toBe("fr");
    expect(mailLanguageFromLocale("en")).toBe("en");
    expect(mailLanguageFromLocale("it-CH")).toBeNull();
  });

  it("keeps the domain heuristic only when locale is missing", () => {
    expect(resolveMailLanguage({ email: "a@gmail.com" })).toBe("en");
    expect(resolveMailLanguage({ email: "a@bluewin.ch" })).toBe("fr");
    expect(mailLanguageFromEmailDomain("a@gmx.de")).toBe("de");
    expect(mailLanguageFromEmailDomain("a@sunrise.ch")).toBe("fr");
  });

  it("lets an explicit language and the env override win", () => {
    expect(
      resolveMailLanguage({
        explicit: "fr",
        customerLocale: "de-CH",
        email: "a@gmail.com",
      })
    ).toBe("fr");
    expect(
      resolveMailLanguage({
        override: "en",
        explicit: "de",
        customerLocale: "de-CH",
      })
    ).toBe("en");
  });
});
