# Isolated SAV agent. Secrets in this container: CURSOR_API_KEY, SAV_DATABASE_URL (read-only role),
# IMAP creds, ntfy topic. NOT the main .env (no Shopify admin token, no StockX tokens).
FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ripgrep git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY sav-agent/package.json ./
RUN npm install --omit=dev
COPY sav-agent/ ./
# Business rules (no prod data): decisions + source map.
COPY docs/jarvis/memory/decisions.md /app/workspace/DECISIONS.md
COPY docs/jarvis/SOURCES.md /app/workspace/SOURCES.md
RUN chmod +x /app/bin/* && mkdir -p /data
ENV PATH="/app/bin:${PATH}" TZ=Europe/Zurich
CMD ["node", "server.mjs"]
