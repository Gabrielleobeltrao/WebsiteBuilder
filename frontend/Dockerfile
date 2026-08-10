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

# VITE_* values are compiled into the bundle, so they are build arguments rather than runtime
# environment. Only public values belong here: anything secret would be published to every visitor.
ARG VITE_PUBLIC_ORIGIN
ARG VITE_API_URL=/api/v1
ENV VITE_PUBLIC_ORIGIN=$VITE_PUBLIC_ORIGIN
ENV VITE_API_URL=$VITE_API_URL

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
