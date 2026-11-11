import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  BF2026_EMAIL_SIZE_RANGES,
  BF2026_SIZE_LINKS,
  bf2026SizeUrl,
  renderBf2026SizeEmailHtml,
  renderBf2026SizeEmailText,
} from "@/bfcm/sizeEmail";

describe("BFCM range email", () => {
  it("uses the five live landing ranges", () => {
    expect(BF2026_EMAIL_SIZE_RANGES.map((range) => range.size)).toEqual([
      "36-37.5",
      "38-39.5",
      "40-41.5",
      "42-43.5",
      "44-46",
    ]);
    expect(BF2026_EMAIL_SIZE_RANGES[3].sizes).toEqual([
      "42",
      "42 2/3",
      "42.5",
      "43",
      "43 1/3",
      "43.5",
    ]);
  });

  it("keeps the range parameter first and leaves preview unlock off", () => {
    expect(bf2026SizeUrl("36-37.5")).toBe(
      "https://www.resell-lausanne.ch/pages/black-friday?size=36-37.5&utm_source=email&utm_medium=bfcm&utm_campaign=bfcm_2026_size&utm_content=size_36-37.5",
    );
    expect(bf2026SizeUrl("42-43.5")).toContain("?size=42-43.5&");
    expect(bf2026SizeUrl("44-46")).not.toContain("bfcm_preview_deals");
  });

  it("renders one button per range", () => {
    const html = renderBf2026SizeEmailHtml();
    const text = renderBf2026SizeEmailText();
    expect(BF2026_SIZE_LINKS).toHaveLength(5);
    for (const { label, url } of BF2026_SIZE_LINKS) {
      expect(html).toContain(`>${label}<`);
      expect(html).toContain(url.replaceAll("&", "&amp;"));
      expect(text).toContain(`${label} — ${url}`);
    }
    expect(html.match(/class="size-button"/g)).toHaveLength(5);
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
    const output = renderBf2026SizeEmailHtml() + renderBf2026SizeEmailText();
    expect(output).not.toMatch(/<script|<form|confirme ta taille/i);
    expect(output).not.toMatch(/mail de confirmation|email de confirmation/i);
    expect(output).not.toContain("Une pointure = une sélection exacte");
    expect(output).not.toContain("/collections/black-friday");
    expect(output).not.toContain("filter.v.option.size");
    expect(output).not.toContain(">EU 38<");
  });
});
