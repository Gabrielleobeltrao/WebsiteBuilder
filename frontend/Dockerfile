# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app

# Stated rather than inherited, and `production` on purpose: Vite reads NODE_ENV to choose its build
# mode. Setting it to `development` here to satisfy a warning about npm shipped a development bundle
# to production once, with `import.meta.env.DEV` true and every guard reading it inverted.
#
# npm 10 does not omit devDependencies for NODE_ENV — only `--omit=dev` does that — so the warning
# it was answering did not apply. `--include=dev` below says the intent out loud anyway.
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --include=dev --workspace @websitebuilder/frontend --workspace @websitebuilder/shared \
  --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend

# No VITE_* build argument. The API answers at /api/v1 on this same origin, proxied by the gateway
# below, so there is no address to compile in. Should one ever be needed, only public values may be
# passed here — everything prefixed VITE_ is downloaded by every visitor.

RUN npm run build --workspace @websitebuilder/frontend

# ---

FROM nginx:1.27-alpine AS runtime

# The config has no variables of its own, so it is copied straight to conf.d rather than through
# the image's template step. Left in templates, envsubst would rewrite nginx's own $host and
# $remote_addr into empty strings.
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
