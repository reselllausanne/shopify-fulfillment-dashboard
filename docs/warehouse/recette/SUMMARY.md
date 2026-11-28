# Mesures de recette — synthèse générée

Généré par `scripts/warehouse/recette-summary.mjs` à partir des fichiers JSON de ce dossier. Mesures du 2026-11-28.
Environnement : darwin/arm64, Node v22.18.0, grappe locale isolée, données synthétiques, 20 connexions. **Ce n'est pas le VPS.**
Latences en millisecondes. Les routes sont appelées dans le processus (session, routage, service, base, JSON) : ni réseau, ni TLS, ni proxy.

## Jeu de données

| Palier | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Paires actives | 10 000 | 100 000 | 200 000 | 202 239 |
| Paires au total (actives + sorties) | 10 000 | 100 000 | 200 000 | 1 000 000 |
| Codes d'étiquette au registre | 10 000 | 100 000 | 200 000 | 1 000 000 |
| Mouvements en ligne | 20 000 | 200 093 | 1 000 000 | 2 438 265 |
| Mouvements archivés | 0 | 0 | 0 | 959 589 |
| Sites | SC01 7 000<br>SD01 3 000 | SC01 55 000<br>SC02 25 000<br>SD01 20 000 | SC01 110 000<br>SC02 50 000<br>SD01 40 000 | SC01 112 239<br>SC02 50 000<br>SD01 40 000 |
| Niveaux de rack | 1 200 | 11 000 | 21 900 | 21 900 |
| Déposants | 60 | 60 | 60 | 60 |
| Variantes | 6 000 | 6 000 | 6 000 | 6 000 |
| Plus gros déposant (paires) | 1 341 | 13 571 | 27 167 | 27 269 |
| Déposant médian (paires) | 98 | 955 | 1 901 | 1 901 |
| Part de la variante la plus fréquente | 5.5 % | 5.5 % | 5.5 % | 5.5 % |
| Génération du palier (s) | 1.3 | 12.4 | 27.8 | 116.2 |
| Taille tables + index du module (Mo) | 54 | 385 | 1 057 | 3 814 |

## Lectures, une par une — p50 / p95 (premier appel après redémarrage de la base)

