# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --workspace @websitebuilder/frontend --workspace @websitebuilder/shared --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend

# No VITE_* build arguments: the app reads none. The API base path is a constant in the shared
# package because the frontend and the API share one origin, so there is nothing to configure per
# environment. Should that change, only public values may be passed here — everything prefixed
# VITE_ is compiled into code every visitor downloads.

RUN npm run build --workspace @websitebuilder/frontend

# ---

FROM nginx:1.27-alpine AS runtime

# The nginx image runs envsubst over /etc/nginx/templates at start-up. The filter restricts
# substitution to this one variable, so nginx's own $host, $scheme and $remote_addr survive.
COPY frontend/nginx.conf.template /etc/nginx/templates/default.conf.template
ENV NGINX_ENVSUBST_FILTER=BACKEND_ORIGIN
ENV BACKEND_ORIGIN=http://backend:3000
COPY --from=build /app/frontend/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --quiet --tries=1 --spider http://127.0.0.1:8080/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
