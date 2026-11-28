# Mesures de recette — synthèse générée

Généré par `scripts/warehouse/recette-summary.mjs` à partir des fichiers JSON de ce dossier. Mesures du 2026-11-28.
Environnement : darwin/arm64, Node v22.18.0, grappe locale isolée, données synthétiques, 20 connexions. **Ce n'est pas le VPS.**
Latences en millisecondes. Les routes sont appelées dans le processus (session, routage, service, base, JSON) : ni réseau, ni TLS, ni proxy.

## Jeu de données

| Palier | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Paires actives | 10 000 | 100 000 | 200 000 | 202 260 |
| Paires au total (actives + sorties) | 10 000 | 100 000 | 200 000 | 1 000 000 |
| Codes d'étiquette au registre | 10 000 | 100 000 | 200 000 | 1 000 000 |
| Mouvements en ligne | 20 000 | 200 093 | 1 000 000 | 2 438 379 |
| Mouvements archivés | 0 | 0 | 0 | 959 454 |
| Sites | SC01 7 000<br>SD01 3 000 | SC01 55 000<br>SC02 25 000<br>SD01 20 000 | SC01 110 000<br>SC02 50 000<br>SD01 40 000 | SC01 112 260<br>SC02 50 000<br>SD01 40 000 |
| Niveaux de rack | 1 200 | 11 000 | 21 900 | 21 900 |
| Déposants | 60 | 60 | 60 | 60 |
| Variantes | 6 000 | 6 000 | 6 000 | 6 000 |
| Plus gros déposant (paires) | 1 429 | 13 562 | 27 046 | 27 148 |
| Déposant médian (paires) | 98 | 954 | 1 953 | 1 953 |
| Part de la variante la plus fréquente | 5.4 % | 5.5 % | 5.5 % | 5.5 % |
| Génération du palier (s) | 1.3 | 10.7 | 27.7 | 97.2 |
| Taille tables + index du module (Mo) | 55 | 386 | 1 058 | 3 882 |

## Lectures, une par une — p50 / p95 (premier appel après redémarrage de la base)

