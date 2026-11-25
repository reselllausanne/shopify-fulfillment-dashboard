# Jarvis — accès données Resell Lausanne

Point d'entrée pour Jarvis (et pour Cursor). Tout est lecture seule, à la demande.

- Carte des sources : `SOURCES.md`
- Décisions datées et sourcées : `memory/decisions.md` (recherche : `bin/jarvis decision <mot>`)
- Données vivantes : `bin/jarvis sql | shopify-orders | decathlon-ping | gads | gsc | vps`
- Achat Galaxus (s'arrête avant paiement par défaut) : `bin/galaxus-buy --help` ; tests : `python3 -m unittest discover -s docs/jarvis/tests`
- Audit qualité du contexte (agent Optimize séparé) : `optimize/` (`AGENT.md`, `registry.md`, `NIGHTLY.md`)

Règles : aucun secret dans ce dossier ni dans git. Aucun export de prod. Commandes, volumes, stock = toujours relus dans la source à jour, jamais copiés ici.
Mémoire : pas de Supermemory connecté sur cette machine. Mémoire = `memory/` dans le dépôt, partagée Jarvis + Cursor via GitHub.
Ajouter une décision : nouveau bloc `### D-xxx` (champs `topic, date, source, status, value`), puis `python3 optimize/audit.py`.
