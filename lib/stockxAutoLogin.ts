import type { Page } from "playwright";
import { waitForStockxEmailOtp } from "@/lib/stockxEmailOtp";

const OTP_SCREEN_RE =
  /type=OTP|passwordless-email-challenge|verify|one[-\s]?time|enter (the )?code|we sent (you )?a code|check your email|verification code|authentication code|2fa|two[-\s]?factor/i;

async function fillStockxOtp(page: Page, code: string): Promise<boolean> {
  const selectors = [
    'input[autocomplete="one-time-code"]',
    'input[name*="otp" i]',
    'input[id*="otp" i]',
    'input[name*="code" i]',
    'input[id*="code" i]',
    'input[inputmode="numeric"]',
  ];
  const visible = [];
  for (const selector of selectors) {
    const candidates = page.locator(selector);
    for (let i = 0; i < (await candidates.count()); i += 1) {
      const candidate = candidates.nth(i);
      if (await candidate.isVisible({ timeout: 300 }).catch(() => false)) visible.push(candidate);
    }
    if (visible.length) break;
  }
  if (!visible.length) return false;

  if (visible.length === 1) {
    await visible[0].fill(code);
  } else {
    for (let i = 0; i < Math.min(code.length, visible.length); i += 1) {
      await visible[i].fill(code[i]);
    }
  }
  const form = visible[0].locator("xpath=ancestor::form[1]");
  const terms = form.locator('input[type="checkbox"]').first();
  if (
    (await terms.count()) > 0 &&
    (await terms.isVisible({ timeout: 500 }).catch(() => false)) &&
    !(await terms.isChecked().catch(() => false))
  ) {
    await terms.check({ force: true });
  }
  await page.waitForTimeout(300);
  const submit = form.locator('button[type="submit"]').first();
  if (
    (await submit.count()) > 0 &&
    (await submit.isVisible({ timeout: 500 }).catch(() => false)) &&
    (await submit.isEnabled().catch(() => false))
  ) {
    await submit.click();
    return true;
  }
  // Enter stays scoped to the OTP input when the form has no submit button.
  await visible[visible.length - 1].press("Enter").catch(() => undefined);
  return true;
}

async function completeStockxEmailOtp(
  page: Page,
  requestedAfter: Date,
  loginEmail: string
): Promise<{ completed: boolean; error: string | null }> {
  console.log(`[STOCKX-PW] Waiting for StockX code in Gmail (loginEmail=${loginEmail})`);
  const result = await waitForStockxEmailOtp({ after: requestedAfter, loginEmail });
  if (!result.code) return { completed: false, error: result.error };
  const filled = await fillStockxOtp(page, result.code);
  if (!filled) return { completed: false, error: "StockX OTP input not found" };
  const deadline = Date.now() + 15_000;
  let text = "";
  do {
    await page.waitForTimeout(1_000);
    text = `${page.url()}\n${await page.locator("body").innerText().catch(() => "")}`;
    if (!OTP_SCREEN_RE.test(text)) return { completed: true, error: null };
  } while (Date.now() < deadline);
  return {
    completed: false,
    error: "StockX OTP was rejected or confirmation did not finish",
  };
}

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
 * Fills StockX's email → password login and reads an email OTP from Gmail when requested.
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
    let emailSubmittedAt: Date | null = null;
    if (!passwordInput) {
      emailSubmittedAt = new Date();
      // Enter targets the identifier form reliably; generic submit selectors can hit
      // StockX's hidden/header forms instead.
      await emailInput.press("Enter").catch(async () => {
        const cont = await findVisible(continueSelectors);
        await cont?.click().catch(() => undefined);
      });
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
        const text = `${page.url()}\n${(await page.locator("body").innerText().catch(() => "")) || ""}`;
        if (OTP_SCREEN_RE.test(text)) {
          const otp = await completeStockxEmailOtp(page, emailSubmittedAt, email);
          return {
            attempted: true,
            needsOtp: !otp.completed,
            error: otp.error,
          };
        }
      }
    }

    if (!passwordInput) {
      return { attempted: true, needsOtp: false, error: "Password field not found after email" };
    }

    await passwordInput.fill(password);
    await page.waitForTimeout(300);

    const loginSubmittedAt = new Date();
    const submit = await findVisible(continueSelectors);
    if (submit) {
      await submit.click().catch(() => undefined);
    } else {
      await passwordInput.press("Enter").catch(() => undefined);
    }

    await page.waitForTimeout(2500);

    const bodyText = (await page.locator("body").innerText().catch(() => "")) || "";
    const url = page.url();
    const needsOtp = OTP_SCREEN_RE.test(`${url}\n${bodyText}`);
    if (needsOtp) {
      const otp = await completeStockxEmailOtp(page, loginSubmittedAt, email);
      return {
        attempted: true,
        needsOtp: !otp.completed,
        error: otp.error,
      };
    }

    return { attempted: true, needsOtp: false, error: null };
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