| Requête | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| scan: pair QR → unit (registry) | 0.25 / 0.40 (1.28) | 0.25 / 0.37 (1.51) | 0.26 / 0.40 (1.47) | 0.26 / 0.40 (1.59) |
| scan: QR of a pair gone / archived | — | — | — | 0.19 / 0.21 (0.20) |
| scan: well-formed code never issued | 0.14 / 0.18 (0.57) | 0.14 / 0.17 (0.54) | 0.14 / 0.16 (0.56) | 0.14 / 0.17 (0.61) |
| scan: level code → location | 0.09 / 0.14 (0.68) | 0.08 / 0.13 (0.66) | 0.09 / 0.14 (0.70) | 0.08 / 0.13 (0.73) |
| scan: GTIN → variant | 0.23 / 0.31 (1.69) | 0.22 / 0.28 (1.49) | 0.21 / 0.27 (1.62) | 0.21 / 0.30 (1.57) |
| unit detail (state + history) | 0.45 / 1.72 (19.9) | 0.44 / 1.75 (19.8) | 0.47 / 1.59 (19.8) | 0.48 / 1.62 (16.1) |
| stock list: site, page 1 (50) | 0.76 / 0.92 (1.48) | 0.77 / 1.11 (1.62) | 0.79 / 1.04 (1.63) | 0.79 / 0.97 (1.59) |
| stock list: keyset pages 1→40 | 0.82 / 1.13 | 0.88 / 1.17 | 0.84 / 1.28 | 0.84 / 1.33 |
| stock list: one owner on one site | 0.47 / 0.82 (0.93) | 0.74 / 0.90 (0.91) | 0.81 / 0.99 (0.99) | 0.87 / 1.10 (1.02) |
| stock list: sellable + quality passed | 0.77 / 0.98 (1.10) | 0.97 / 1.30 (1.30) | 1.11 / 1.43 (1.76) | 1.32 / 1.81 (2.00) |
| stock list: missing pairs | 1.29 / 1.58 (1.01) | 2.94 / 3.32 (3.99) | 4.13 / 4.55 (6.05) | 2.64 / 3.21 (5.31) |
| stock list: one level | 0.18 / 0.23 (0.72) | 0.19 / 0.41 (0.73) | 0.23 / 0.44 (0.80) | 0.22 / 0.47 (0.79) |
| stock search: style code (text) | 3.80 / 4.10 (1.49) | 1.59 / 25.0 (1.88) | 1.89 / 31.6 (2.28) | 4.06 / 30.8 (5.75) |
| stock search: GTIN | 0.12 / 1.08 (1.54) | 0.13 / 1.21 (1.91) | 0.14 / 1.30 (1.80) | 0.38 / 2.66 (3.26) |
| stock search: short ref (ABCD-1234) | 0.30 / 0.39 (0.72) | 0.40 / 0.48 (0.88) | 0.42 / 0.51 (0.90) | 1.36 / 2.18 (3.44) |
| stock by variant: site, page 1 | 5.77 / 6.33 (6.29) | 27.3 / 29.1 (27.6) | 51.2 / 68.8 (50.0) | 65.5 / 95.4 (94.3) |
| overview: site dashboard | 2.24 / 2.75 (3.76) | 11.1 / 12.4 (12.6) | 16.4 / 18.7 (18.7) | 34.4 / 40.5 (35.9) |
| reconciliation: site × owner × state | 4.93 / 5.78 (5.78) | 45.8 / 64.5 (53.5) | 33.3 / 34.6 (34.6) | 330 / 374 (355) |
| putaway queue: site | 0.91 / 2.61 (3.61) | 4.44 / 9.06 (10.8) | 7.73 / 17.7 (17.7) | 9.29 / 12.4 (16.6) |
| locations: site structure | 0.78 / 1.27 (1.27) | 4.19 / 5.06 (5.06) | 8.48 / 9.52 (9.52) | 9.21 / 10.3 (10.3) |
| partner biggest: summary | 1.91 / 2.24 (3.21) | 20.3 / 23.2 (23.6) | 41.5 / 49.3 (39.0) | 58.8 / 64.7 (64.5) |
| partner biggest: list page 1 | 0.33 / 0.55 (1.13) | 0.55 / 0.74 (1.40) | 0.55 / 0.75 (1.38) | 0.63 / 1.04 (1.52) |
| partner biggest: by variant | 1.82 / 2.22 (2.72) | 14.2 / 15.2 (11.0) | 17.9 / 19.1 (16.9) | 21.4 / 25.6 (19.7) |
| partner biggest: search style | 0.86 / 1.21 (1.30) | 8.60 / 14.7 (1.74) | 17.3 / 21.5 (2.08) | 20.9 / 23.4 (5.05) |
| partner median: summary | 0.79 / 0.85 (1.00) | 4.26 / 4.47 (4.94) | 8.07 / 9.98 (11.1) | 16.9 / 19.3 (19.3) |
| partner median: list page 1 | 0.32 / 0.36 (0.43) | 0.55 / 0.68 (0.92) | 0.57 / 0.68 (0.87) | 0.57 / 0.72 (0.87) |
| partner median: by variant | 1.06 / 1.13 (1.13) | 4.31 / 4.54 (4.70) | 3.00 / 3.21 (3.12) | 3.07 / 3.69 (3.74) |
| partner median: search style | 0.80 / 0.88 (0.92) | 1.13 / 1.27 (1.43) | 1.65 / 1.90 (2.06) | 1.79 / 2.71 (1.95) |

## Gestes, un par un — p50 / p95

| Geste | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| receive one pair (new UUID + label job + task) | 2.19 / 2.82 | 2.24 / 2.84 | 2.63 / 6.58 | 2.24 / 3.43 |
| replay of the same gesture key | 0.30 / 0.38 | 0.31 / 0.43 | 0.30 / 0.41 | 0.30 / 0.34 |
| propose destinations for 100 pairs | 70.9 / 70.9 | 104 / 104 | 157 / 157 | 169 / 169 |
| confirm putaway (scan pair + level) | 1.58 / 1.94 | 1.65 / 2.05 | 1.62 / 2.04 | 1.65 / 2.33 |
| relocate a pair to another level | 1.42 / 1.76 | 1.37 / 1.78 | 1.43 / 1.75 | 1.44 / 1.88 |
| quality check passed | 0.88 / 1.14 | 0.98 / 1.38 | 0.96 / 1.35 | 0.95 / 1.17 |

## Charge mixte — sessions partenaires et postes en parallèle

