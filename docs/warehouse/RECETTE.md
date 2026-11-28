# Module Entrepôt et Partenaires — recette du lot 1

Ce document dit ce qui a été vérifié, comment le refaire, et ce qui reste à vérifier ailleurs que dans le code.
Tout a été exécuté sur un poste de développement, contre un PostgreSQL local isolé (même version majeure que la production) et des données synthétiques.
**Rien n'a été exécuté sur la production : ni migration, ni écriture, ni déploiement.**

## 1. Tests automatiques

```bash
# Base de test locale (une fois)
WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh start
node scripts/warehouse/setup-test-db.mjs --url "$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)"

# Tests du module
WAREHOUSE_TEST_DATABASE_URL="$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)" npx vitest run lib/warehouse

# Suite complète du dépôt (les tests d'intégration du module sont ignorés sans WAREHOUSE_TEST_DATABASE_URL)
npm test

# Types (le dépôt a des erreurs antérieures hors module : on filtre sur les chemins du lot)
npx tsc --noEmit -p . | rg "lib/warehouse|scripts/warehouse|api/warehouse|app/warehouse|app/partners|AppNav"

# Schéma
DATABASE_URL=postgresql://x:y@127.0.0.1:1/z DIRECT_URL=postgresql://x:y@127.0.0.1:1/z npx prisma validate
```

Résultats du 28 novembre 2026, sur la branche `feat/warehouse-partners-lot1` :

| Vérification | Résultat |
|---|---|
| Tests du module (`npx vitest run lib/warehouse`, base locale) | 7 fichiers, 123 tests, tous verts ; 8 passages consécutifs sans échec |
| Suite complète du dépôt (`npm test` avec la base de test du module) | 2 289 tests verts, 9 en échec dans 6 fichiers étrangers au module |
| Suite complète sans base de test (`npm test` seul, comme sur un poste sans PostgreSQL local) | 2 198 verts, 91 ignorés (les tests d'intégration du module), les 9 mêmes échecs |
| Les 9 échecs | Identiques sur `origin/main` avant ce lot (2 166 verts, 9 en échec) : `app/lib/exlibrisPricing.test.ts`, `app/lib/uncommonClient.test.ts`, `app/utils/matching.localStock.test.ts`, `galaxus/exports/masterSpecsDiffApply.test.ts`, `healthdata/nutrition/mfpCsv.test.ts`, `shopify/inventory/__tests__/expressRepriceSync.test.ts`. Non corrigés ici : hors périmètre |
| Types sur les chemins du lot | Aucune erreur |
| `npx prisma validate` | Schéma valide |
| `next build` (base locale) | Réussi ; les 11 pages Entrepôt, les pages partenaire du lot et les 2 routes API du module sont compilées |
| Parcours des écrans dans un navigateur sans affichage (`node scripts/warehouse/ui-smoke.mjs`, puis `--mobile`) | 19 pages sur 19 sans erreur en grand écran et en format téléphone : pas d'erreur de script, pas d'appel API en échec |
| Geste complet dans le navigateur (lot de réception ouvert, base de démonstration) | Code de carton refusé avec le code probable de la boîte ; paire déjà connue signalée sans rien modifier ; scan d'un GTIN, format « Grande », touche Entrée, identification de l'opérateur demandée puis paire créée au format `LARGE` sous la même clé d'action. Rangement de cette paire : aucune place proposée (aucun niveau n'accepte ce format), niveau scanné, confirmation demandée, paire rangée, écart de format tracé dans le mouvement ; les compteurs du lot, de la zone et du menu suivent sans recharger la page |

Captures des écrans (données de démonstration uniquement) : [`screens/`](screens/).

