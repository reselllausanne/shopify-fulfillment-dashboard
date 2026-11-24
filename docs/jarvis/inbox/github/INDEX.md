# Index de l’extraction GitHub

- date d’extraction: 2026-11-24
- dépôt principal: `reselllausanne/shopify-fulfillment-dashboard`, branche `main`
- dépôt site: `reselllausanne/resell-lausanne.ch`, branche `main`, SHA observé `0035470`
- règle de priorité: consulter d’abord `docs/jarvis/memory/decisions.md`; ne jamais déduire une règle lorsque deux sources actives se contredisent
- exclusions: secrets en clair, PII, données de santé et chiffres opérationnels volatils

| Fichier | Fiches | Contenu |
|---|---:|---|
| `regles-metier.md` | 11 | règles confirmées et conflits |
| `procedures.md` | 10 | procédures opératoires durables |
| `integrations-et-comptes.md` | 11 | systèmes intégrés, sans identifiants sensibles |
| `workflows-automatiques.md` | 10 | workers, planifications et déclencheurs |
| `site-web.md` | 15 | politiques et comportements versionnés du storefront |
| `lecons-et-incidents.md` | 10 | incidents et garde-fous durables |
| `SECRETS-A-REGENERER.md` | 1 | emplacement seulement, aucune valeur |
| `QUESTIONS-OUVERTES.md` | 10 | incertitudes à arbitrer, maximum 15 |
| `INDEX.md` | 0 | présent index |
| **Total** | **78** | |

## Sources consultées

- code et documentation suivis dans les deux dépôts;
- historique Git, blame et commits;
- pull requests GitHub accessibles;
- `docs/jarvis/memory/decisions.md`.

## Sources inaccessibles ou non attestées

- aucune issue autonome accessible dans les deux dépôts;
- état live Shopify Admin: thème publié, Markets, menus, pages CMS, politiques, notifications, apps, Web Pixels et Customer Events;
- règles du portail de retours externe;
- variables et secrets d’environnement de production;
- données vivantes Shopify, Galaxus, Decathlon, StockX, Supabase, Ads et Search Console;
- SFTP Galaxus et configuration live des intégrations.
