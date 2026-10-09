FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim AS runtime
ENV NODE_ENV=production PORT=3001 DATABASE_PATH=/app/data/orqiva.db SEED_DEMO=false
WORKDIR /app
COPY --from=builder --chown=node:node /app/package*.json ./
COPY --from=builder --chown=node:node /app/node_modules ./node_modules
COPY --from=builder --chown=node:node /app/dist ./dist
COPY --from=builder --chown=node:node /app/server ./server
COPY --from=builder --chown=node:node /app/src/types.ts ./src/types.ts
COPY --from=builder --chown=node:node /app/database ./database
COPY --chown=node:node docker/entrypoint.sh ./docker/entrypoint.sh
RUN mkdir -p /app/data /app/backups && chown -R node:node /app/data /app/backups && chmod +x /app/docker/entrypoint.sh
USER node
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 CMD node -e "fetch('http://127.0.0.1:3001/api/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
ENTRYPOINT ["/app/docker/entrypoint.sh"]
