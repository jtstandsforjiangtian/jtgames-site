FROM node:22.20.0-bookworm-slim AS build
WORKDIR /src
RUN corepack enable && corepack prepare pnpm@11.25.0 --activate
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
RUN pnpm install --frozen-lockfile
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 2 GB 服务器构建时把 Node 堆限制在 1 GB，其余交给已有的交换空间。
RUN NODE_OPTIONS=--max-old-space-size=1024 pnpm build

FROM node:22.20.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
ENV JUKEBOX_DB_PATH=/data/jukebox.sqlite
ENV NODE_OPTIONS=--disable-warning=ExperimentalWarning
RUN groupadd --system --gid 1001 nodejs && useradd --system --uid 1001 --gid 1001 --home /app nextjs \
  && mkdir -p /data /backups /app/scripts \
  && chown nextjs:nodejs /data /backups
COPY --from=build --chown=nextjs:nodejs /src/public ./public
COPY --from=build --chown=nextjs:nodejs /src/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /src/.next/static ./.next/static
COPY --chown=nextjs:nodejs scripts/sqlite-backup.mjs ./scripts/sqlite-backup.mjs
USER nextjs
EXPOSE 3000
CMD ["node", "server.js"]
