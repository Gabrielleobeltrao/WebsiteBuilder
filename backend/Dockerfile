# syntax=docker/dockerfile:1

# Debian slim rather than Alpine: sharp ships prebuilt binaries for glibc, and on musl it either
# compiles libvips from source at install time or fails. The image is larger; the build is
# predictable, which matters more.
FROM node:22-slim AS build
WORKDIR /app

# The build needs TypeScript, tsup and the workspace tooling, all of which are devDependencies. A
# platform that exposes NODE_ENV=production at build time would make npm skip exactly those, so this
# stage states its own value rather than inheriting one that breaks it.
ENV NODE_ENV=development

# Manifests first so dependency installation is cached until they actually change.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

# The renderer server-renders the frontend's renderer components, so that workspace is installed
# and its source is copied in — the bundler reads them directly rather than a built artefact.
# `--include=dev` as well as the environment above: two ways of saying it, because a missing build
# tool fails late and confusingly, and the cost of saying it twice is a flag.
RUN npm ci --include=dev --workspace @websitebuilder/backend --workspace @websitebuilder/shared \
  --workspace @websitebuilder/frontend --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend/src/components/renderer frontend/src/components/renderer
COPY backend backend

RUN npm run build --workspace @websitebuilder/backend

# ---

FROM node:22-slim AS runtime
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

# Both processes live in this image, and which one a container runs is a variable rather than an
# override of the command. A platform that builds from a Dockerfile takes the image's CMD as given
# and often exposes no way to change it, so the choice belongs somewhere it can always be set.
#
#   SERVICE_ROLE=api        the application API   (default)
#   SERVICE_ROLE=renderer   the public renderer
ENV SERVICE_ROLE=api
EXPOSE 3000 3001

# Health follows the role: asking the renderer for the API's health endpoint would report a working
# process as unhealthy and restart it forever.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node backend/dist/healthcheck.js

# `exec` so node replaces the shell and becomes PID 1. Without it the shell holds that slot, SIGTERM
# never reaches node, and graceful shutdown is skipped on every deploy.
CMD ["sh", "-c", "exec node backend/dist/$([ \"$SERVICE_ROLE\" = renderer ] && echo renderer-server || echo server).js"]

CMD ["node", "backend/dist/server.js"]