| Fichier | Ce qu'il prouve |
|---|---|
| `pure.test.ts` | Lecture des codes, clés d'action, mise en page de l'étiquette 50 × 30 mm, calcul des prix, lecture CSV — sans base |
| `isolation.test.ts` | Le module n'importe aucun connecteur, ne fait aucun appel réseau, n'écrit que dans des tables `Warehouse*` (analyse du code, puis parcours complet avec comparaison des tables) |
| `flow.int.test.ts` | Réception, clés d'action, rangement, capacité et concurrence, états, transferts entre sites, compteurs |
| `stocktake-print-partner.int.test.ts` | Reprise par niveau, impression et postes, isolation des partenaires, prix, imports, permanence des codes, interrupteur d'arrêt |
| `api.int.test.ts` | Les deux points d'entrée HTTP : indicateurs, sessions, rôles, opérateur, poste, journal d'émission, isolation par lien direct |
| `reference-qr.int.test.ts` | Les textes de QR de référence (`fixtures/reference-qr.json`) désignent toujours le même UUID, y compris la paire archivée émise il y a dix ans |
| `m2-gaps.int.test.ts` | Les cas relevés par la revue adverse (A03, A08, A09, A10, A12, A15, A28, A31, A32, A35, A36, A37, C13, C29, C34, C44, C49) |

Les tests d'intégration créent leur propre site, leurs racks et leur partenaire à chaque cas : ils se lancent en parallèle et se relancent sans remise à zéro de la base.

## 2. Migration — validation hors production

