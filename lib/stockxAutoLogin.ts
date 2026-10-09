import type { Page } from "playwright";

async function waitForCloudflareClear(page: Page, timeoutMs = 120000): Promise<boolean> {
  const start = Date.now();
  let reloads = 0;
  while (Date.now() - start < timeoutMs) {
    const url = page.url();
    const title = await page.title().catch(() => "");
    const body = (await page.locator("body").innerText().catch(() => "")) || "";
    const hasEmail = await page
      .locator('input[type="email"], input[name="email"], input[name="username"]')
      .first()
      .isVisible({ timeout: 500 })
      .catch(() => false);
    if (hasEmail) return true;

    const successStuck =
      /vérification réussie|verification successful|waiting for.*accounts\.stockx/i.test(body);
    const blocked =
      /cdn-cgi|challenges\.cloudflare/i.test(url) ||
      /just a moment|un instant|vérification de sécurité|security check|cf-turnstile/i.test(
        `${title}\n${body}`
      );

    // Turnstile often says "success" then hangs — reload once onto login.
    if (successStuck && reloads < 2) {
      reloads += 1;
      await page.goto("https://accounts.stockx.com/login", {
        waitUntil: "domcontentloaded",
        timeout: 45000,
      }).catch(() => undefined);
      await page.waitForTimeout(3000);
      continue;
    }

    if (!blocked && /stockx\.com/i.test(url)) {
      await page.waitForTimeout(1500);
      const again = await page
        .locator('input[type="email"], input[name="email"], input[name="username"]')
        .first()
        .isVisible({ timeout: 2000 })
        .catch(() => false);
      if (again) return true;
    }
    await page.waitForTimeout(2000);
  }
  return false;
}

/**
 * Fills StockX's email → password login when env credentials exist.
 * Does not handle email OTP / authenticator — returns needsOtp if that screen appears.
 */
export async function tryStockxCredentialLogin(
  page: Page,
  options: { email: string; password: string }
): Promise<{ attempted: boolean; needsOtp: boolean; error: string | null }> {
  const email = options.email.trim();
  const password = options.password;
  if (!email || !password) {
    return { attempted: false, needsOtp: false, error: "Missing STOCKX_EMAIL/STOCKX_PASSWORD" };
  }

  try {
    // Already logged in / buying page with session cookies.
    if (/stockx\.com\/(buying|sell|account|profile)/i.test(page.url())) {
      return { attempted: false, needsOtp: false, error: null };
    }

    // accounts.stockx.com sits behind Cloudflare Turnstile ("Un instant…").
    const cleared = await waitForCloudflareClear(page, 90000);
    if (!cleared) {
      return {
        attempted: true,
        needsOtp: false,
        error: "Cloudflare challenge did not clear (Turnstile). Retry or login via /admin/stockx-login.",
      };
    }

    const emailSelectors = [
      'input[type="email"]',
      'input[name="email"]',
      'input[name="username"]',
      'input[autocomplete="username"]',
      'input[id*="email" i]',
      'input[placeholder*="email" i]',
    ];
    const passwordSelectors = [
      'input[type="password"]',
      'input[name="password"]',
      'input[autocomplete="current-password"]',
    ];
    const continueSelectors = [
      'button[type="submit"]',
      'button:has-text("Continue")',
      'button:has-text("Log In")',
      'button:has-text("Sign In")',
      'button:has-text("Next")',
      '[data-testid*="login" i]',
    ];
    const passwordMethodSelectors = [
      'button:has-text("Use password")',
      'a:has-text("Use password")',
      'button:has-text("Log in with password")',
      'a:has-text("Log in with password")',
      'button:has-text("Continue with password")',
      'button:has-text("Use your password")',
      'a:has-text("Use your password")',
      'button:has-text("Try another method")',
      'a:has-text("Try another method")',
      'button:has-text("Other options")',
      'button:has-text("Mot de passe")',
    ];

    const findVisible = async (selectors: string[]) => {
      for (const sel of selectors) {
        const loc = page.locator(sel).first();
        if (await loc.isVisible({ timeout: 1500 }).catch(() => false)) return loc;
      }
      return null;
    };

    // Step 1: email (StockX is often split: email → continue → password)
    let emailInput = await findVisible(emailSelectors);
    if (!emailInput) {
      // Login wall sometimes behind a button.
      const loginBtn = page.locator('a[href*="login"], button:has-text("Log In"), button:has-text("Sign In")').first();
      if (await loginBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await loginBtn.click().catch(() => undefined);
        await page.waitForTimeout(1500);
        emailInput = await findVisible(emailSelectors);
      }
    }
    if (!emailInput) {
      return { attempted: false, needsOtp: false, error: "Email field not found" };
    }

    await emailInput.fill(email);
    await page.waitForTimeout(400);

    let passwordInput = await findVisible(passwordSelectors);
    if (!passwordInput) {
      const cont = await findVisible(continueSelectors);
      if (cont) {
        await cont.click().catch(() => undefined);
      }
      // After "Continue" StockX spins for several seconds, then may offer a passkey
      // prompt or a method picker before the password field appears.
      const deadline = Date.now() + 25000;
      while (!passwordInput && Date.now() < deadline) {
        await page.waitForTimeout(1000);
        passwordInput = await findVisible(passwordSelectors);
        if (passwordInput) break;
        const alt = await findVisible(passwordMethodSelectors);
        if (alt) {
          await alt.click().catch(() => undefined);
          continue;
        }
        const text = (await page.locator("body").innerText().catch(() => "")) || "";
        if (/enter (the )?code|we sent (you )?a code|check your email|verification code/i.test(text)) {
          return { attempted: true, needsOtp: true, error: "StockX asked for an email code" };
        }
      }
    }

    if (!passwordInput) {
      return { attempted: true, needsOtp: false, error: "Password field not found after email" };
    }

    await passwordInput.fill(password);
    await page.waitForTimeout(300);

    const submit = await findVisible(continueSelectors);
    if (submit) {
      await submit.click().catch(() => undefined);
    } else {
      await passwordInput.press("Enter").catch(() => undefined);
    }

    await page.waitForTimeout(2500);

    const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
    const url = page.url();
    const needsOtp =
      /type=OTP|verify|one[-\s]?time|enter (the )?code|authentication code|2fa|two[-\s]?factor/i.test(
        `${url}\n${bodyText}`
      );

    return { attempted: true, needsOtp, error: null };
  } catch (error: any) {
    return {
      attempted: true,
      needsOtp: false,
      error: error?.message || "Credential login failed",
    };
  }
}

export function stockxCredentialsFromEnv(
  account: "default" | "galaxus" = "default"
): { email: string; password: string } | null {
  const prefix = account === "galaxus" ? "STOCKX_GALAXUS" : "STOCKX";
  const email = String(process.env[`${prefix}_EMAIL`] ?? "").trim();
  const password = String(process.env[`${prefix}_PASSWORD`] ?? "");
  if (!email || !password) return null;
  return { email, password };
}
