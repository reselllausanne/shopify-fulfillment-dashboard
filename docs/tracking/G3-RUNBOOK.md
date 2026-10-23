# G3 — GA4 TEST + GTM Web → sGTM (pas prod Simprosys)

**Prérequis G2 OK :** `https://sgtm.resell-lausanne.ch/healthz` → 200.

Simprosys / `G-828PXC8REN` / Ads Primary **ne bougent pas**.

---

## A. GA4 propriété TEST (~5 min)

1. [analytics.google.com](https://analytics.google.com) → **Admin** (engrenage)
2. **Créer** → **Propriété** → nom **`RL shadow TEST`**
3. Fuseau **Europe/Zurich**, devise **CHF**, secteur retail
4. **Créer un flux Web** → URL `https://www.resell-lausanne.ch`
5. **Noter** l’ID de mesure **`G-XXXXXXXXXX`** (≠ `G-828PXC8REN`)
6. Admin propriété :
   - **Collecte de données** → mesure améliorée **OFF**
   - **Rétention** → **14 mois**
   - **Signaux Google** → **OFF**
   - **Liens Google Ads** → **aucun** / ne pas lier

---

## B. Conteneur GTM **Web** (~10 min)

1. [tagmanager.google.com](https://tagmanager.google.com) → compte **Resell_lausanne**
2. **Créer un conteneur** → type **Web** → nom **`resell Web SHADOW TEST`**
3. Noter **`GTM-XXXXXXX`** (Web)
4. **Admin** → **Importer le conteneur** → fichier repo  
   `docs/tracking/phase2/gtm-web-container.json`
5. **Variables** → **`Const - GA4 TEST measurement ID`** → coller ton **`G-…` TEST**
6. **Admin** → **Paramètres du conteneur** → **Server container URLs** (ou « Tagging server ») :
   - Ajouter **`https://sgtm.resell-lausanne.ch`**
7. Vérifier **chaque tag** : statut **En pause** (ne pas activer Ads / prod GA4)
8. **Ne pas** coller le snippet Web sur Shopify theme — chargement via **pixel phase 2** plus tard

---

## C. Conteneur GTM **Server** (déjà `GTM-M8QN57VT`) (~5 min)

1. Ouvrir le conteneur **Server** (Hetzner)
2. **Admin** → **Paramètres du conteneur** → **Server container URL** =  
   `https://sgtm.resell-lausanne.ch`
3. **Clients** : laisser **GA4** (client par défaut)
4. **Tags** → **Nouveau** :
   - Type : **Google Analytics: GA4** (ou **Google Tag** selon UI)
   - ID de mesure : **`G-…` TEST** (pas prod)
   - Déclencheur : **Client GA4** (tous les events client)
   - **Ne pas** créer de tag Google Ads
5. **Enregistrer** → **Envoyer** (publier le conteneur **Server** — OK, trafic = 0 tant que Web/pixel n’envoie pas)

---

## D. Test sans boutique (~2 min)

1. GTM **Server** → **Aperçu** (Preview) → connecter
2. GTM **Web** → **Aperçu** → même session debug
3. Ou : Tag Assistant sur une page test avec `?rl_debug=1` **après** merge pixel G3

Sans pixel G3 merge : tu peux valider sGTM avec l’outil **Send test events** du client GA4 (Server preview).

---

## E. Activation code (après G- + GTM Web connus)

Envoyer à l’agent :

- `G-…` TEST
- `GTM-…` Web SHADOW

→ merge GTM dans le pixel custom (1 seul pixel), VPS :

```bash
TRACKING_GA4_TEST_MEASUREMENT_ID=G-...
TRACKING_GA4_TEST_ENABLED=1
TRACKING_GA4_TEST_APPROVED_AT=2026-10-20
```

+ PR qui lève `OUTBOUND_LOCKED.ga4_test` (gate G3).

---

## Checklist rapide

- [ ] GA4 TEST `G-…` créé, pas lié Ads
- [ ] GTM Web importé, constante GA4 TEST, server URL sgtm, tags en pause
- [ ] GTM Server tag GA4 → `G-…` TEST publié
- [ ] Boutique theme : **pas** de second GTM Simprosys touché
- [ ] IDs envoyés pour merge pixel + gate code
