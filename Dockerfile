FROM node:20-bookworm-slim

ENV NEXT_TELEMETRY_DISABLED=1

WORKDIR /app

COPY package*.json ./
COPY prisma ./prisma

# Install runtime deps for Playwright + remote desktop (noVNC)
RUN apt-get update && apt-get install -y xvfb fluxbox x11vnc novnc websockify && rm -rf /var/lib/apt/lists/*

# Install dev deps for build (Tailwind/PostCSS live in devDependencies)
RUN npm install --include=dev
RUN npx playwright install --with-deps

COPY . .

RUN npm run build

ENV NODE_ENV=production

EXPOSE 3000 6080

COPY docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh

ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD []
