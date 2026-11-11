import { describe, expect, it } from "vitest";
import { cmdlineMatchesUserDataDir } from "@/lib/stockxBrowserProcess";

const cmd = (dir: string) => ["/ms-playwright/chrome", "--no-sandbox", `--user-data-dir=${dir}`, "--remote-debugging-port=9222"].join("\0");

describe("cmdlineMatchesUserDataDir", () => {
  it("matches its own profile", () => {
    expect(cmdlineMatchesUserDataDir(cmd("/app/.data/stockx-profile"), "/app/.data/stockx-profile")).toBe(true);
  });
  it("does not confuse stockx-profile with stockx-profile-galaxus (kill hygiene must not hit the other buyer)", () => {
    expect(cmdlineMatchesUserDataDir(cmd("/app/.data/stockx-profile-galaxus"), "/app/.data/stockx-profile")).toBe(false);
    expect(cmdlineMatchesUserDataDir(cmd("/app/.data/stockx-profile"), "/app/.data/stockx-profile-galaxus")).toBe(false);
  });
  it("matches the space-joined form too", () => {
    expect(cmdlineMatchesUserDataDir("chrome --user-data-dir=/app/.data/stockx-profile --foo", "/app/.data/stockx-profile")).toBe(true);
  });
});