| Requête | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| scan: pair QR → unit (registry) | 0.21 / 0.35 (1.34) | 0.22 / 0.35 (1.39) | 0.25 / 0.37 (1.55) | 0.22 / 0.37 (1.56) |
| scan: QR of a pair gone / archived | — | — | — | 0.19 / 0.21 (0.22) |
| scan: well-formed code never issued | 0.14 / 0.17 (0.62) | 0.15 / 0.16 (0.54) | 0.14 / 0.16 (0.66) | 0.14 / 0.17 (0.70) |
| scan: level code → location | 0.08 / 0.11 (0.67) | 0.09 / 0.13 (0.62) | 0.09 / 0.14 (0.70) | 0.09 / 0.11 (0.71) |
| scan: GTIN → variant | 0.23 / 0.29 (1.68) | 0.23 / 0.26 (1.67) | 0.22 / 0.26 (1.72) | 0.21 / 0.28 (1.64) |
| unit detail (state + history) | 0.47 / 1.72 (20.2) | 0.45 / 1.56 (16.7) | 0.47 / 1.82 (16.1) | 0.47 / 1.87 (17.2) |
| stock list: site, page 1 (50) | 0.75 / 0.92 (1.58) | 0.74 / 0.90 (1.54) | 0.78 / 1.07 (1.62) | 0.79 / 0.99 (1.59) |
| stock list: keyset pages 1→40 | 0.81 / 1.18 | 0.81 / 1.15 | 0.83 / 1.32 | 0.85 / 1.28 |
| stock list: one owner on one site | 0.49 / 0.81 (1.01) | 0.72 / 0.85 (0.90) | 0.84 / 1.03 (0.94) | 0.85 / 1.02 (0.95) |
| stock list: sellable + quality passed | 0.78 / 1.06 (1.06) | 0.95 / 1.24 (1.24) | 1.11 / 1.32 (1.62) | 1.32 / 1.55 (2.02) |
| stock list: missing pairs | 1.27 / 1.56 (1.06) | 2.63 / 2.90 (3.74) | 4.08 / 5.07 (5.91) | 5.04 / 5.51 (8.78) |
| stock list: one level | 0.19 / 0.40 (0.71) | 0.22 / 0.26 (0.73) | 0.23 / 0.44 (0.78) | 0.24 / 0.52 (0.85) |
| stock search: style code (text) | 3.65 / 4.20 (1.37) | 1.46 / 27.4 (1.75) | 1.72 / 24.2 (2.32) | 4.58 / 38.0 (30.2) |
| stock search: GTIN | 0.14 / 1.08 (1.64) | 0.13 / 1.22 (1.67) | 0.13 / 1.30 (1.79) | 0.14 / 1.39 (1.90) |
| stock search: short ref (ABCD-1234) | 0.33 / 0.40 (0.76) | 0.39 / 0.45 (0.78) | 0.42 / 0.51 (0.90) | 1.13 / 1.34 (4.33) |
| stock by variant: site, page 1 | 5.52 / 5.81 (6.31) | 25.3 / 30.7 (25.3) | 50.1 / 51.4 (49.3) | 58.0 / 61.2 (61.9) |
| overview: site dashboard | 2.49 / 4.02 (13.4) | 13.2 / 15.3 (25.9) | 49.0 / 51.5 (58.4) | 85.2 / 96.2 (96.2) |
| reconciliation: site × owner × state | 4.76 / 5.38 (5.38) | 47.3 / 48.0 (47.3) | 32.8 / 35.9 (35.9) | 240 / 258 (258) |
| putaway queue: site | 0.96 / 2.40 (3.71) | 4.11 / 10.1 (11.4) | 7.69 / 16.3 (18.3) | 7.80 / 14.0 (13.2) |
| locations: site structure | 0.82 / 1.31 (1.31) | 4.70 / 5.52 (5.52) | 8.36 / 8.78 (8.78) | 8.31 / 9.70 (9.70) |
| partner biggest: summary | 2.02 / 2.40 (3.44) | 21.9 / 24.8 (24.8) | 40.1 / 41.7 (39.4) | 50.6 / 52.4 (55.5) |
| partner biggest: list page 1 | 0.32 / 0.57 (1.13) | 0.60 / 0.92 (1.43) | 0.55 / 0.68 (1.38) | 0.54 / 0.81 (1.37) |
| partner biggest: by variant | 1.79 / 2.05 (2.83) | 15.7 / 16.4 (11.2) | 17.4 / 18.0 (16.9) | 17.7 / 18.3 (16.3) |
| partner biggest: search style | 0.83 / 1.19 (1.26) | 9.83 / 10.7 (2.03) | 16.7 / 17.7 (2.07) | 17.2 / 18.4 (14.2) |
| partner median: summary | 0.79 / 0.84 (0.95) | 4.18 / 4.46 (4.56) | 7.99 / 8.38 (8.71) | 16.3 / 18.5 (17.2) |
| partner median: list page 1 | 0.31 / 0.36 (0.42) | 0.55 / 0.87 (0.87) | 0.58 / 0.70 (0.91) | 0.56 / 0.69 (0.86) |
| partner median: by variant | 1.04 / 1.12 (1.13) | 3.97 / 4.30 (4.34) | 3.47 / 4.17 (4.06) | 3.06 / 3.40 (3.95) |
| partner median: search style | 0.79 / 0.86 (0.94) | 1.09 / 1.30 (1.36) | 1.70 / 2.39 (2.71) | 1.64 / 1.80 (1.98) |

## Gestes, un par un — p50 / p95

| Geste | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| receive one pair (new UUID + label job + task) | 2.30 / 3.11 | 2.25 / 3.31 | 2.27 / 3.02 | 2.23 / 3.13 |
| replay of the same gesture key | 0.31 / 0.38 | 0.31 / 0.36 | 0.32 / 0.36 | 0.30 / 0.35 |
| propose destinations for 100 pairs | 71.7 / 71.7 | 114 / 114 | 154 / 154 | 144 / 144 |
| confirm putaway (scan pair + level) | 1.62 / 1.96 | 1.62 / 1.98 | 1.61 / 2.07 | 1.65 / 1.93 |
| relocate a pair to another level | 1.39 / 1.81 | 1.48 / 1.94 | 1.43 / 1.75 | 1.44 / 1.70 |
| quality check passed | 0.88 / 1.14 | 0.92 / 1.33 | 0.89 / 1.14 | 1.01 / 1.23 |

## Charge mixte — sessions partenaires et postes en parallèle

