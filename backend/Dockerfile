# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: sharp ships prebuilt binaries for glibc, and on musl it either
# compiles libvips from source at install time or fails. The image is larger; the build is
# predictable, which matters more.
FROM node:22-slim AS build
WORKDIR /app

# Stated rather than inherited, and `production` on purpose: bundlers read NODE_ENV to choose a
# build mode, so telling this stage `development` to satisfy a warning about npm would ship a
# development build.
#
# npm 10 does not omit devDependencies for NODE_ENV — only `--omit=dev` does that. `--include=dev`
# below says the intent out loud regardless of which npm runs the build.
ENV NODE_ENV=production

# Manifests first so dependency installation is cached until they actually change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# The renderer server-renders the frontend's renderer components, so that workspace is installed
# and its source is copied in — the bundler reads them directly rather than a built artefact.
# The build needs TypeScript and tsup, which are devDependencies. Stated explicitly so it holds
# whatever the platform passes and whichever npm resolves it.
RUN npm ci --include=dev --workspace @websitebuilder/backend --workspace @websitebuilder/shared \
  --workspace @websitebuilder/frontend --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend/src/components/renderer frontend/src/components/renderer
COPY backend backend

RUN npm run build --workspace @websitebuilder/backend

# ---

# Everything the two services share. It has no CMD of its own: a base that could start something is
# a base that starts the wrong thing when a target forgets to say otherwise.
FROM node:22-slim AS runtime-base
WORKDIR /app

ENV NODE_ENV=production

# Only production dependencies reach the runtime image. tsup bundled the workspace source, so
# @websitebuilder/shared and the renderer components are already inlined; react and react-dom stay
# external and are installed here. The frontend workspace is a build-time dependency only, so the
# editor's dependency tree never reaches production.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci --omit=dev --workspace @websitebuilder/backend --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/backend/dist ./backend/dist

# Never run as root. A process that only needs to read its own bundle has no reason to.
USER node

# ---

# Two targets rather than one image branching at start-up. Which process a container runs is then a
# property of the image it was built from, visible in `docker inspect` and impossible to get wrong
# by forgetting a variable. The previous single image carried two `CMD` lines; Docker honours only
# the last, so the renderer silently started the API.
FROM runtime-base AS api

# In a container the port is stated rather than defaulted: the compose file, the gateway and the
# health check below all name 3000, and the application's own default is a development number.
ENV API_PORT=3000
EXPOSE 3000

# Probes this service's own endpoint and port. A renderer answering here, or an API that never
# started, both fail — which is the point of a health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.API_PORT||3000)+'/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so node is PID 1 and receives SIGTERM directly. Behind a shell it never would, and the
# graceful shutdown this service implements would be skipped on every deploy.
CMD ["node", "backend/dist/server.js"]

# ---

FROM runtime-base AS renderer

ENV PUBLIC_RENDERER_PORT=3001
EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PUBLIC_RENDERER_PORT||3001)+'/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "backend/dist/renderer-server.js"]
