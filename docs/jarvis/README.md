# Jarvis — accès données Resell Lausanne

Point d'entrée pour Jarvis (et pour Cursor). Tout est lecture seule, à la demande.

- Carte des sources : `SOURCES.md`
- Décisions datées et sourcées : `memory/decisions.md` (recherche : `bin/jarvis decision <mot>`)
- Données vivantes : `bin/jarvis sql | shopify-orders | decathlon-ping | gads | gsc | vps`
- Achat Galaxus (s'arrête avant paiement par défaut) : `bin/galaxus-buy --help` ; tests : `python3 -m unittest discover -s docs/jarvis/tests`
- Reels/posts Instagram : `bin/insta-reel <url> [--text]` (lecture seule, sans login, JSON). Sujet : `bin/subject-research "<sujet>" [--dry-run]` (SerpApi web + shopping, fiche `inbox/sujets/<slug>.md` complétée à chaque run). Détails + prérequis ci-dessous.
- Audit qualité du contexte (agent Optimize séparé) : `optimize/` (`AGENT.md`, `registry.md`, `NIGHTLY.md`)

Règles : aucun secret dans ce dossier ni dans git. Aucun export de prod. Commandes, volumes, stock = toujours relus dans la source à jour, jamais copiés ici.
Mémoire : pas de Supermemory connecté sur cette machine. Mémoire = `memory/` dans le dépôt, partagée Jarvis + Cursor via GitHub.
Ajouter une décision : nouveau bloc `### D-xxx` (champs `topic, date, source, status, value`), puis `python3 optimize/audit.py`.

### galaxus-buy : prérequis réels (vérifié sur galaxus.ch le 2026-11-25)
- Galaxus renvoie 403 à urllib et ERR_HTTP2_PROTOCOL_ERROR à Patchright. **Camoufox + IP résidentielle = HTTP 200.** `galaxus_buy.py` appelle `jarvis_browser.py` (Camoufox) pour lire les pages ; lancer avec le Python du venv `~/Projects/jarvis-browser/.venv` (`JARVIS_BROWSER_DIR`).
- Vérifié en réel : `search`, `buy --dry-run`, `buy` (panier Zipro Catwalk 139 CHF, expédition sans frais, arrêt avant paiement).
- **Non vérifié** : `--confirm-pay` (nécessite un profil connecté avec moyen de paiement ; profil : `GALAXUS_PROFILE_DIR`, défaut `~/Projects/jarvis-browser/profiles/galaxus`).

### insta-reel et subject-research (lecture seule, sans lien avec StockX/GOAT)
- Dépendances : `bin/requirements-browser.txt` (venv hors dépôt + `python -m camoufox fetch`). Tests, `--dry-run`, `--from-html` : stdlib seule. Wrappers : `JARVIS_PYTHON=~/.venvs/jarvis-web/bin/python bin/insta-reel <url>`.
- `insta-reel` : un navigateur headless propre au script (Camoufox, ou `--engine patchright`), fermé en fin de run, jamais le Chrome du Mac. Images/vidéos/polices/CSS bloqués, plafond Mo par page (`--max-mb`, défaut 6 pour Instagram), 3 essais max, aucun retry sur 403/429. Pas de login, pas de cookie. Extrait légende, compte, hashtags, mentions, date, likes, musique, comptes taggés, alt-text auto, commentaires visibles, liens produit/marque. Pas de transcription audio ni d'analyse vidéo.
- `subject-research` : clé `SERPAPI_API_KEY` lue dans l'env seulement (jamais en argv, log ni fiche). Requêtes Google + Google Shopping (`--max-queries`, défaut 4, max 5), ouverture de quelques sources (`--max-pages`, défaut 3, max 8, HTTP puis navigateur si bloqué), fiche `inbox/sujets/<slug>.md` : Confirmé (>= 2 domaines indépendants ou source primaire Google) séparé de Incertain, chaque fait avec source + date, journal horodaté. Re-lancer le même sujet complète la fiche (dédoublonnage, promotion Incertain -> Confirmé). `--seed-url` ouvre des pages données sans clé SerpApi.
- Proxy résidentiel optionnel : `JARVIS_PROXY_URL` (env, jamais loggé). Journal des visites JSONL sans contenu : `JARVIS_WEB_LOG` (défaut `~/.local/share/jarvis-resell/web-visits.jsonl`).
