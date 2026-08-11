# syntax=docker/dockerfile:1

FROM node:22-slim AS build
WORKDIR /app

# Vite and TypeScript are devDependencies. A platform that exposes NODE_ENV=production at build time
# would make npm skip them, so this stage states its own value rather than inheriting one that
# breaks it.
ENV NODE_ENV=development

COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY backend/package.json backend/
COPY frontend/package.json frontend/

RUN npm ci --include=dev --workspace @websitebuilder/frontend --workspace @websitebuilder/shared \
  --include-workspace-root

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY frontend frontend

# The API's public origin is compiled into the bundle, because the API is deployed as its own host
# and the browser has to know where to call. Only public values may ever be passed here: everything
# prefixed VITE_ is downloaded by every visitor.
ARG VITE_API_URL=/api/v1
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
