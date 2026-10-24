# StockX session / vacation remint

## LemonPrime bandwidth (mandatory)

| Rule | Value |
|---|---|
| `STOCKX_BROWSER_PROXY_MODE` | **`on_fail`** (never `always` on VPS) |
| Warm / remint when Auth0 cookies valid | **direct first** — proxy only if remint fails / 403 |
| CF on sticky | sit ≤**45s** then fail — **no** sticky-rotate storm |
| CF sticky-rotates | ≤**2 / hour** total (`lib/stockxProxyCfBudget.ts`) |
| Checkout batch | one persistent session; direct → at most **one** sticky |
| Cron refresh | if JWT still **>6h** left → **skip Playwright** (token file check only) |
| Expected GB / order | **≪100 MB** when session warm (direct). GB-scale = CF thrash bug |

Pool file (VPS only, chmod 600, **not git**): `.data/stockx-lemonprime-proxies.txt`.

## Why JWT dies (and cookies do not)

| Artifact | Lifetime | Role |
|---|---|---|
| StockX bearer JWT | ~12h | GraphQL `Authorization` |
| Auth0 `auth0` / `did` cookies | ~100d (seen → 2027) | SSO session on `accounts.stockx.com` |
| `cf_clearance` | months–1y | Cloudflare pass (bound to IP + browser) |

Deploy does **not** wipe profiles: `docker-compose.yml` bind-mounts `./.data:/app/.data`.

## Vacation-proof path (priority order)

`lib/stockxSessionRefresh.ts` → playwright:

1. **Reuse** JWT if >6h remain — **skip browser** (light token check). No 90m Playwright keep-alive on cron.
2. **Auth0 `refresh_token` grant** (HTTP, no browser) if token file stored one from a prior silent mint (`offline_access`).
3. **Warm CDP attach** (`http://127.0.0.1:9222` default / `:9223` galaxus) — **direct** IP when `on_fail`.
4. Else **headed launch** on `DISPLAY=:99`, **leaveWarm**, cookie-first `buying/orders` (direct).
5. **Sit-still** on Cloudflare — do **not** cycle soft URLs / stickies while Turnstile is up.
6. Only if direct fails: **proxy remint** — one sticky ≤45s; ≤2 CF rotates/hour.
7. **Silent Auth0** `prompt=none` once CF is clear.
8. Credentials `/login` **only** when Auth0 cookies are gone. Never burn SSO.

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