| Mesure | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Sessions partenaires / postes | 50 / 2 | 50 / 2 | 50 / 2 | 50 / 2 |
| Durée (s) | 30.4 | 30.4 | 60.4 | 30.4 |
| Requêtes | 45 800 | 43 482 | 84 332 | 40 941 |
| Requêtes par seconde | 1 508 | 1 432 | 1 397 | 1 346 |
| Erreurs | 0 | 0 | 0 | 0 |
| Toutes routes — p50 | 1.00 | 1.44 | 1.73 | 1.81 |
| Toutes routes — **p95** | **2.86** | **7.02** | **13.2** | **21.7** |
| Toutes routes — p99 | 4.40 | 11.9 | 21.8 | 33.6 |
| Toutes routes — max | 54.6 | 52.8 | 60.5 | 87.2 |
| 5 premières secondes (à froid) — p95 | 3.07 | 7.60 | 13.3 | 21.6 |
| Écritures seules — p95 | 4.96 | 6.51 | 7.73 | 7.80 |
| Route la plus lente (p95) | station: receive pair : 6.21 | station: overview : 15.8 | partner: home summary : 23.8 | station: overview : 41.2 |
| p95 < 1 s sur chaque route | oui | oui | oui | oui |
| Interblocages | 0 | 0 | 0 | 0 |
| Transactions validées / annulées | 129 737 / 17 | 127 829 / 24 | 255 477 / 24 | 129 263 / 24 |
| Blocs lus sur disque / en cache | 648 / 11 308 326 | 7 958 / 53 797 719 | 25 505 / 183 893 318 | 30 263 / 109 188 947 |
| CPU du processus applicatif (s) | 23.5 | 26.2 | 57.1 | 30.4 |

### Par route — p95 (p99)

| Route | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| partner: home summary | 2.64 (3.81) | 11.9 (22.9) | 23.8 (44.2) | 36.8 (62.3) |
| partner: my stock next page | 1.40 (2.22) | 2.00 (3.04) | 2.37 (3.44) | 2.39 (3.09) |
| partner: my stock page | 1.42 (2.27) | 1.98 (3.31) | 2.32 (3.43) | 2.34 (3.13) |
| partner: pair detail | 1.50 (2.48) | 1.79 (3.66) | 2.09 (3.62) | 2.07 (2.97) |
| partner: requests | 0.87 (1.43) | 1.12 (2.13) | 1.29 (2.25) | 1.31 (2.12) |
| partner: search | 1.96 (2.68) | 4.42 (10.8) | 8.10 (21.5) | 8.95 (23.0) |
| partner: stock by variant | 2.59 (3.45) | 7.38 (12.7) | 11.2 (20.3) | 12.0 (22.7) |
| station: confirm putaway | 4.57 (6.08) | 5.39 (7.34) | 6.17 (9.28) | 6.24 (9.18) |
| station: overview | 4.44 (7.73) | 15.8 (17.6) | 21.7 (23.6) | 41.2 (42.1) |
| station: propose destination | 3.73 (5.04) | 7.10 (8.80) | 12.6 (15.5) | 12.8 (15.8) |
| station: putaway queue of the batch | 1.34 (1.98) | 2.16 (2.93) | 2.25 (3.01) | 2.40 (3.31) |
| station: receive pair | 6.21 (8.99) | 6.80 (11.6) | 7.86 (13.7) | 8.13 (10.3) |
| station: scan GTIN | 1.19 (1.77) | 1.45 (2.48) | 1.59 (3.00) | 1.73 (2.77) |
| station: scan new QR | 0.98 (1.65) | 1.16 (1.96) | 1.40 (2.11) | 1.33 (1.84) |
| station: scan old QR | 0.86 (1.31) | 1.08 (1.56) | 1.24 (1.94) | 1.31 (1.90) |
| station: stock list | 2.11 (2.31) | 2.18 (2.63) | 2.55 (3.56) | 3.12 (4.13) |

## Registre des codes et intégrité après la charge

