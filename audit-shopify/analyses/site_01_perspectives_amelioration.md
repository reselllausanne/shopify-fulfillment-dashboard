# Site : constats techniques et perspectives d'amélioration (12 nov 2026)

Lecture seule. Base : `seo_01`, `seo_02`, `cx_01`, `ads_09`, `cash_01`. Étiquettes : F fait, D déclaré, I interprétation, H hypothèse, R recommandation.
Montants en CHF. Contribution moyenne par commande 45,6 (médiane 40,4), 374 commandes/mois (août–oct), voir `cash_01`.

## 1. Spam update de Google et chute du 14 sept

- F : chute d'impressions la semaine du 14 sept (80 027 → 58 658 par semaine).
- F : Google (Search Status Dashboard, via recherche web) date le spam update de septembre du 24 sept au 8 oct. Il commence 10 jours après la chute.
- F : pendant ces deux semaines les impressions sont plates (58 167, 58 783, 59 350 par semaine). Pas de seconde baisse.
- I : ce spam update n'explique pas la chute du 14 sept. Il ne l'exclut pas pour la suite : on ne voit rien dans nos données.
- D : des sites tiers signalent une volatilité « non confirmée » vers le 15 sept. Non vérifié, non confirmé par Google.

## 2. Message de l'autre agent (thèmes baseline `#189546496386` du 31 oct, candidat `#189859070338`, live)

Ce que je peux vérifier et ce que je ne peux pas :

