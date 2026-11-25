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

### galaxus-buy : prérequis réels (vérifié sur galaxus.ch le 2026-11-25)
- Galaxus renvoie 403 à urllib et ERR_HTTP2_PROTOCOL_ERROR à Patchright. **Camoufox + IP résidentielle = HTTP 200.** `galaxus_buy.py` appelle `jarvis_browser.py` (Camoufox) pour lire les pages ; lancer avec le Python du venv `~/Projects/jarvis-browser/.venv` (`JARVIS_BROWSER_DIR`).
- Vérifié en réel : `search`, `buy --dry-run`, `buy` (panier Zipro Catwalk 139 CHF, expédition sans frais, arrêt avant paiement).
- **Non vérifié** : `--confirm-pay` (nécessite un profil connecté avec moyen de paiement ; profil : `GALAXUS_PROFILE_DIR`, défaut `~/Projects/jarvis-browser/profiles/galaxus`).
