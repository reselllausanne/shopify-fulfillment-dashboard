# Beatbot iSkim Ultra Monitor

## Manual run

```bash
npx tsx scripts/beatbot-monitor.ts --force
```

## Cron every 4 days (07:00)

```bash
0 7 */4 * * cd "/Users/theomanzinali/Code scrapping price " && npx tsx scripts/beatbot-monitor.ts >> galaxus/beatbot/beatbot_monitor.log 2>&1
```

## Output files

- `galaxus/beatbot/beatbot_watchlist.csv`
- `galaxus/beatbot/feed_update.csv`
- `galaxus/beatbot/beatbot_monitor_log.csv`
- `galaxus/beatbot/beatbot_monitor.sqlite`

## Alert env vars

- `BEATBOT_ALERT_SLACK_WEBHOOK_URL` (or `SLACK_WEBHOOK_URL`)
- `BEATBOT_ALERT_EMAIL_TO` + `POSTMARK_SERVER_TOKEN` + `POSTMARK_FROM_EMAIL`
