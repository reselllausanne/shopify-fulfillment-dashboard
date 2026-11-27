# Mock-up BİLOO Barber Shop (démo, non déployé)

Page vitrine statique, une seule page, pour BİLOO Barber Shop, Avenue Alexandre-Vinet 26/26 bis, 1004 Lausanne.
Projet Next.js 16 autonome (App Router, TypeScript, CSS simple, `output: 'export'`). Indépendant de l'app racine.
Aucun contact avec le commerce. Aucun analytics, tracking, formulaire ou embed tiers. `noindex` (démo).

## Lancer

```bash
npm install
npm run build        # génère out/
npm run serve        # http://localhost:3000
npm run dev          # mode dev
CHROME_PATH=/usr/local/bin/google-chrome npm run screenshots   # serveur sur :3000 requis, écrit screenshots/
```

Captures : `screenshots/desktop-{fold,full}.png`, `screenshots/mobile-{fold,full}.png` (390x844, la barre CTA fixe est masquée sur les pleines pages).

## Sourcé vs exemple

Source : fiche #10 de `docs/jarvis/inbox/recherche/2026-11-27_commerces-sans-site-lausanne.md` (PR #564), consultée le 2026-11-27. Faits dans `app/business.ts`.

| Sourcé | Exemple, à valider avec le commerçant |
| --- | --- |
| Nom, activité (barbier), adresse, téléphone `+41 79 508 20 96` (fiche Maps), coordonnées GPS et lien Google Maps (dans l'URL de la fiche), note 4,9 et 127 avis (miroir Exa, date de mise à jour inconnue, consulté le 2026-11-27) | Prestations, prix (CHF), accroche du hero, horaires (absents de la fiche), contenu du bandeau démo hors faits |

Le JSON-LD `BarberShop` ne contient que les faits sourcés (nom, adresse, téléphone, géo, `hasMap`). Volontairement exclus : horaires, prix, `aggregateRating`.
Tout bloc inventé est marqué par un badge « Exemple » à l'écran et un commentaire `EXEMPLE` dans `app/page.tsx`. Bandeau « Page de démonstration » en bas de page. Aucun avis client cité.

## Décisions restantes

- Numéro : c'est un mobile affiché sur la fiche Maps (la fiche source le note « contact public »). Confirmer qu'il est bien le numéro pro à publier.
- Note 4,9 / 127 avis : chiffres d'un miroir tiers, non datés. À rafraîchir depuis Maps avant toute présentation.
- Horaires, prestations, prix, accroche : à fournir par le commerçant.
- Photo : placeholder CSS/SVG, voir `CREDITS.md`. Photo définitive à fournir par le commerçant.
- Réservation : la fiche source cite Fresha (plateforme de réservation). Non utilisée ici ; à décider (lien de réservation ou appel seulement).
- Domaine / hébergement : aucun choix fait, aucun déploiement.
