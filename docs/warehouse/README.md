# Module Entrepôt et Partenaires — lot 1

Stock physique à l'unité : chaque paire a une identité permanente (UUID + QR), une adresse, un propriétaire et un historique. Le lot 1 couvre la reprise des paires déjà à Etoy, la réception, le rangement, les étiquettes et postes d'impression, les écarts, et le portail du partenaire avec son stock réel et les prix fixés par l'administration.

Le lot 1 est **inerte pour les canaux** : aucune écriture vers Shopify, Galaxus, Decathlon, StockX, l'EDI, le suivi ou la facturation.

**État** : code, migration et recette livrés dans une PR. Rien n'est appliqué en production : ni migration, ni déploiement, ni activation.

## Documents

| Fichier | Contenu |
|---|---|
| [`AUDIT.md`](AUDIT.md) | Lot 0 : code réutilisé, points d'entrée, effets de bord, constats hors périmètre |
| [`CONTRACTS.md`](CONTRACTS.md) | Contrat gelé : frontières, indicateurs, identité, états, règles d'écriture, routes, impression, prix |
| [`DECISIONS.md`](DECISIONS.md) | Décisions prises pour le pilote et décisions à prendre par l'équipe |
| [`MIGRATION.md`](MIGRATION.md) | Contenu de la migration, verrous, liste de contrôle avant production, activation, arrêt |
| [`RECETTE.md`](RECETTE.md) | Résultats : tests, mesures à 10 000 / 100 000 / 200 000 paires et 1 000 000 de codes, exercice de restauration, critères d'acceptation, ce qui reste à tester sur le matériel |
| [`M2-CASES.md`](M2-CASES.md) · [`.csv`](M2-CASES.csv) | Statut et preuve des 150 cas adverses (A01–C50) |
| [`knet-reference/`](knet-reference/) | Captures de référence visuelle (pages publiques d'un WMS du marché) |
| [`recette/`](recette/) | Résultats bruts des mesures (JSON) |

## Architecture en une page

```
app/warehouse/**            écrans équipe (Vue d'ensemble, Emplacements, Réception / Reprise, Rangement,
                            Stock, Postes et imprimantes, Écarts et contrôles, Partenaires / Tarifs)
app/partners/**             portail partenaire (Accueil, Mon stock, Envois, Prix et canaux,
                            Ventes et versements, Demandes et retraits)
        │  fetch
        ▼
app/api/warehouse/[...path]            → lib/warehouse/api/staff.ts     session équipe
app/api/partners/warehouse/[...path]   → lib/warehouse/api/partner.ts   session partenaire
        │
        ▼
lib/warehouse/*.ts          services : une fonction par geste, une transaction par geste
        │  SQL paramétré (Prisma)
        ▼
PostgreSQL — 32 tables Warehouse*   contraintes CHECK, index uniques partiels, triggers de garde
```

Principes tenus partout :

- **Un geste = une clé d'action = une transaction.** État courant, mouvement d'historique, réservation de place et travail d'impression sont écrits ensemble ou pas du tout. Rejouer la clé rend le même résultat.
- **L'état courant est indexé ; l'historique est à part.** Aucun écran ne recalcule le stock en relisant les mouvements. Toutes les listes sont paginées côté serveur par curseur stable.
- **La base garde les invariants** : une paire PRESENT a une adresse et une seule ; une seule tâche de rangement active, une seule session de comptage ouverte par niveau, un seul prix validé, une seule réservation de vente active par paire ; un code émis ne change jamais de paire.
- **Le partenaire ne passe jamais son identifiant** : il vient de la session. Une paire d'un autre déposant répond comme une paire inexistante, y compris par lien direct et par export.

## Lancer en local

Tout tourne sur un PostgreSQL local isolé (binaires hors dépôt, même version que la production). Aucun script n'accepte une base distante.

```bash
# 1. Base de démonstration + jeu de données
scripts/warehouse/dev-db.sh start
node scripts/warehouse/setup-test-db.mjs
WAREHOUSE_TEST_DATABASE_URL="$(scripts/warehouse/dev-db.sh url)" npx tsx scripts/warehouse/seed-demo.ts

# 2. Serveur de recette (module activé, base locale, secrets locaux)
scripts/warehouse/dev-server.sh 3111
#    équipe      : http://localhost:3111/login   mot de passe admin-local (admin) ou logistics-local
#    partenaire  : http://localhost:3111/partners/login   clé TONY

# 3. Tests
WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh start
node scripts/warehouse/setup-test-db.mjs --url "$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)"
WAREHOUSE_TEST_DATABASE_URL="$(WAREHOUSE_PG_DB=warehouse_vitest scripts/warehouse/dev-db.sh url)" npx vitest run lib/warehouse

# 4. Recette de charge et exercice de restauration (≈ 10 min, grappe séparée)
scripts/warehouse/run-recette.sh
```

Sans `WAREHOUSE_TEST_DATABASE_URL`, les tests d'intégration sont ignorés et `npm test` reste vert sans base.

## Indicateurs

Voir [`CONTRACTS.md` §2](CONTRACTS.md) et `.env.example`. L'essentiel :

| Variable | Défaut | Rôle |
|---|---|---|
| `WAREHOUSE_MODULE_ENABLED` | absent = désactivé | Masque tout le module |
| `WAREHOUSE_WRITES_ENABLED` | `true` | Interrupteur d'arrêt des écritures |
| `WAREHOUSE_PARTNER_ALLOWLIST` | vide = aucun partenaire | Partenaires qui voient leur stock |
| `WAREHOUSE_PILOT_SITES` | vide = tous | Sites où du stock peut entrer |
| `WAREHOUSE_LABEL_JOURNAL_DIR` / `_ENFORCE` | vide / `false` | Journal d'émission des QR hors disque de la base |

## Ce que le lot 1 ne fait pas

Publication et réservation sur les canaux, rapprochement des commandes, expédition, retours clients, retraits physiques, versements et factures, application mobile. Les tables `WarehouseSaleAllocation` et `WarehouseTransfer*` existent et sont testées au niveau service (une paire ne peut être réservée ou en transit qu'une fois), sans écran ni branchement canal.