| Mesure | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Sessions partenaires / postes | 50 / 2 | 50 / 2 | 50 / 2 | 50 / 2 |
| Durée (s) | 30.4 | 30.4 | 60.4 | 30.4 |
| Requêtes | 45 634 | 43 864 | 84 220 | 39 952 |
| Requêtes par seconde | 1 501 | 1 445 | 1 395 | 1 312 |
| Erreurs | 0 | 0 | 0 | 0 |
| Toutes routes — p50 | 0.97 | 1.39 | 1.66 | 1.82 |
| Toutes routes — **p95** | **2.75** | **6.70** | **12.7** | **22.3** |
| Toutes routes — p99 | 4.06 | 11.5 | 21.7 | 34.2 |
| Toutes routes — max | 40.5 | 38.5 | 149 | 286 |
| 5 premières secondes (à froid) — p95 | 3.07 | 7.04 | 12.7 | 22.7 |
| Écritures seules — p95 | 4.65 | 6.29 | 6.70 | 7.71 |
| Route la plus lente (p95) | station: receive pair : 5.25 | station: overview : 21.4 | station: overview : 69.6 | station: overview : 120 |
| p95 < 1 s sur chaque route | oui | oui | oui | oui |
| Interblocages | 0 | 0 | 0 | 0 |
| Transactions validées / annulées | 129 555 / 22 | 130 563 / 23 | 255 946 / 24 | 127 593 / 24 |
| Blocs lus sur disque / en cache | 652 / 11 216 613 | 7 994 / 55 518 408 | 1 982 497 / 184 423 303 | 5 238 707 / 109 010 616 |
| CPU du processus applicatif (s) | 23 | 25.4 | 56.1 | 28.8 |

### Par route — p95 (p99)

| Route | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| partner: home summary | 2.44 (3.32) | 11.3 (22.8) | 23.0 (44.9) | 38.2 (65.0) |
| partner: my stock next page | 1.31 (1.87) | 1.81 (2.37) | 2.19 (2.91) | 2.43 (3.43) |
| partner: my stock page | 1.32 (1.96) | 1.85 (2.47) | 2.14 (2.76) | 2.34 (3.42) |
| partner: pair detail | 1.37 (1.96) | 1.63 (2.31) | 1.87 (2.80) | 2.10 (3.23) |
| partner: requests | 0.79 (1.19) | 1.02 (1.63) | 1.16 (1.77) | 1.35 (2.10) |
| partner: search | 1.83 (2.32) | 4.20 (10.8) | 8.00 (20.9) | 8.73 (21.8) |
| partner: stock by variant | 2.45 (2.93) | 6.86 (11.8) | 10.7 (20.1) | 11.8 (22.5) |
| station: confirm putaway | 4.19 (5.52) | 4.95 (6.11) | 5.66 (6.96) | 6.04 (8.06) |
| station: overview | 4.93 (13.6) | 21.4 (27.8) | 69.6 (148) | 120 (286) |
| station: propose destination | 3.49 (4.60) | 7.15 (8.54) | 10.5 (14.3) | 12.7 (15.8) |
| station: putaway queue of the batch | 1.22 (1.72) | 1.97 (2.54) | 2.28 (2.99) | 2.41 (3.25) |
| station: receive pair | 5.25 (7.33) | 6.54 (8.65) | 7.15 (9.29) | 7.81 (13.4) |
| station: scan GTIN | 1.17 (1.63) | 1.33 (2.08) | 1.46 (2.24) | 1.76 (2.58) |
| station: scan new QR | 0.92 (1.31) | 1.10 (1.55) | 1.24 (1.69) | 1.24 (1.91) |
| station: scan old QR | 0.85 (1.27) | 0.97 (1.37) | 1.16 (1.66) | 1.33 (2.18) |
| station: stock list | 2.20 (2.55) | 2.26 (2.56) | 2.80 (3.24) | 2.95 (3.85) |

## Registre des codes et intégrité après la charge

| Contrôle | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Recherche d'un code par l'index unique (plan) | oui | oui | oui | oui |
| Historique d'une paire par index | oui | oui | oui | oui |
| Liste partenaire sans parcours séquentiel | oui | oui | oui | oui |
| Scans en parallèle (64 fils) par seconde | 22 130 | 22 309 | 21 049 | 22 320 |
| … p95 / p99 | 4.00 / 4.69 | 3.51 / 4.22 | 3.81 / 4.87 | 3.37 / 3.96 |
| … chaque code rend son propre UUID | oui | oui | oui | oui |
| Codes distincts = codes | oui (11 380) | oui (101 327) | oui (202 259) | oui (1 001 102) |
| Doublon de code refusé par la base | oui | oui | oui | oui |
| Réattribution d'un code refusée par la base | oui | oui | oui | oui |
| Nouveau code émis après le palier, scanné → son UUID | oui | oui | oui | oui |
| Dernière place à deux postes : un seul gagnant | 25 / 25 | 25 / 25 | 25 / 25 | 25 / 25 |
| Niveaux en dépassement de capacité | 0 | 0 | 0 | 0 |
| Paires créées pendant la mesure | 1 380 | 1 327 | 2 259 | 1 102 |
| Total avant + créées = total après | oui | oui | oui | oui |
| Paires sans ligne de registre / de journal | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Écart compteur d'occupation / réalité | 0 | 0 | 0 | 0 |
| Écart compteur de réservation / réalité | 0 | 0 | 0 | 0 |
| Paires avec deux tâches de rangement actives | 0 | 0 | 0 | 0 |

