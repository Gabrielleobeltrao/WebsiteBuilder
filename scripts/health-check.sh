#!/usr/bin/env bash
#
# Is the platform answering, from outside?
#
# Coolify's own healthcheck asks each container whether it is well, from inside the container. That
# question was answered "yes" throughout the outage on 2026-08-12, while every visitor got a 504:
# the containers were fine and the gateway was dialling an address it could not reach. Only a
# request that arrives the way a visitor's does can see that.
#
# Exits 0 when every surface answered, 1 otherwise, so cron and any uptime monitor can use it as-is.
#
#   npm run health
#   HEALTH_HOST=staging.example.com npm run health
set -uo pipefail

HOST="${HEALTH_HOST:-websitebuilder.oneplataforma.com}"
RENDERER="${HEALTH_RENDERER_HOST:-origin.${HOST}}"
# A published site, when there is one worth watching. Empty skips it.
SITE="${HEALTH_SITE_HOST:-}"
TIMEOUT="${HEALTH_TIMEOUT:-15}"

failures=0

check() {
  local label="$1" url="$2" expected="$3"
  local out status time

  out=$(curl -sS -o /dev/null -w '%{http_code} %{time_total}' --max-time "$TIMEOUT" "$url" 2>/dev/null) || out="000 ${TIMEOUT}"
  status="${out%% *}"
  time="${out##* }"

  if [ "$status" = "$expected" ]; then
    printf 'ok    %-28s %s in %ss\n' "$label" "$status" "$time"
  else
    printf 'FAIL  %-28s %s in %ss (esperado %s)\n' "$label" "$status" "$time" "$expected"
    failures=$((failures + 1))
  fi
}

echo "verificando $(date '+%Y-%m-%d %H:%M:%S')"
check "aplicação" "https://${HOST}/api/v1/health" 200
check "renderer" "https://${RENDERER}/healthz" 200
[ -n "$SITE" ] && check "site publicado" "https://${SITE}/" 200

if [ "$failures" -gt 0 ]; then
  echo
  echo "$failures com falha."
  # The one distinction worth printing: a gateway that answers but cannot reach its upstream looks
  # nothing like a host that is down, and the fix is nowhere near the same place.
  echo "504 = o Traefik achou a rota e não alcançou o container: veja a seção 'A 504 on the application hostname' em docs/PRODUCTION_DEPLOYMENT.md"
  echo "000 = nem TLS terminou: DNS, certificado ou a máquina."
  exit 1
fi

echo "tudo no ar."
