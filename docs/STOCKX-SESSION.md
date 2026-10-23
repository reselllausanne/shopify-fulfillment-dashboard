# StockX session / auto-remint

## Why manual VNC keeps coming back

StockX bearers last ~12h. Cookie remint (headed Chromium on Xvfb) only works **while Auth0 / `cf_clearance` cookies are still warm**. Once those die, automation hits Cloudflare Turnstile (`Un instant…`) and credential fill fails (`Password field not found`). Dead cookies cannot remint themselves.

Deploy does **not** wipe profiles: `docker-compose.yml` bind-mounts `./.data:/app/.data` (`stockx-profile`, `stockx-profile-galaxus`, token files).

## Auto path (hourly cron)

`scripts/stockx-awb-cron.sh` → `POST /api/admin/stockx-awb-sync` with `refreshOnly: true`, then AWB.

`lib/stockxSessionRefresh.ts`:

1. **Reuse** JWT if >6h remain **and** last mint <4h ago.
2. Else **remint** (keep-alive or near-expiry): Playwright headed on `DISPLAY=:99`, cookie-first `https://stockx.com/buying/orders` (never `/login` first).
3. Wait out Turnstile on buying/orders; only then fall back to env credentials + Gmail OTP (`lib/stockxEmailOtp.ts`).
4. On remint failure → Postmark/Slack via `notifyStockxAuthBroken` immediately.

## One manual login when alert fires

Phone: `/admin/stockx-login` (and `?account=galaxus` for the second account) → complete Turnstile/OTP once in noVNC (VNC password `1234`, autofilled in the viewer URL). After that, proactive keep-alive should remint without you.

## Headless vs headed

True Playwright `headless: true` is blocked by Cloudflare. Production uses headed Chromium on the container Xvfb (`PLAYWRIGHT_USE_XVFB=1`).
