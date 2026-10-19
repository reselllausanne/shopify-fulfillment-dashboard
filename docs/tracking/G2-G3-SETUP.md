# G2 + G3 — checklist (prep, pas prod Ads)

Simprosys + GA4 prod `G-828PXC8REN` + Ads Primary **inchangés** tant que G3 gate pas levée.

## G2 — sGTM VPS (infra vide)

1. **GTM** [tagmanager.google.com](https://tagmanager.google.com) → compte **Resell_lausanne**
2. **Nouveau conteneur** → type **Server** → nom `resell sGTM` → provisionnement **Manuel**
3. Copier la **config string** (Container settings → Manually provision tagging server)
4. **GoDaddy** DNS `resell-lausanne.ch` :
   - `A` host `sgtm` → `77.42.74.184` TTL 600
   - `A` host `sgtm-preview` → `77.42.74.184` TTL 600
5. **VPS** `/opt/resell/.env` :
   ```bash
   COMPOSE_PROFILES=sgtm
   SGTM_CONTAINER_CONFIG='<coller config string>'
   SGTM_PREVIEW_SERVER_URL=https://sgtm-preview.resell-lausanne.ch
   ```
6. Suivre [`SGTM-VPS.md`](SGTM-VPS.md) : nginx, certbot, `docker compose up -d sgtm-tagging sgtm-preview`, health timer
7. GTM server → **Server container URL** = `https://sgtm.resell-lausanne.ch`
8. **Aucun tag** destination dans le conteneur server (client GA4 par défaut seulement)

## G3 — GA4 TEST + GTM Web (tags en pause)

1. **GA4** [analytics.google.com](https://analytics.google.com) → Admin → **Créer propriété**
   - Nom : `RL shadow TEST`
   - Fuseau : `Europe/Zurich`
   - Devise : CHF
   - Secteur : Retail
2. Flux **Web** → URL `https://www.resell-lausanne.ch`
3. Paramètres flux / propriété :
   - **Mesure améliorée** : OFF (ou désactiver sous-événements auto)
   - **Google signals** : OFF
   - **Rétention données** : 14 mois
   - **Ne pas lier** à Google Ads
4. Noter **`G-XXXXXXXXXX`** (TEST uniquement)
5. **GTM Web** → nouveau conteneur `resell Web SHADOW TEST` → domaine `resell-lausanne.ch`
6. Admin → **Importer** `docs/tracking/phase2/gtm-web-container.json`
7. Remplacer la constante **GA4 TEST measurement ID** par ton `G-…`
8. **Tous les tags en pause** — ne pas publier sur la boutique
9. Gate G3 code (dashboard) : `TRACKING_GA4_TEST_MEASUREMENT_ID` + approbation — **pas avant G1 OK**

## Vérifications

- `curl -sI https://sgtm.resell-lausanne.ch/healthz` → 200 (après G2)
- Boutique : **aucun** snippet GTM Web live (Simprosys seul)
- Pixel custom RL : inchangé
