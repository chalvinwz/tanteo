# tanteo, as one container: the built client and the share API on one origin.
#
# There is no native addon anywhere in the tree. Storage is Node's built-in
# SQLite, which is the reason this image cross-builds for arm64 without QEMU
# compiling anything (see docs/decisions.md).

# syntax=docker/dockerfile:1

# --- build -------------------------------------------------------------------
# Pinned to the Node major that ships node:sqlite. The build stage runs on the
# builder's own architecture via BUILDPLATFORM, so a multi-arch build compiles
# TypeScript once instead of once per target under emulation.
FROM --platform=$BUILDPLATFORM node:24-alpine AS build
WORKDIR /app

RUN corepack enable

# Manifests first, so a source-only change does not re-resolve the whole tree.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages/engine/package.json packages/engine/
COPY packages/share/package.json packages/share/
COPY apps/web/package.json apps/web/
COPY apps/server/package.json apps/server/

RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

# Resolve the production dependency tree on its own, so the runtime layer never
# carries vite, vitest or the type packages.
RUN --mount=type=cache,target=/root/.local/share/pnpm/store \
    pnpm deploy --filter @tanteo/server --prod --legacy /runtime

# --- runtime -----------------------------------------------------------------
FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    PORT=8080 \
    TANTEO_DB=/data/tanteo.sqlite \
    TANTEO_WEB_ROOT=/app/public

# The server writes SQLite here. Declared as a volume so a container restart
# does not take the evening's tournaments with it.
RUN mkdir -p /data && chown -R node:node /data
VOLUME ["/data"]

COPY --from=build --chown=node:node /runtime/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/server/dist ./dist
COPY --from=build --chown=node:node /app/apps/web/dist ./public

USER node
EXPOSE 8080

# Plain node, no init shim: the server already handles SIGTERM and SIGINT and
# closes the database, so PID 1 doing the right thing is enough.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "dist/main.js"]
