# Jarvis — accès données Resell Lausanne

Point d'entrée pour Jarvis (et pour Cursor). Tout est lecture seule, à la demande.

- Carte des sources : `SOURCES.md`
- Décisions datées et sourcées : `memory/decisions.md` (recherche : `bin/jarvis decision <mot>`)
- Données vivantes : `bin/jarvis sql | shopify-orders | decathlon-ping | gads | gsc | vps`
- Achat Galaxus (s'arrête avant paiement par défaut) : `bin/galaxus-buy --help` ; tests : `python3 -m unittest discover -s docs/jarvis/tests`
- Reels/posts Instagram : `bin/insta-reel <url> [--text]` (lecture seule, sans login, JSON). Sujet : `bin/subject-research "<sujet>" [--dry-run]` (SerpApi web + shopping, fiche `inbox/sujets/<slug>.md` complétée à chaque run). Détails + prérequis ci-dessous.
- Compte Instagram entier : `bin/insta-account <handle> [--limit N]` (lecture seule, sans login) -> `inbox/sujets/<handle>/<id>.json` + `resume-compte.md` (stratégie par règles). Section « insta-account ».
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

### insta-account (lecture seule, sans login, sans LLM)
- `bin/insta-account <handle> [--limit N] [--no-visual] [--refresh-visual] [--dry-run] [--urls-file F | --seed-urls U ...]`. Handle validé (regex Instagram, ni `/`, `?`, `..`) avant toute URL.
- Liste des posts : le profil `instagram.com/<handle>/` et `/reels/` redirigent vers le login depuis une IP datacenter (non contourné). Voie publique utilisée : l'embed `instagram.com/<handle>/embed/` rendu par le navigateur du script ; il n'expose que quelques posts récents (6 sur le compte testé, `--limit` ne peut pas dépasser) plus abonnés et nombre de posts. S'il est vide/bloqué : `--urls-file` / `--seed-urls` (liste d'URL fournie).
- Par post : `insta_reel` (légende, date, likes, commentaires, collaborateurs, alt-text auto) puis couche visuelle best-effort, toujours marquée incertaine : média public CDN plafonné (`--max-video-mb`), frames `ffmpeg` (local), OCR `tesseract` (confiance >= 70). Transcript audio : indisponible (aucun modèle ASR local). Description d'image par modèle : jamais appelée ; si `OPENAI_API_KEY`/`ANTHROPIC_API_KEY`/`GEMINI_API_KEY`/`GOOGLE_API_KEY` existe, simple mention `key_present_not_used` (décision : quel modèle/budget).
- `resume-compte.md` : stratégie en bref (angle, pitch, CTA, fréquence, offre, engagement), Confirmé / Incertain avec URL + date de chaque post, posts, limites, journal cumulatif. Règles : CTA par regex (commente « MOT », DM, lien en bio, URL, follow, aimant à prospects, appel), comptage de mots-clés, structure de légende, écart médian entre posts. Re-lancer fusionne par id de post (pas de doublon ; l'historique likes/commentaires s'allonge).
- Plafonds : page `JARVIS_MAX_PAGE_MB` (6), total `--max-total-mb` (60, pages + médias), 3 essais par page, aucun retry sur login wall / 401 / 403 / 429, arrêt après 2 posts bloqués d'affilée, un seul navigateur fermé en fin de run. Proxy optionnel `JARVIS_PROXY_URL` (non nécessaire sur les tests).
- Prérequis système optionnels : `ffmpeg`, `tesseract-ocr` (+ `tesseract-ocr-fra`) ; sans eux le visuel est `skipped`/`partial`.
