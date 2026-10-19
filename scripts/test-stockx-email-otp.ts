import "dotenv/config";
import fs from "node:fs/promises";
import { chromium } from "playwright";
import { tryStockxCredentialLogin } from "@/lib/stockxAutoLogin";

async function main() {
  const email = String(process.env.STOCKX_EMAIL || "");
  const password = String(process.env.STOCKX_PASSWORD || "");
  if (!email || !password) throw new Error("STOCKX_EMAIL/STOCKX_PASSWORD unavailable");

  const profile = "/tmp/stockx-gmail-otp-e2e";
  if (process.env.STOCKX_OTP_TEST_REUSE_PROFILE !== "1") {
    await fs.rm(profile, { recursive: true, force: true });
  }
  const context = await chromium.launchPersistentContext(profile, {
    channel: "chrome",
    headless: false,
    args: process.platform === "linux" ? ["--no-sandbox", "--disable-dev-shm-usage"] : [],
    ignoreDefaultArgs: ["--enable-automation"],
    locale: "en-US",
    viewport: { width: 1440, height: 900 },
  });

  try {
    const page = context.pages()[0] || (await context.newPage());
    await page.goto("https://stockx.com/login", {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const result = await tryStockxCredentialLogin(page, { email, password });
    if (!result.error && !result.needsOtp) {
      await page.goto("https://stockx.com/buying/orders", {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await page.waitForTimeout(3_000);
    const url = page.url();
    const body = await page.locator("body").innerText().catch(() => "");
    const otpStillVisible =
      /enter (the )?code|verification code|check your email|one[- ]time/i.test(body);
    const loggedIn =
      /stockx\.com\/(?:[a-z]{2}-[a-z]{2}\/)?(buying|sell|account|profile|browse)/i.test(url) &&
      !/login/i.test(url) &&
      !otpStillVisible;

    console.log(JSON.stringify({ result, url, otpStillVisible, loggedIn }));
    if (result.error || result.needsOtp || !loggedIn) process.exitCode = 1;
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error?.message || error);
  process.exit(1);
});
