# Phase 1 — ops (G1+)

Pixel + coverage webhook + G4 Secondary live. **Ne pas couper Simprosys.** Pas de Primary Ads.

## Automatique sur VPS (après merge)

```bash
ssh resell-vps
cd /opt/resell
sudo cp deploy/systemd/resell-tracking-shadow-report.{service,timer} /etc/systemd/system/
sudo cp deploy/systemd/resell-tracking-secondary-upload.{service,timer} /etc/systemd/system/
sudo cp deploy/systemd/resell-tracking-weekly-check.{service,timer} /etc/systemd/system/
sudo cp deploy/systemd/resell-funnel-events-purge.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now resell-tracking-shadow-report.timer
sudo systemctl enable --now resell-tracking-secondary-upload.timer
sudo systemctl enable --now resell-tracking-weekly-check.timer
sudo systemctl enable --now resell-funnel-events-purge.timer
```

Env VPS (déjà pour G4) :

- `TRACKING_GOOGLE_ADS_SECONDARY_ENABLED=1`
- `TRACKING_GOOGLE_ADS_SECONDARY_APPROVED_AT=YYYY-MM-DD`
- `TRACKING_GOOGLE_ADS_SECONDARY_ACTION_ID=` (Secondary UPLOAD_CLICKS only)
- Optionnel : `TRACKING_SHADOW_MIN_COVERAGE_PCT=90`, `TRACKING_WEEKLY_MAILTO=…`, `FUNNEL_EVENTS_RETENTION_MONTHS=14`

Vérifier :

```bash
systemctl list-timers 'resell-tracking*' 'resell-funnel*'
journalctl -u resell-tracking-secondary-upload.service -n 40
journalctl -u resell-tracking-shadow-report.service -n 30
```

## Vendredi — digeste

```bash
bash scripts/tracking-weekly-check.sh
# → tmp_tracking/weekly-YYYY-MM-DD.txt
```

Shadow : coverage pixel vs `server.orders_paid`.  
CM2 fair : `% cost complete` = parmi commandes **product-matched** (pas unbought, pas package protection).

## Critère G1 (≈2 semaines)

- `tracking-shadow-report --days=14 --alert` vert
- 0 doublon `checkout_completed`
- Approbation → G2 (déjà passé côté sGTM/GA4 TEST)

## G4 / G5 / G8

- **G4** Secondary revenue : upload quotidien (timer). Observer 2–4 sem. vs Simprosys.
- **G5** profit : seulement si cost-complete **parmi matched** ≥ 90 % + action `TEST purchase_profit`.
- **G8** cutover Primary : après ≥ 4 sem. parité. Pas avant.

## Manuel restant

- Politique de confidentialité (first-party funnel) — boutique / legal
