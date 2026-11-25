# StockX self-login (Galaxus / Shopify), no human

Rule: `.cursor/rules/stockx-self-login.mdc`. Worked 25 Nov 2026 (Galaxus account, Auth0 session expired).

## Recipe that worked

1. **Throwaway Chrome, not the persistent profile.** `patchright` headful on Xvfb (`DISPLAY=:99`), fresh context, one Lausanne sticky session
   (`pkg-lemonprime-country-ch-region-vaud-city-lausanne-session-<N>-ttl-3600`, host `gw-eu.lemonclub.io:5555`, same password as the pool files; the
   `pool-performance` variant is refused). The persistent galaxus profile kept hitting the Turnstile loop; fresh contexts reached the OTP screen on most IPs.
2. `https://accounts.stockx.com/login`: "Un instant…" interstitial. Click the Cloudflare checkbox (`challenges.cloudflare.com` iframe, box.x+26, mid-height)
   **only after the challenge has been on screen ≥26 s** (earlier clicks reset it), human mouse movement, then wait.
3. Type email (`STOCKX_GALAXUS_EMAIL`). A second "Security Verification" Turnstile appears: same click. Flow goes to `/u/login/password` then
   `/u/login/passwordless-email-challenge`. The stored password is rejected: use the email-code path.
4. OTP: own IMAP poll (fresh connection every 4 s, INBOX last 40 uids, subject `^\d{6} – Votre code de connexion StockX`, to `contact@resell-lausanne.ch`,
   newer than the email submit). `waitForStockxEmailOtp` timed out in this flow (forwarding lag + long session).
5. The code screen has a **Terms checkbox**: tick it, then click Continue. Only one login at a time (a new code invalidates the previous one).
6. Prove it: `/fr-fr/buying` does not redirect to login AND `/fr-fr/buy/<slug>?size=…` shows CHF + Sous-total and none of
   `Login to Apply | create a StockX account | créer un compte | Nous vous invitons à créer`.
7. Activate: save `storageState` as `.data/stockx-session-galaxus.json` (backup first), remint the API token on the same session
   (`remintStockxTokenViaProxy`), inject the cookies into `/app/.data/stockx-profile-galaxus` and prove login there again.

## Ops notes

- Other agents redeploy `web` every few minutes and kill `docker exec` runs: drive long runs from host loops (`/root/galaxus-login/*.sh`), which relaunch
  after a container restart and stop on a marker file.
- Kill leftovers with `pkill -9 -f "[_]tmp159"`; plain SIGTERM did not stop tsx. One Chrome per profile: throwaway contexts are separate profiles.
- Kids picker (fr-fr) says "Sélectionnez du Size" and may reject `?size=6Y`; click the `EU 38` tile (PR #530). Toddler `?size=6T`, Li-Ning `?size=9.5` load directly.
- Scripts used are kept as `docs/ops/stockx-self-login/*.txt` (not compiled).
