# StockX session / vacation remint

## Why JWT dies (and cookies do not)

| Artifact | Lifetime | Role |
|---|---|---|
| StockX bearer JWT | ~12h | GraphQL `Authorization` |
| Auth0 `auth0` / `did` cookies | ~100d (seen → 2027) | SSO session on `accounts.stockx.com` |
| `cf_clearance` | months–1y | Cloudflare pass (bound to IP + browser) |

Deploy does **not** wipe profiles: `docker-compose.yml` bind-mounts `./.data:/app/.data`.

## Vacation-proof path (priority order)

`lib/stockxSessionRefresh.ts` → playwright:

1. **Reuse** JWT if >6h remain **and** last mint <90m ago.
2. **Auth0 `refresh_token` grant** (HTTP, no browser) if token file stored one from a prior silent mint (`offline_access`).
3. **Warm CDP attach** (`http://127.0.0.1:9222` default / `:9223` galaxus) — no cold Chromium.
4. Else **headed launch** on `DISPLAY=:99`, **leaveWarm** with remote debugging, cookie-first `buying/orders`.
5. **Sit-still** on Cloudflare — do **not** cycle soft URLs while Turnstile is up (reloads reset the challenge).
6. **Silent Auth0** `prompt=none` authorize (`client_id=OVxrt4VJqTx7LIUKd661W0DuVMpcFByD`, redirect `https://stockx.com`) once CF is clear.
7. Credentials `/login` **only** when Auth0 cookies are gone. Never burn SSO.

Alert email/Slack fires only after these paths fail.

## Warm daemon

```bash
# Inside web container (shares Xvfb :99)
npx tsx scripts/stockx-warm-daemon.ts both
```

Docker Compose service `stockx-warm` runs this continuously. Hourly cron then attaches via CDP instead of cold launch.

## Hourly cron

`scripts/stockx-awb-cron.sh` → `POST /api/admin/stockx-awb-sync` (`refreshOnly`, then AWB).

**Avoid** crontab `--force-refresh` every few hours while Auth0 is healthy — thrashing cold Chromium elevates Turnstile to interactive checkbox.

## One bootstrap when CF shows “Un instant…”

Phone: `/admin/stockx-login` (and `?account=galaxus`) → complete Turnstile once in noVNC (password `1234`). After that, warm CDP + 90m keep-alive should remint without you for weeks (while Auth0 cookies live).

## Headless vs headed

True Playwright `headless: true` is blocked by Cloudflare. Production uses headed Chromium on container Xvfb (`PLAYWRIGHT_USE_XVFB=1`).
