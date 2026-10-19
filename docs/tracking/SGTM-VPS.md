# Server-side GTM on the Hetzner VPS

Status: **infra only, OFF by default.** Merging this does not start anything: both services sit
behind the compose profile `sgtm`, which the deploy script (`docker compose config --services`)
ignores until the VPS `.env` activates it. No destination credentials live here or in the
server container until the matching approval gate in `docs/tracking/TRACKING-PLAN.md`.

## Topology

```
browser (Shopify custom pixel sandbox, later)
  └─ https://sgtm.resell-lausanne.ch  (GoDaddy DNS A → 77.42.74.184)
       └─ host nginx :443 (certbot TLS)  → 127.0.0.1:8090  sgtm-tagging   (compose, profile sgtm)
                                              └─ PREVIEW_SERVER_URL → https://sgtm-preview.resell-lausanne.ch
  https://sgtm-preview.resell-lausanne.ch → host nginx → 127.0.0.1:8091  sgtm-preview
```

- Image: `gcr.io/cloud-tagging-10302018/gtm-cloud-image:${SGTM_IMAGE_TAG:-stable}`.
- No `env_file`: the containers only receive `CONTAINER_CONFIG`, `PREVIEW_SERVER_URL`, `PORT`.
- Limits: tagging 768 MB / 1.5 CPU, preview 384 MB / 0.5 CPU (box: 8 vCPU, 15 GB).
- Logs: json-file rotation (20 MB × 5, 10 MB × 3).
- Health: `GET /healthz` on both; `scripts/sgtm-healthcheck.sh` + systemd timer
  `resell-sgtm-health.timer` (no-op while the profile is off).
- At ~300 orders/month (≈ 50–100k hits/month) a single tagging instance is ample.

## Env keys (VPS `/opt/resell/.env`, never committed)

| Key | Value |
|---|---|
| `COMPOSE_PROFILES` | `sgtm` (only at Gate G2) |
| `SGTM_CONTAINER_CONFIG` | Config string from GTM server container → Admin → Container settings → *Manually provision tagging server* |
| `SGTM_PREVIEW_SERVER_URL` | default `https://sgtm-preview.resell-lausanne.ch` |
| `SGTM_IMAGE_TAG` | default `stable` |

## Activation (Gate G2 — needs explicit user approval)

1. GTM account *Resell_lausanne* (6083910813) → Create container → *Server* → "Manually provision" → copy config string.
2. GoDaddy → DNS for `resell-lausanne.ch` → add `A sgtm 77.42.74.184` and `A sgtm-preview 77.42.74.184` (TTL 600). Do **not** touch the existing `@`/`www` Shopify records or the Outlook MX.
3. VPS (infra config, not app code):
   ```bash
   cd /opt/resell
   # append to .env: COMPOSE_PROFILES=sgtm and SGTM_CONTAINER_CONFIG='...'
   docker compose pull sgtm-tagging sgtm-preview
   docker compose up -d sgtm-preview sgtm-tagging
   sudo cp deploy/nginx/sgtm.resell-lausanne.ch.conf /etc/nginx/sites-available/sgtm
   sudo ln -s /etc/nginx/sites-available/sgtm /etc/nginx/sites-enabled/sgtm
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d sgtm.resell-lausanne.ch -d sgtm-preview.resell-lausanne.ch
   sudo cp deploy/systemd/resell-sgtm-health.* /etc/systemd/system/ && sudo systemctl daemon-reload
   sudo systemctl enable --now resell-sgtm-health.timer
   SGTM_PUBLIC_URL=https://sgtm.resell-lausanne.ch bash scripts/sgtm-healthcheck.sh
   ```
4. GTM server container → Admin → Container settings → Server container URLs: `https://sgtm.resell-lausanne.ch`.
5. With the server container still empty (only the default GA4 client, **no tags**), nothing is forwarded anywhere.

## Updates / rollback

- Monthly: `docker compose pull sgtm-tagging sgtm-preview && docker compose up -d sgtm-preview sgtm-tagging`.
- Kill switch: remove `sgtm` from `COMPOSE_PROFILES`, `docker compose stop sgtm-tagging sgtm-preview`.
  The web side keeps working (hits to a dead sGTM URL are dropped; Simprosys is independent).
