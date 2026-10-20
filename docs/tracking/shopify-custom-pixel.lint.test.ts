import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PIXEL_PATH = join(dirname(fileURLToPath(import.meta.url)), "shopify-custom-pixel.js");

/** Shopify Admin pixel editor rejects multiline ternaries (leading `?` / `:` on own line). */
describe("shopify-custom-pixel.js (Shopify editor lint)", () => {
  it("has no multiline ternary continuation lines", () => {
    const lines = readFileSync(PIXEL_PATH, "utf8").split("\n");
    const bad = lines.filter((line) => /^\s+\?\s/.test(line) || /^\s+:\s/.test(line));
    expect(bad).toEqual([]);
  });

  it("does not declare functions directly inside if blocks (Shopify editor)", () => {
    const src = readFileSync(PIXEL_PATH, "utf8");
    expect(src).not.toMatch(/if\s*\([^)]+\)\s*\{\s*\n\s*function\s/m);
  });
});
