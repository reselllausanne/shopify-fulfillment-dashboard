# Agent Optimize — qualité du contexte Resell Lausanne

Agent séparé de Jarvis. Rôle : auditer le contexte (docs, règles, décisions, carte des sources). Pas d'exécution métier.

## Périmètre

- Lit seulement les fichiers listés dans `sources.txt`. Pas de DB, pas d'API, pas de secrets, pas d'accès VPS.
- Écrit seulement `registry.json` et `registry.md` (dans ce dossier).
- Aucune correction automatique. Aucune maintenance ni mise à jour de logiciels. Propose, Théo décide.

## Détecte

| Type | Règle |
|---|---|
| `contradiction` | 2 décisions `active` même `topic`, `value` différente |
| `broken_ref` | chemin de fichier ou lien relatif cité qui n'existe pas |
| `missing_provenance` | décision sans date ou source |
| `source_missing` | fichier listé dans `sources.txt` absent |

Les « règles qui divergent » entre docs et code : manuel pour l'instant (voir sujets ouverts).

## Alertes

- Seulement NOUVEAU, CHANGÉ, RÉSOLU (une fois). Problème connu inchangé = silence.
- Dédoublonnage par empreinte `kind|key|message` dans `registry.json`.
- Canal : aucun canal privé confirmé. Sortie → `alerts.log` local. Voir `NIGHTLY.md`.

## Lancer

```bash
python3 docs/jarvis/optimize/audit.py --alert-file docs/jarvis/optimize/alerts.log
python3 docs/jarvis/optimize/test_audit.py   # tests isolés (détection, silence, dédoublonnage, résolution)
```

## Sujets ouverts (humains, hors détection auto)

- O-A : `D-001` (perte max 5 %, 2026-11-04) vs `D-002` (perte max 10 %, commit #477, 2026-11-18). Théo confirme la règle courante.
- O-B : `AGENTS.md` cite 3 fichiers absents de `main` (`.cursor/environment.json`, `.cursor/CLOUD_AGENT_SETUP.md`, `.cursor/rules/returns-customer-exchange.mdc`). Ajouter les fichiers ou retirer les mentions.
- O-C : règle `galaxus-supplier-price.mdc` (D-005) existe seulement en fichier non suivi sur le Mac. À commiter sur une branche dédiée.
- O-D : dépôt principal public sur GitHub alors que Théo le pense privé. Il contient des noms de tables, de fournisseurs, des règles de prix. Vérifier qu'aucun secret n'y est (aucun scan fait ici).
- O-E : `.env` du Mac contient une ligne dont le NOM de variable ressemble à un jeton Shopify (`shpat_…`). Format cassé ou jeton collé par erreur. À nettoyer par Théo. Considérer le jeton comme exposé : le régénérer si besoin.
- O-F : mémoire locale Mac vs docs : `docs/health-data-integrations.md` et tables `health_*` : données personnelles, exclues de Jarvis.
