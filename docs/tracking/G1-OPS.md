# Phase 1 — ops (G1)

Pixel connecté + collecte en cours. **Ne pas couper Simprosys.** Pas de tags GTM tant que G1 pas validé.

## Automatique sur VPS (après merge)

```bash
ssh resell-vps
cd /opt/resell
sudo cp deploy/systemd/resell-tracking-shadow-report.{service,timer} /etc/systemd/system/
sudo cp deploy/systemd/resell-funnel-events-purge.{service,timer} /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now resell-tracking-shadow-report.timer
sudo systemctl enable --now resell-funnel-events-purge.timer
```

Optionnel dans `/etc/default/resell-ads` :

- `TRACKING_SHADOW_MIN_COVERAGE_PCT=90` (seuil alerte, défaut 80)
- `FUNNEL_EVENTS_RETENTION_MONTHS=14`

Vérifier :

```bash
systemctl list-timers 'resell-tracking*' 'resell-funnel*'
journalctl -u resell-tracking-shadow-report.service -n 30
```

## Critère G1 (≈2 semaines)

- `tracking-shadow-report --days=14 --alert` vert (couverture commandes trackées)
- 0 doublon `checkout_completed`
- Approbation explicite → passage G2

## Ensuite (G2)

- Merger PR #117 (sGTM OFF par défaut)
- DNS : `A sgtm` / `A sgtm-preview` → VPS (voir `docs/tracking/SGTM-VPS.md` après merge #117)
- Conteneur **vide** — pas de GA4 prod

## Manuel restant

- Paragraphe politique de confidentialité (first-party funnel) — boutique / legal