- Fichier : `prisma/migrations/20261128040000_warehouse_lot1/migration.sql`. Additive : 32 tables `Warehouse*`, aucune table existante modifiée. Détail, verrous et liste de contrôle : [`MIGRATION.md`](MIGRATION.md).
- Rejouée depuis zéro à chaque recette : `scripts/warehouse/setup-test-db.mjs` crée une base vide, y pose le schéma actuel de la production sans la partie Entrepôt (`prisma db push`, car l'historique des migrations ne se rejoue pas depuis zéro), marque les migrations existantes comme appliquées, puis lance `prisma migrate deploy` : seule la migration du lot est appliquée, par le chemin exact que prendra la production. Le script refuse toute base qui n'est pas locale. `run-recette.sh` le fait sur une grappe neuve avant chaque campagne de mesures.
- `npx prisma validate` passe ; le client Prisma n'a pas besoin d'être régénéré (le module utilise du SQL paramétré).
- Les garde-fous posés par la migration sont testés : « the database itself refuses to delete a pair, rewrite its identity or edit history », « UUID collision: the database refuses the duplicate… », et, dans les mesures, « doublon de code refusé par la base », « réattribution d'un code refusée par la base ».
- **Non fait, volontairement** : application sur la base de production (`prisma migrate deploy` part au déploiement, donc à la fusion sur `main`). La PR ne doit pas être fusionnée avant la liste de contrôle de `MIGRATION.md`.

## 3. Mesures de charge

Commande : `scripts/warehouse/run-recette.sh` (grappe PostgreSQL séparée, port 54330). La même base grossit de palier en palier : 10 000 → 100 000 → 200 000 paires actives et 1 000 000 de mouvements → 1 000 000 de codes d'étiquette cumulés, puis dix minutes de charge continue au plus gros palier, puis l'exercice de restauration.
Chaque mesure redémarre la base pour partir à froid.

Résultats complets, générés depuis les fichiers JSON : [`recette/SUMMARY.md`](recette/SUMMARY.md). Fichiers bruts : [`recette/`](recette/).

| Palier | Paires actives | Codes au registre | Mouvements en ligne | Requêtes / s | p95 toutes routes | p95 des 5 premières secondes (à froid) | p95 écritures | Route la plus lente (p95) | Erreurs | Interblocages |
|---|---:|---:|---:|---:|---:|---:|---:|---|---:|---:|
| 10k | 10 000 | 10 000 | 20 000 | 1 501 | **2,75 ms** | 3,07 ms | 4,65 ms | station: receive pair : 5,25 ms | 0 | 0 |
| 100k | 100 000 | 100 000 | 200 093 | 1 445 | **6,70 ms** | 7,04 ms | 6,29 ms | station: overview : 21,4 ms | 0 | 0 |
| 200k | 200 000 | 200 000 | 1 000 000 | 1 395 | **12,7 ms** | 12,7 ms | 6,70 ms | station: overview : 69,6 ms | 0 | 0 |
| 1M-codes | 202 260 | 1 000 000 | 2 438 379 | 1 312 | **22,3 ms** | 22,7 ms | 7,71 ms | station: overview : 120 ms | 0 | 0 |
| 10 min continues | 203 363 | 1 001 103 | 2 440 678 | 1 324 | **23,0 ms** | 23,1 ms | 7,44 ms | station: overview : 129 ms | 0 | 0 |

Charge : 50 sessions partenaires et 2 postes en parallèle. Objectif de la feuille de route : p95 < 1 s — tenu à chaque palier, sur chaque route, à froid comme sur dix minutes (794 726 requêtes, 0 erreur, 17 613 paires créées pendant la mesure, 0 niveau en dépassement, écart des compteurs 0 / 0).

Registre à 1 000 000 de codes : génération du palier en 97,2 s ; résolution d'un QR p50 0,22 ms, p95 0,37 ms (premier appel après redémarrage : 1,56 ms) ; plan = recherche par l'index unique : oui ; 22 320 scans par seconde sur 64 fils, chacun rendant son propre UUID ; taille des tables et index du module : 3 882 Mo.

Dernière place disputée par deux postes : un seul gagnant dans 25 essais sur 25, à chaque palier.

Ce que ces chiffres mesurent, et ce qu'ils ne mesurent pas :

| Mesuré ici (simulé) | Pas mesuré ici |
|---|---|
| 50 sessions partenaires et 2 postes en parallèle, appelant les vraies routes (session, rôle, service, base, JSON) dans le processus | Réseau, TLS, proxy inverse, navigateur |
| Requêtes, index et verrous à 10 000, 100 000, 200 000 paires et 1 000 000 de codes | Le VPS de production (CPU, mémoire, disque partagés avec les autres services) |
| Démarrage à froid de la base, puis dix minutes de charge continue | Les deux postes réels : douchette, QZ Tray, imprimante thermique |
| Concurrence sur la dernière place, compteurs, intégrité après charge | La base hébergée de production (latence réseau entre le VPS et la base) |

La mesure à refaire avant l'ouverture : la même commande de charge contre l'application déployée sur le VPS avec le module activé pour un site de test, et un passage chronométré des deux postes réels (voir §7).

## 4. Exercice de restauration

Commande : `npx tsx scripts/warehouse/restore-drill.ts` (lancée par `run-recette.sh`). Résultat : [`recette/restore-drill.json`](recette/restore-drill.json), tableau dans `SUMMARY.md`.

Déroulé : sauvegarde de la base à T0 ; après T0, des paires sont reçues, étiquetées, rangées, et d'anciennes paires déplacées ; la base est restaurée à T0 ; on rescanne.

- Les QR de référence (dont la paire sortie et archivée émise il y a dix ans, et une paire transférée) rendent le même UUID et le même état après restauration.
- Les QR collés après T0 sont signalés « code inconnu » sur la base restaurée ; le scan n'en crée aucune paire.
- La reprise du journal d'émission (`journal/reconcile`, d'abord à blanc) restaure ces identités avec le même UUID, en « à vérifier, propriétaire inconnu, vente bloquée », et ouvre un écart par paire. Une seconde reprise ne restaure rien.
- Les déplacements et rangements faits après T0 sont perdus : c'est la perte normale d'une restauration, elle se rattrape par un recomptage des niveaux touchés. Les identités, elles, ne sont pas perdues.

## 5. Journal d'émission hors disque primaire

Chaque paire créée écrit, dans la même transaction, une ligne dans `WarehouseLabelJournal`. Cette ligne est ensuite copiée en JSONL dans `WAREHOUSE_LABEL_JOURNAL_DIR`.

