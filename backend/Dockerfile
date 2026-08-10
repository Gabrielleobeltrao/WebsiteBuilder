# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: sharp ships prebuilt binaries for glibc, and on musl it either
# compiles libvips from source at install time or fails. The image is larger; the build is
# predictable, which matters more.
FROM node:22-slim AS build
WORKDIR /app

# Manifests first so dependency installation is cached until they actually change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# The frontend workspace is not needed to build the API, but npm resolves the whole workspace tree
# from the root lockfile, so its manifest must be present.
RUN npm ci --workspace @websitebuilder/backend --workspace @websitebuilder/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY backend backend

RUN npm run build --workspace @websitebuilder/backend

# ---

FROM node:22-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

# Only production dependencies reach the runtime image. tsup bundled the workspace source, so
# @websitebuilder/shared is already inlined and is not installed here.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace @websitebuilder/backend --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist

# Never run as root. A process that only needs to read its own bundle has no reason to.
USER node

# Both processes live in this image; Coolify runs one container per command.
# API:      node backend/dist/server.js
# Renderer: node backend/dist/renderer-server.js
EXPOSE 3000 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/server.js"]
