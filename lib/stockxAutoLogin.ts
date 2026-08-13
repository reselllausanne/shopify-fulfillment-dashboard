import type { Page } from "playwright";

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
        await page.waitForTimeout(1500);
      }
      passwordInput = await findVisible(passwordSelectors);
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

export function stockxCredentialsFromEnv(): { email: string; password: string } | null {
  const email = String(process.env.STOCKX_EMAIL ?? "").trim();
  const password = String(process.env.STOCKX_PASSWORD ?? "");
  if (!email || !password) return null;
  return { email, password };
}
