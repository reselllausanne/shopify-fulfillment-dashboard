# Travailler à plusieurs (Macs + agents Cursor)

Même repo GitHub, plusieurs sessions en parallèle. **GitHub est le bus** — pas le disque local, pas le VPS.

## Avant de coder (chaque session / chaque agent)

1. `git fetch origin`
2. Demander à l’utilisateur **quel sujet** (ou lire le chat) → **une branche feature** :
   - `/returns` échange client → `feat/returns-customer-exchange`
   - autre sujet → branche `feat/…` ou `fix/…` **déjà nommée dans le chat**, ou en créer une **nouvelle** depuis `origin/main`
3. `git switch <branche>` puis `git pull --ff-only` **seulement si** `git status` est clean (sinon `./scripts/safe-sync.sh` et suivre le message).
4. **Ne pas** `git switch` si des fichiers **hors sujet** sont modifiés — commit ou stash sur la bonne branche d’abord.

## Pendant le travail

- **Un sujet = une branche.** Ne pas mélanger returns + StockX + Galaxus sur la même branche.
- **Fichiers nouveaux** : `git add` + commit ; `git stash` sans `-u` **ne sauve pas** les untracked.
- **Ne pas** recréer une branche avec `git switch -C feat/… origin/main` sans accord explicite (efface des commits locaux non pushés).
- **Ne pas** toucher `/opt/resell` pour coder ; VPS = deploy seulement.

## Fin de session ou changement de sujet (obligatoire)

1. Commit sur **la branche du sujet** (message clair : `feat(returns): …`).
2. `git push -u origin HEAD` — **sans push, les autres Macs/agents ne voient rien.**
3. Si l’utilisateur veut la prod : PR → merge `main` → vérifier workflow **Deploy VPS** (voir `AGENTS.md`).

## Si deux agents sur le même sujet

- Même branche GitHub (ex. `feat/returns-customer-exchange`).
- Session B : `fetch` + `pull --ff-only` avant de coder.
- Conflit : résoudre, commit, push ; ne pas laisser du WIP non pushé overnight.

## Scripts

| Script | Rôle |
|--------|------|
| `./scripts/safe-sync.sh` | fetch ; pull ff-only si clean |
| `./scripts/safe-push.sh` | push si clean et pas behind |
| `./scripts/returns-exchange-guard.sh` | returns : bonne branche, pas de dirty oublié |

## Prod

- **VPS / prod** = SHA de **`main`** sur GitHub après merge.
- Branches feature = **pas** prod tant que non mergées.

## Message type pour l’utilisateur (copier en début de chat agent)

> Sujet : `[returns | stockx | galaxus | tracking | …]`  
> Branche : `feat/…`  
> Ne pas changer de branche ; commit + push avant de stopper.