- F : je n'ai pas lu ces thèmes dans Shopify. Je ne vérifie donc pas ses comparaisons fichier par fichier (apostrophes de `meta-tags`, ligne 531 de `breadcrumb-taxonomy-map`, +286 lignes, etc.). Ce sont ses constats, D.
- F : dans la copie locale du dépôt thème `fullstack_2_3_1/snippets/breadcrumb-taxonomy-map.liquid`, la ligne 531 est du code Liquid normal (`assign perf_bk_bags_parts`), sans message d'erreur. Cette copie peut ne pas être la baseline.
- F : thème MAIN lu le 2 nov : `fullstack-2-3-1`, id 188549300610 (`cx_01` §1). Pas un des deux ids cités ci-dessus. Je ne sais pas lequel est publié aujourd'hui.
- F : ce que **Google voit du live** (Inspection d'URL, crawls 19 oct → 12 nov) : fils d'Ariane vus sur toutes les pages inspectées qui ont des données structurées détectées (196 sur 229), dont 4 avec l'erreur « item manquant ». Titres, méta et hreflang non testés ici.
- F : cause de ces 4 erreurs dans `product-breadcrumb.liquid` (lignes 150–160 et 395–425) : pour un niveau intermédiaire sans URL, le code omet volontairement `"item"`. Google exige `item` sauf pour le dernier niveau. Exemples : `nike-hoops-elite-backpack-32l-…`, `sony-playstation-ps5-dualsense-…`, `nike-air-force-1-low-07-suede-cacao-wow-womens` (FR et DE).
- R : corriger cette règle : ne pas émettre un niveau intermédiaire sans URL dans le JSON-LD, ou lui donner une URL. Impact : environ 2 % des pages, éligibilité de l'extrait fil d'Ariane. Pas un facteur de classement. Faible priorité.
- F : rien n'indique que la baseline soit celle que Google a vue pendant la chute. Son bug de fil d'Ariane, s'il existe, n'explique pas les chutes de septembre.

Sur le choix baseline ou candidat :
- R : ne publier aucun thème qui régresse le SEO FR/DE, les fils d'Ariane ou le paiement : si les constats de l'autre agent sont exacts, le candidat bâti à partir du live est le choix prudent. À lui de me confirmer par un diff.
- R : avant publication, comparer sur 10 URL (accueil, 3 collections, 5 fiches FR/DE) la prévisualisation et le live : `<title>`, meta description, canonical, hreflang, JSON-LD. Attention : mes requêtes directes vers le site reçoivent des 429 de Shopify ; faire ce test à la main ou en petit volume.
- R : calendrier. Core update Google commencé le 10 nov (en cours), Black Friday le 27 nov. Une publication de thème pendant le core update rend les causes illisibles. Soit publier avant le 18 nov, soit après le Black Friday.
- F (cx_01) : à ≈ 2 800 sessions humaines/jour et 0,29 % de conversion, un A/B détecte −25 % relatif en ≈ 2 mois, −10 % en ≈ 13 mois. Les réglages A/B de la baseline (`ab_upsell_mode`, `ab_post_size_flow_mode`) ne prouveront rien à ce trafic. Les garder pour la mécanique, pas pour mesurer.

Rapports existants : dépôt thème `SEO_TECHNICAL_NOTES.md` et `AUDIT_REPORT.md` (1er juillet 2026, jugent le SEO « solide », donc antérieurs aux changements de sept–nov), `analyses/cx_01_parcours_site.md`, `analyses/seo_01_*.md`, `seo_02_*.md`.

## 3. Perspectives d'amélioration, classées par valeur mensuelle estimée

Chiffres de contribution : ordres de grandeur, H pour toute estimation de volume. Aucune n'a été testée.

| # | Levier | Fait de départ | Estimation (CHF contribution/mois) | Confiance |
|---|---|---|---|---|
| 1 | Réduire les remboursements (8,5 % du brut, 108 commandes négatives en 3 mois) en alignant le délai affiché et le réel | Promesse standard 5–10 j.o. tenue dans 24,8 % des cas, express 2–5 j.o. dans 4,2 % ; 24 remboursements 2026 citent le retard (cx_01) | +1,3k (plafond 2,6k si moitié) | moyenne |
| 2 | Plafonner la dépense Google à 180–250 CHF/jour | ROAS d'équilibre 4,7–5,1, ROAS marginal estimé 2,3–3,0 (ads_09) | +1,2 à +2,1k | moyenne (observationnel) |
| 3 | Hausse de prix +3 % ciblée | Positif tant que la perte de volume < 12 % (cash_01) | +2,4k | faible : élasticité non mesurée |
| 4 | Plancher de prix (15 % des commandes à contribution négative) | cash_01 | +0,7k | moyenne |
| 5 | Choix de la taille | Seuls 10 % des visiteurs de fiche choisissent une taille ; trafic 82 % mobile, conversion mobile 0,19 % (cx_01) | +10 % de conversion ≈ +37 commandes ≈ +1,7k, H | faible : non mesurable par A/B |
| 6 | Checkout : validation des localités suisses | 18 % de finalisation des sessions mobiles en checkout (pixel sous-estimé de ≈ 29 %) | +0,1 à +0,5k (cx_01 : 1–6k/an) | moyenne |
| 7 | Frais d'expédition + préparation 14,5 → 11,5 | cash_01 | +1,1k | moyenne |
| 8 | Défendre l'organique marque | 61 % des commandes SEO sur l'accueil ; 33–54 commandes SEO/mois | maintien, pas de gain chiffré | moyenne |
| 9 | Étoiles dans les résultats | Google signale `aggregateRating` et `review` manquants sur presque toutes les fiches, alors que les notes sont censées venir de Judge.me | gain de CTR non chiffré, H | faible |
| 10 | Catalogue : retirer les 404 du sitemap, stopper la pagination profonde (`?page=814`), tester la réduction du catalogue indexé | 94 % des fiches avec impressions n'ont aucun clic ; 15 % du sitemap « explorée, non indexée » ; 3 204 URL de pagination/filtre | impact ventes inconnu ; réduit le gaspillage d'exploration | faible |
| 11 | Produits sans offre : émettre un Produit valide ou retirer le balisage | 7/229 erreurs Produit (« offers, review ou aggregateRating ») | marginal | haute sur le défaut, nulle sur l'impact |
| 12 | Fil d'Ariane intermédiaire sans URL (§2) | 4/229 | marginal | haute |

Ordre proposé : 1, 2, 4, 7 (cash direct, pas besoin de trafic), puis 6, 5 (conversion), puis 8–12 (SEO, après le core update).

Ce qui n'est PAS prioritaire :
- SEO sur les requêtes génériques de tête : 2–6 commandes/mois en plus au mieux (`seo_02` §4).
- Optimisation fine des titres et méta avant la fin du core update.
- Tout test A/B de conversion à ce trafic.

## 4. Limites

- Pas de Core Web Vitals mesurés (PSI sans clé épuisé, pas de CrUX). Le site est à 82 % mobile : la vitesse mobile reste un angle mort.
- Je ne connais pas le thème effectivement publié le 12 nov ni les contenus des thèmes baseline/candidat.
- Les estimations du tableau §3 viennent de calculs antérieurs (ads_09, cash_01, cx_01) ou d'hypothèses signalées H. Rien n'est un résultat d'expérience.
