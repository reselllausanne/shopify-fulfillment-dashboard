# Optimize context check — nuit 03:00 Europe/Zurich

**Statut : NON ACTIVÉ.** Aucun canal privé confirmé (pas de Slack/Telegram/mail privé branché). Pas d'alerte envoyée dans le vide, pas de tâche créée.

Prêt à activer après choix du canal :

- Commande : `python3 docs/jarvis/optimize/audit.py --alert-file docs/jarvis/optimize/alerts.log` (puis envoi du contenu au canal choisi, seulement si le fichier a grossi).
- Planification Mac : `com.resell.optimize-context-check.plist` (même dossier). Installation (Terminal.app, une fois) :
  `cp docs/jarvis/optimize/com.resell.optimize-context-check.plist ~/Library/LaunchAgents/ && launchctl load ~/Library/LaunchAgents/com.resell.optimize-context-check.plist`
- Limite : un LaunchAgent ne tourne que si le Mac est allumé à 03:00 (sinon exécuté au réveil). Alternative : Cursor Automation ou GitHub Actions cron (UTC, pas de fuseau Zurich natif).
- Pause : `launchctl unload ~/Library/LaunchAgents/com.resell.optimize-context-check.plist`. Reprise : `launchctl load …`.
- Prochaine exécution une fois activé : prochain 03:00 Europe/Zurich.
