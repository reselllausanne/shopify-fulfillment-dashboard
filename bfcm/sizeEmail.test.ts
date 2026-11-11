import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BF2026_EMAIL_SIZES,
  BF2026_SIZE_LINKS,
  bf2026SizeUrl,
  renderBf2026SizeEmailHtml,
  renderBf2026SizeEmailText,
} from "@/bfcm/sizeEmail";

describe("BFCM exact-size email", () => {
  it("keeps distinct exact catalog sizes", () => {
    expect(BF2026_EMAIL_SIZES).toContain("42");
    expect(BF2026_EMAIL_SIZES).toContain("42.5");
    expect(BF2026_EMAIL_SIZES).toContain("42 2/3");
    expect(new Set(BF2026_EMAIL_SIZES).size).toBe(BF2026_EMAIL_SIZES.length);
  });

  it("puts size first and correctly encodes fractions", () => {
    expect(bf2026SizeUrl("38")).toBe(
      "https://www.resell-lausanne.ch/pages/black-friday?size=38&utm_source=email&utm_medium=bfcm&utm_campaign=bfcm_2026_size&utm_content=size_38",
    );
    expect(bf2026SizeUrl("42.5")).toContain("?size=42.5&");
    expect(bf2026SizeUrl("42 2/3")).toContain(
      "?size=42%202%2F3&utm_source=email",
    );
    expect(new URL(bf2026SizeUrl("42 2/3")).searchParams.get("size")).toBe(
      "42 2/3",
    );
  });

  it("renders one safe link per exact size", () => {
    const html = renderBf2026SizeEmailHtml();
    const text = renderBf2026SizeEmailText();
    expect(BF2026_SIZE_LINKS).toHaveLength(BF2026_EMAIL_SIZES.length);
    for (const { label, url } of BF2026_SIZE_LINKS) {
      expect(html).toContain(label);
      expect(html).toContain(url.replaceAll("&", "&amp;"));
      expect(text).toContain(`${label} — ${url}`);
    }
    expect(html.match(/class="size-button"/g)).toHaveLength(
      BF2026_EMAIL_SIZES.length,
    );
  });

  it("keeps the delivered CSV mapping synchronized", () => {
    const csv = readFileSync(
      join(process.cwd(), "bfcm/size-email-links.csv"),
      "utf8",
    )
      .trim()
      .split("\n");
    expect(csv[0]).toBe("label,url");
    expect(csv.slice(1)).toEqual(
      BF2026_SIZE_LINKS.map(({ label, url }) => `${label},${url}`),
    );
  });

  it("contains no scripts, forms, confirmation step, or email promise", () => {
    const output =
      renderBf2026SizeEmailHtml() + renderBf2026SizeEmailText();
    expect(output).not.toMatch(/<script|<form|confirme ta taille/i);
    expect(output).not.toMatch(/mail de confirmation|email de confirmation/i);
    expect(output).not.toContain("Une pointure = une sélection exacte");
    expect(output).not.toContain("/collections/black-friday");
    expect(output).not.toContain("filter.v.option.size");
  });
});