## Charge prolongée au plus gros palier

Même mélange de requêtes, maintenu 600,4 s après redémarrage de la base, sur 203 363 paires actives, 1 001 103 codes et 2 440 678 mouvements en ligne.

| Mesure | Valeur |
|---|---:|
| Sessions partenaires / postes | 50 / 2 |
| Requêtes | 794 726 (1 324 par seconde) |
| Erreurs | 0 |
| Toutes routes — p50 / **p95** / p99 / max | 1.82 / **23.0** / 37.2 / 299 |
| 5 premières secondes (à froid) — p95 | 23.1 |
| Écritures seules — p95 | 7.44 |
| Route la plus lente (p95) | station: overview : 129 |
| p95 < 1 s sur chaque route | oui |
| Interblocages | 0 |
| Paires créées pendant la mesure | 17 613 |
| Niveaux en dépassement de capacité | 0 |
| Écart compteurs occupation / réservation | 0 / 0 |
| Total avant + créées = total après | oui |

Mesure faite sur le poste de développement, dans le processus : elle valide le code et les index sous charge durable, pas le VPS ni le réseau de l'entrepôt.

## Taille des tables au palier 1M-codes

| Table | Lignes | Table (Mo) | Index (Mo) | Total (Mo) |
|---|---:|---:|---:|---:|
| `WarehouseUnit` | 1 003 003 | 525,6 | 716,4 | 1 242 |
| `WarehouseMovement` | 2 439 856 | 567,8 | 525,7 | 1 093,5 |
| `WarehouseLabelJournal` | 999 827 | 640,8 | 135,5 | 776,2 |
| `WarehouseMovementArchive` | 959 454 | 227,2 | 157,2 | 384,4 |
| `WarehouseLabelCode` | 1 000 000 | 135 | 156,2 | 291,2 |
| `WarehouseUnitPrice` | 75 522 | 19,1 | 17,1 | 36,1 |
| `WarehouseOperation` | 10 217 | 20,3 | 1,5 | 21,8 |
| `WarehouseLocation` | 26 534 | 12 | 8,3 | 20,2 |

Plan de la recherche d'un code à ce palier :

```
Index Scan using "WarehouseLabelCode_pkey" on "WarehouseLabelCode"  (cost=0.42..8.44 rows=1 width=51) (actual time=0.013..0.013 rows=1 loops=1)
  Index Cond: (code = '21ed8649-c4f1-47ef-b7a6-13ba91b6bdfa-SC01'::text)
  Buffers: shared read=4
Planning Time: 0.031 ms
Execution Time: 0.016 ms
```

## Exercice de restauration

| Étape | Résultat |
|---|---|
| Base au moment de la sauvegarde (T0) | 1 018 717 paires, 1 018 717 codes, 2 476 001 mouvements, 6 712 Mo |
| Journal d'émission exporté avant T0 | 23 686 lignes |
| Après T0 sur la base primaire | 25 paires reçues et étiquetées, 10 rangées, 10 anciennes paires déplacées ; 25 lignes ajoutées au journal |
| QR de référence après restauration (présente transférée 2026, sortie 2019, présente 2023, sortie archivée 2015) | même UUID : oui ; état identique à T0 : oui |
| QR collés après T0, scannés sur la base restaurée | 25 / 25 signalés inconnus ; paires créées par le scan : 0 |
| Reprise du journal — essai à blanc | 25 à restaurer, 23 686 déjà connus, 0 conflit ; rien écrit : oui |
| Reprise du journal — appliquée | 25 identités restaurées en 0.16 s |
| Mêmes QR rescannés | 25 / 25 retrouvent le même UUID ; 25 en « à vérifier, propriétaire inconnu, vente bloquée » ; vendables : 0 |
| Écarts de rapprochement ouverts | 25 |
| Seconde reprise du journal | 0 restaurée (idempotent) |
| Mouvements postérieurs à T0 | 10 / 10 déplacements et 10 rangements perdus (c'est la perte de la sauvegarde ordinaire) |
| Base restaurée | 7 triggers de garde présents ; 1 018 743 codes, tous distincts : oui ; nouvelle émission sans collision : oui |
| Durée mesurée ici | copie + démarrage 4.7 s (copie locale à la volée du système de fichiers, non représentative), reprise du journal 0.16 s |