- L'export part tout seul : après chaque geste qui émet un code (réception, création en reprise) et avant chaque prise de job par un poste. Il reste déclenchable à la main (`POST journal/export`, bouton en vue d'ensemble).
- Avec `WAREHOUSE_LABEL_JOURNAL_ENFORCE=true`, une étiquette de paire ne sort pas tant que sa ligne n'est pas sur le support : ni par la file du poste, ni par le PDF de secours, ni par « impression manuelle faite ». La paire, elle, existe déjà : rien n'est perdu, l'étiquette attend.
- La vue d'ensemble alerte si l'export prend du retard, si le support n'est plus accessible en écriture, ou s'il lui reste moins de 1 Go.
- **À décider avant d'imprimer en série** (Q-04 de `DECISIONS.md`) : la cible. Elle doit être sur un autre disque que la base — un volume distinct monté dans le conteneur, synchronisé hors site. Tant qu'elle n'est pas choisie, garder `ENFORCE` à `false` revient à faire confiance aux seules sauvegardes de la base.

## 6. Critères d'acceptation (feuille de route §9)

« Code » : prouvé par un test automatique ou une mesure rejouable. « Matériel » : reste à constater sur place.

| # | Critère | État | Preuve |
|---|---|---|---|
| 1 | Dix boîtes de même GTIN donnent dix UUID ; un renvoi ne duplique rien | Code | « ten boxes with the same GTIN give ten UUIDs, ten label codes, ten putaway tasks », « re-sending the same action key returns the same pair… », « a double click fired in parallel creates exactly one pair » |
| 2 | Reprise sous le bon déposant, pause et reprise, différences expliquées | Code | « level → boxes → labels: pairs are born at the level, owned by the partner… », « one level is counted by one station at a time; the same station resumes… », « a recount lists the pairs the system places there but nobody scanned… », « a count never changes the owner… », « A08… », « A32… », « closing a batch with an open count is refused; a short batch needs a reason » |
| 3 | Réception → chariot → niveau, avec des traces distinctes | Code | « proposes places in walk order, never more than the capacity, and confirms by pair then level », « a complete pilot flow changes rows in Warehouse* tables only » (mouvements RECEIVE puis PUTAWAY) |
| 4 | Deux postes sur la dernière place : un seul gagne, pas de surréservation | Code | « two stations fighting for the last place… », « many concurrent proposals never reserve more than the capacity » ; mesure « dernière place à deux postes » à chaque palier |
| 5 | Échec d'impression, réimpression, même niveau scanné deux fois | Code | « a failed print is retried on the same job; a reprint is a new job with a reason and the SAME code… », « the same pair scanned twice on the same level counts once » |
| 6 | Deux partenaires isolés, lien direct et export compris | Code | « a partner only ever sees its own pairs, with no warehouse-internal field », « lists, detail, export and requests are scoped by the session — query parameters cannot widen the scope », « a pair whose owner is unknown or was changed disappears from the former partner's view », « the allow-list is fail-closed… » |
| 7 | Prix public et net vendeur distincts ; un prix absent ne bloque pas le rangement ; pas de prix sur une mauvaise pointure | Code | « admin-only, validated price shown to the partner with both amounts… », « a StockX-based proposal touches only the partner's pairs of that exact size… », « correcting the variant or the owner withdraws the price… », « never invents amounts when terms are missing » ; tous les tests de rangement tournent sans prix |
| 8 | Les écrans distinguent attendu, présent, rangé, vendable, publié | Code + écran | Totaux d'un lot (`expected`, `identified`, `shelved`, `atTemporary`), cinq états séparés d'une paire, « Publié » vide avec son motif côté partenaire (`summary.published` nul, `publishedReason`). À parcourir à l'écran en recette manuelle |
| 9 | Aucune régression du scan historique, de Shopify, de Galaxus ; aucun effet EDI, canal, commande, facture | Code | `isolation.test.ts` (imports, appels réseau, cibles d'écriture, comparaison des tables avant / après un parcours complet) ; suite complète du dépôt : mêmes résultats que `main` hors module (§1) |
| 10 | La PR contient la migration, sa validation hors production, les commandes et les limites | Fait | §2, §1, §8 ; `MIGRATION.md` |
| 11 | Chaque poste imprime sur sa destination ; ajout d'une imprimante par l'écran ; test d'impression ; reroutage après panne ; un délai incertain ne réimprime jamais seul | Code + **matériel** | « each station only receives its own jobs, and one job is claimed by one agent only », « the print agent must prove its station… », « C13… », « a claimed job with no answer becomes UNCERTAIN: never resent or rerouted automatically », « C10… » ; écran Postes et imprimantes. L'impression réelle sur deux postes reste à faire |
| 12 | Type, format et QR de l'étiquette vérifiés en taille réelle | Code + **matériel** | « pair label fits 50 × 30 mm with a quiet zone and modules ≥ 0.33 mm (300 dpi ≥ 4 dots) », « QR matrix is square, deterministic and large enough for 41 characters at level Q ». Lecture à la douchette sur une vraie étiquette collée : à faire |
| 13 | Mesure à 50 sessions documentée, en distinguant simulé, matériel et VPS | Fait | §3 |
| 14 | Transfert niveau → niveau, puis CH01 → site de test étranger : UUID, QR et historique conservés | Code | « a pair issued at one site is shipped, received abroad and keeps its UUID and label code », « a pair cannot be put on a foreign site's shelf without a transfer » |
| 15 | Nouvelle adresse et niveau renommé : les anciens QR fonctionnent | Code | « a renamed level still resolves by its old printed code » ; le QR d'une paire ne contient pas son adresse |
| 16 | Recette reproductible à 10 000, puis 100 000 et 200 000 paires ; 1 000 000 d'identifiants avec recherche indexée, temps de génération et latence de résolution ; QR de référence, dont la paire archivée de dix ans, intacts après migration et restauration | Code | `run-recette.sh`, `recette/SUMMARY.md` ; `reference-qr.int.test.ts` ; « an archived pair that left years ago still resolves from its label, with its history retrievable » ; §4 |

## 7. Ce qui est testé, ce qui reste à tester, ce qui est hors lot

**Testé dans le code** : tout le §6 marqué « Code », les 69 cas M2 du lot 1 marqués « déjà couvert » ([`M2-CASES.md`](M2-CASES.md)), la migration rejouée depuis zéro, les mesures du §3, la restauration du §4.

**À tester sur le matériel du dépôt** (rien de tout cela n'a pu l'être depuis un poste de développement) :

1. Impression d'une étiquette de paire 50 × 30 mm sur l'imprimante thermique réelle, par QZ Tray, depuis chacun des deux postes ; lecture de cette étiquette à la douchette, collée sur une boîte.
2. Réglages de l'imprimante : taille du support, densité, décalage ; le test d'impression de l'écran Postes sert à cela.
3. Douchette en mode clavier sur le poste réel : disposition du clavier, suffixe Entrée (cas A31).
4. Imprimante éteinte puis rallumée, rouleau vide, câble débranché : le job doit passer en « échec » ou « incertain », jamais se réimprimer seul (cas C10, C11, C13).
5. Tenue de l'étiquette : colle, contraste, emplacement sur la boîte (cas A30).
6. Cadence réelle d'un opérateur sur un niveau complet : l'écran du lot l'affiche (cas C49).
7. Mesure de charge contre le VPS, module activé sur un site de test (cas C37).
8. Lecture des écrans sur l'écran du poste et sur un téléphone, avec des gants si c'est l'usage.

**Hors lot 1** (79 cas M2 reportés, lots 2 à 7) : publication et réservation sur Shopify et Galaxus, rapprochement des commandes, préparation et expédition, retours clients, retraits physiques par le partenaire, versements et factures, application mobile, mode hors ligne. Les options correspondantes du portail partenaire sont présentes et grisées, chacune avec son motif ; aucun montant n'est inventé.

## 8. Procédure de panne

| Ce que voit l'opérateur | Ce que cela veut dire | Ce qu'il fait |
|---|---|---|
| Bandeau « action en attente de vérification » | La réponse du serveur n'est pas arrivée ; l'action a peut-être été enregistrée | Bouton « Vérifier » (même clé d'action) avant tout autre scan. Ne pas rescanner la boîte |
| « Rien n'a été enregistré… ne collez plus d'étiquette » (`STORAGE_UNAVAILABLE`) | La base refuse les écritures (lecture seule, disque plein) ou est injoignable | Arrêter. Poser les boîtes non confirmées à part, sans étiquette. Prévenir le responsable |
| « Écritures du module arrêtées » (`WRITES_DISABLED`) | L'interrupteur d'arrêt est actif | Consultation seule. Attendre la levée par le responsable |
| Étiquette « à imprimer », rien ne sort | Pas d'imprimante routée, poste non appairé, ou journal d'émission en retard | Écran Postes et imprimantes. La paire existe : ne pas recréer la boîte |
| Job « incertain » | L'imprimante a pris le job et n'a pas répondu | Regarder le papier. « Imprimé » ou « Pas imprimé », puis réimpression explicite si besoin. Jamais deux étiquettes collées |
| « Comptage sans activité… rescanner le niveau » (`SESSION_STALE`) | Le comptage est resté ouvert trop longtemps | Rescanner le code du niveau où l'on se trouve |
| Réseau coupé | Aucun geste ne passe | Voir Q-14 de `DECISIONS.md` : boîtes en zone d'attente, reprise des scans au retour |

Côté responsable : `WAREHOUSE_WRITES_ENABLED=false` arrête toutes les écritures du module sans toucher au reste du tableau de bord ; `WAREHOUSE_MODULE_ENABLED` absent le masque entièrement. Après une restauration de la base : reprise du journal d'émission à blanc, puis appliquée (§4), puis recomptage des niveaux touchés depuis la sauvegarde. Jamais de restauration qui ferait disparaître des identités déjà collées sans cette reprise.

## 9. Déroulé multi-agents (feuille de route §8)

- Lot 0 : audit en lecture seule (`AUDIT.md`), puis gel du contrat (`CONTRACTS.md`).
- Un seul auteur pour le schéma et la migration (le coordinateur), qui a aussi écrit le domaine et l'API.
- Deux flux d'édition en parallèle, sur des dossiers disjoints : écrans de l'entrepôt (`app/warehouse/**`, navigation) et portail partenaire (`app/partners/**`). Ils n'ont consommé que le contrat gelé.
- Un agent de revue en lecture seule a confronté les 150 cas M2 au code intégré ; ses 12 manques ont été corrigés ensuite, chacun avec son test.
- Aucune base, file, clé transporteur ou connecteur de production n'a servi à la recette ; aucun fichier de secrets n'a été copié dans l'arbre de travail.

## 10. Limites connues

- Les mesures viennent d'un poste de développement (§3). Elles valident le code et les index, pas le VPS.
- L'impression n'a été exercée que jusqu'à la file et au rendu PDF / SVG ; QZ Tray et l'imprimante réelle restent à brancher.
- Les écrans n'ont pas de tests dans la suite automatique. `scripts/warehouse/ui-smoke.mjs` les charge tous dans un navigateur sans affichage (erreurs de script, appels API en échec, captures) ; les gestes n'ont été joués dans le navigateur que sur la réception et le rangement (§1).
- Le portail partenaire garde l'authentification existante : un accès par partenaire, pas par personne (Q-15), et la connexion rapide accepte une clé seule tant que `PARTNER_ACCESS_<KEY>` n'est pas défini (constat R2 de `AUDIT.md`).
- L'espace disque du serveur de base ne se lit pas depuis l'application : l'alerte correspondante est à poser chez l'hébergeur.
- La preuve d'identification d'un article est un texte ; pas de photo en lot 1.
- Constats hors périmètre relevés pendant l'audit (R1 à R6 de `AUDIT.md`) : aucune table de production n'a de RLS, pas de tests en intégration continue sur les PR, historique de migrations non rejouable depuis zéro. Ils ne sont pas traités ici.
