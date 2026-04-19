# syntax=docker/dockerfile:1
# Faster rebuilds: DOCKER_BUILDKIT=1 docker compose build
# Cache mounts reuse apt/npm/playwright downloads across builds (even when layers rerun).
FROM node:20-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Install runtime deps for Playwright + remote desktop (noVNC)
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
    && apt-get install -y --no-install-recommends \
        xvfb fluxbox x11vnc novnc websockify \
    && rm -rf /var/lib/apt/lists/*

# Install dev deps for build (Tailwind/PostCSS live in devDependencies)
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm install --include=dev

# Only browsers you use (saves vs full install). Add webkit if needed.
RUN --mount=type=cache,target=/root/.cache/ms-playwright,sharing=locked \
    npx playwright install --with-deps chromium firefox

COPY . .

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000 6080

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
