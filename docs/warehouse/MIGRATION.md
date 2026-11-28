# Migration `20261128040000_warehouse_lot1`

**Non appliquée en production.** Ce document prépare son application ; la décision et le moment restent à l'équipe.

## Ce qu'elle fait

- Crée 32 tables `Warehouse*`, leurs index, leurs contraintes `CHECK`, 9 index uniques partiels et 7 triggers de garde.
- Ajoute 4 clés étrangères vers `Partner(id)` (déposant d'une paire, d'un lot, d'une convention, d'une demande).
- Active RLS, sans politique, sur les 32 tables.

Elle ne modifie, ne renomme et ne supprime **aucune** table, colonne, index, fonction ou trigger existant. Aucun trigger n'est posé sur une table existante.

## Verrous

| Instruction | Verrou | Sur quoi | Durée |
|---|---|---|---|
| `CREATE TABLE`, `CREATE INDEX`, `ALTER TABLE … ADD CONSTRAINT … CHECK` | `ACCESS EXCLUSIVE` | Tables nouvelles, vides, inconnues du code en service | Sans effet sur l'existant |
| `ADD CONSTRAINT … REFERENCES "Partner"` (×4) | `SHARE ROW EXCLUSIVE` | `Partner` | Le temps de l'instruction. La table référençante est vide : aucune validation de lignes. Bloque les **écritures** sur `Partner` quelques millisecondes, jamais les lectures. |
| `CREATE FUNCTION`, `CREATE TRIGGER` | — | Tables nouvelles | — |
| `ENABLE ROW LEVEL SECURITY` | `ACCESS EXCLUSIVE` | Tables nouvelles | — |

Durée mesurée sur une base locale à l'image du schéma de production : **0,6 s** pour `prisma migrate deploy` (migration seule).

Risque de blocage : si une transaction longue tient un verrou sur `Partner` au moment des clés étrangères, la migration attend, et les écritures suivantes sur `Partner` attendent derrière elle. `Partner` est écrit rarement (profil partenaire) ; appliquer hors d'un import partenaire en cours suffit. Par prudence, poser `SET lock_timeout = '5s'` dans la session de migration : en cas d'attente, elle échoue proprement et se relance.

## Compatibilité avec le code en service

- L'ancienne version de l'application ignore ces tables : la migration peut être appliquée **avant** le déploiement du code.
- Le nouveau code, module désactivé (`WAREHOUSE_MODULE_ENABLED` absent), ne lit ni n'écrit ces tables : il peut être déployé **avant** la migration.
- Le script de déploiement applique `prisma migrate deploy` : fusionner la PR applique donc la migration. C'est le moment où la décision se prend.

## Liste de contrôle avant application en production

1. **Sauvegarde** récente vérifiée (point de restauration Supabase) et procédure de retour connue.
2. **Rôle de connexion** : l'application doit être propriétaire des tables qu'elle crée, ou avoir `BYPASSRLS`. Sinon RLS sans politique lui cache ses propres lignes.
   `SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = current_user;` — et, après migration : `SELECT tableowner FROM pg_tables WHERE tablename = 'WarehouseUnit';` doit être le rôle de `DATABASE_URL`.
3. **Fuseau de session** : `SHOW timezone;` doit répondre `UTC`. Les colonnes sont des `timestamp(3)` sans fuseau, comme le reste du schéma ; le module compare des dates posées par l'application (UTC) et par `now()`.
4. **Extensions** : aucune requise (`gen_random_uuid()` n'est utilisé que par les scripts de recette).
5. **Fenêtre** : hors import partenaire et, comme pour tout déploiement, hors génération du flux Galaxus (le déploiement recrée les workers).
6. **Variables** : `WAREHOUSE_MODULE_ENABLED` reste absent au premier déploiement. La migration et le code arrivent ; rien ne s'affiche.
7. **Journal d'émission** : choisir et monter la cible hors disque primaire (`WAREHOUSE_LABEL_JOURNAL_DIR`) avant d'imprimer en série ; voir `RECETTE.md` §5.
8. **Accès partenaire** : définir `PARTNER_ACCESS_<KEY>` pour chaque partenaire du pilote (constat R2 de `AUDIT.md`).

## Activation progressive

| Étape | Réglage | Effet |
|---|---|---|
| 0 | (rien) | Module invisible. Routes `/api/warehouse/**` → 404 `MODULE_DISABLED`. Portail partenaire : sections de stock masquées. |
| 1 | `WAREHOUSE_MODULE_ENABLED=true`, `WAREHOUSE_WRITES_ENABLED=false` | Écrans visibles en lecture pour l'équipe ; aucun geste accepté. |
| 2 | `WAREHOUSE_WRITES_ENABLED=true`, `WAREHOUSE_PILOT_SITES=CH01`, `WAREHOUSE_PARTNER_ALLOWLIST=` *(vide = aucun partenaire)* | L'équipe crée le site, les racks, les postes ; reprise des paires. Aucun partenaire ne voit encore de stock. |
| 3 | `WAREHOUSE_PARTNER_ALLOWLIST=TONY` | Le portail de Tony affiche son stock. |
| 4 | `WAREHOUSE_LABEL_JOURNAL_ENFORCE=true` | L'émission d'une étiquette est refusée si le journal hors disque n'est pas à jour. |

## Arrêt et retour arrière

| Besoin | Geste | Conséquence |
|---|---|---|
| Geler les écritures | `WAREHOUSE_WRITES_ENABLED=false` | Tous les gestes répondent 503 `WRITES_DISABLED`. Lectures, scans et portail partenaire continuent. Les QR collés restent résolus. |
| Masquer le module | `WAREHOUSE_MODULE_ENABLED=false` | Écrans et routes disparaissent (404). Données intactes. |
| Revenir au code précédent | Redéployer la version précédente | Les tables restent ; l'ancien code les ignore. |
| Supprimer les tables | **À ne pas faire dès qu'une étiquette a été collée** | Les identités émises seraient perdues. Tant que rien n'est imprimé (étape 1), un `DROP` des 32 tables et des 6 fonctions `warehouse_*` remet la base dans l'état initial ; les triggers `no_truncate` et `identity_guard` l'interdisent par simple `TRUNCATE` / `DELETE`. |

Après émission de QR, le retour arrière est toujours « arrêter les écritures et corriger en avant » (cas C27) : aucune restauration qui ferait disparaître des identités sans passer par la reprise du journal (`journal/reconcile`).

## Vérifications après application

```sql
SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE 'Warehouse%';   -- 32 (+ WarehouseScanMiss existant = 33)
SELECT count(*) FROM pg_trigger WHERE tgname LIKE 'trg_warehouse_%' AND NOT tgisinternal;                        -- 7
SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
 WHERE n.nspname = 'public' AND relname LIKE 'Warehouse%' AND relkind = 'r' AND NOT relrowsecurity;              -- WarehouseScanMiss seulement (table existante)
```

Puis `GET /api/warehouse/config` avec une session équipe : 404 tant que le module est désactivé, 200 ensuite.
