#!/usr/bin/env bash
#
# Container smoke suite: builds the production images, starts the stack against disposable
# configuration, and checks the things a deploy can get wrong in ways nothing else notices.
#
# It uses its own project name and its own database name, so it can never touch production data.
# Run it from the repository root:
#
#   ./scripts/container-smoke.sh
#
set -euo pipefail

COMPOSE_FILE="docker-compose.production.yml"
PROJECT="wb-smoke-$$"
ENV_FILE="$(mktemp)"
FAILURES=0

cleanup() {
  docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$ENV_FILE"
}
trap cleanup EXIT

check() {
  local name="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    printf 'ok    %s\n' "$name"
  else
    printf 'FAIL  %s\n' "$name"
    FAILURES=$((FAILURES + 1))
  fi
}

# Disposable values. The secret is throwaway and the database name is not a production one, so a
# mistake here cannot reach real data.
cat > "$ENV_FILE" <<ENV
PLATFORM_PUBLIC_ORIGIN=http://localhost:18080
PUBLIC_RENDERER_ORIGIN=http://localhost:18081
PLATFORM_ROOT_DOMAIN=localhost
MONGODB_URI=${SMOKE_MONGODB_URI:?set SMOKE_MONGODB_URI to a throwaway database}
MONGODB_DB_NAME=websitebuilder_smoke
BETTER_AUTH_SECRET=smoke-only-secret-not-for-any-real-deployment
LOG_LEVEL=warn
ENV

echo "--- building all targets from the current checkout ---"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" build

echo "--- the compose file renders ---"
check "compose config is valid" docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" config

echo "--- each image starts the process it is supposed to ---"
api_cmd=$(docker inspect --format '{{join .Config.Cmd " "}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" images -q backend | head -1)" 2>/dev/null || echo "")
renderer_cmd=$(docker inspect --format '{{join .Config.Cmd " "}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" images -q renderer | head -1)" 2>/dev/null || echo "")
check "api image runs server.js"        bash -c "[[ '$api_cmd' == *server.js* && '$api_cmd' != *renderer-server.js* ]]"
check "renderer image runs renderer-server.js" bash -c "[[ '$renderer_cmd' == *renderer-server.js* ]]"

echo "--- starting the stack ---"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --wait --wait-timeout 180

echo "--- health ---"
for service in frontend backend renderer; do
  state=$(docker inspect --format '{{.State.Health.Status}}' "$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" ps -q "$service")" 2>/dev/null || echo "none")
  check "$service is healthy" bash -c "[[ '$state' == healthy ]]"
done

frontend_port=$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" port frontend 8080 2>/dev/null | cut -d: -f2 || echo "")
renderer_port=$(docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" port renderer 3001 2>/dev/null | cut -d: -f2 || echo "")

if [[ -n "$frontend_port" ]]; then
  echo "--- the gateway serves the app and proxies the API ---"
  check "frontend serves HTML"        bash -c "curl -fsS http://localhost:$frontend_port/ | grep -q '<!doctype html>'"
  check "/api/v1/health returns JSON"  bash -c "curl -fsS http://localhost:$frontend_port/api/v1/health | grep -q '\"status\"'"
  # The failure this catches is the one that presents as a rejected login: HTML served where JSON
  # was expected, with a 200 attached.
  check "an unknown API path is not HTML" bash -c "! curl -sS http://localhost:$frontend_port/api/v1/nope | grep -q '<!doctype html>'"
fi

if [[ -n "$renderer_port" ]]; then
  echo "--- the renderer refuses hosts it does not know ---"
  check "unknown host is 404" bash -c "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: nothing.localhost' http://localhost:$renderer_port/) == 404 ]]"
  check "reserved host is 404" bash -c "[[ \$(curl -s -o /dev/null -w '%{http_code}' -H 'Host: api.localhost' http://localhost:$renderer_port/) == 404 ]]"
fi

echo "--- the API is not reachable from outside the private network ---"
check "backend publishes no host port" bash -c "! docker compose -p '$PROJECT' -f '$COMPOSE_FILE' --env-file '$ENV_FILE' port backend 3000 2>/dev/null | grep -q ."

echo "--- restart, then the same checks again ---"
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" restart >/dev/null
docker compose -p "$PROJECT" -f "$COMPOSE_FILE" --env-file "$ENV_FILE" up -d --wait --wait-timeout 180 >/dev/null
if [[ -n "$frontend_port" ]]; then
  check "API still answers after a restart" bash -c "curl -fsS http://localhost:$frontend_port/api/v1/health | grep -q '\"status\"'"
fi

echo
if [[ "$FAILURES" -eq 0 ]]; then
  echo "container smoke: all checks passed"
else
  echo "container smoke: $FAILURES check(s) failed"
  exit 1
fi