| Contrôle | 10k | 100k | 200k | 1M-codes |
|---|---:|---:|---:|---:|
| Recherche d'un code par l'index unique (plan) | oui | oui | oui | oui |
| Historique d'une paire par index | oui | oui | oui | oui |
| Liste partenaire sans parcours séquentiel | oui | oui | oui | oui |
| Scans en parallèle (64 fils) par seconde | 22 491 | 20 310 | 21 889 | 21 015 |
| … p95 / p99 | 3.49 / 4.51 | 4.12 / 5.13 | 3.54 / 4.70 | 3.93 / 4.62 |
| … chaque code rend son propre UUID | oui | oui | oui | oui |
| Codes distincts = codes | oui (11 329) | oui (101 289) | oui (202 238) | oui (1 001 193) |
| Doublon de code refusé par la base | oui | oui | oui | oui |
| Réattribution d'un code refusée par la base | oui | oui | oui | oui |
| Nouveau code émis après le palier, scanné → son UUID | oui | oui | oui | oui |
| Dernière place à deux postes : un seul gagnant | 25 / 25 | 25 / 25 | 25 / 25 | 25 / 25 |
| Niveaux en dépassement de capacité | 0 | 0 | 0 | 0 |
| Paires créées pendant la mesure | 1 329 | 1 289 | 2 238 | 1 193 |
| Total avant + créées = total après | oui | oui | oui | oui |
| Paires sans ligne de registre / de journal | 0 / 0 | 0 / 0 | 0 / 0 | 0 / 0 |
| Écart compteur d'occupation / réalité | 0 | 0 | 0 | 0 |
| Écart compteur de réservation / réalité | 0 | 0 | 0 | 0 |
| Paires avec deux tâches de rangement actives | 0 | 0 | 0 | 0 |

## Taille des tables au palier 1M-codes

| Table | Lignes | Table (Mo) | Index (Mo) | Total (Mo) |
|---|---:|---:|---:|---:|
| `WarehouseUnit` | 1 000 114 | 476,6 | 700 | 1 176,6 |
| `WarehouseMovement` | 2 437 476 | 567,9 | 524,4 | 1 092,2 |
| `WarehouseLabelJournal` | 999 895 | 640,9 | 133,4 | 774,3 |
| `WarehouseMovementArchive` | 959 589 | 227,3 | 157,3 | 384,6 |
| `WarehouseLabelCode` | 1 000 000 | 135 | 156,7 | 291,7 |
| `WarehouseUnitPrice` | 76 094 | 19,2 | 17,2 | 36,4 |
| `WarehouseOperation` | 9 997 | 20,2 | 1,5 | 21,7 |
| `WarehouseLocation` | 26 534 | 11,9 | 8,4 | 20,3 |

Plan de la recherche d'un code à ce palier :

```
Index Scan using "WarehouseLabelCode_pkey" on "WarehouseLabelCode"  (cost=0.42..8.44 rows=1 width=51) (actual time=0.019..0.019 rows=1 loops=1)
  Index Cond: (code = 'c26492e4-c41d-455f-841a-c2a234ae5787-SC01'::text)
  Buffers: shared read=4
Planning Time: 0.031 ms
Execution Time: 0.021 ms
```

## Exercice de restauration

| Étape | Résultat |
|---|---|
| Base au moment de la sauvegarde (T0) | 1 001 194 paires, 1 001 194 codes, 2 440 748 mouvements, 7 826 Mo |
| Journal d'émission exporté avant T0 | 6 053 lignes |
| Après T0 sur la base primaire | 25 paires reçues et étiquetées, 10 rangées, 10 anciennes paires déplacées ; 25 lignes ajoutées au journal |
| QR de référence après restauration (présente transférée 2026, présente 2023, sortie 2019, sortie archivée 2015) | même UUID : oui ; état identique à T0 : oui |
| QR collés après T0, scannés sur la base restaurée | 25 / 25 signalés inconnus ; paires créées par le scan : 0 |
| Reprise du journal — essai à blanc | 25 à restaurer, 6 053 déjà connus, 0 conflit ; rien écrit : oui |
| Reprise du journal — appliquée | 25 identités restaurées en 0.1 s |
| Mêmes QR rescannés | 25 / 25 retrouvent le même UUID ; 25 en « à vérifier, propriétaire inconnu, vente bloquée » ; vendables : 0 |
| Écarts de rapprochement ouverts | 25 |
| Seconde reprise du journal | 0 restaurée (idempotent) |
| Mouvements postérieurs à T0 | 10 / 10 déplacements et 10 rangements perdus (c'est la perte de la sauvegarde ordinaire) |
| Base restaurée | 7 triggers de garde présents ; 1 001 220 codes, tous distincts : oui ; nouvelle émission sans collision : oui |
| Durée mesurée ici | copie + démarrage 5.3 s (copie locale à la volée du système de fichiers, non représentative), reprise du journal 0.1 s |
