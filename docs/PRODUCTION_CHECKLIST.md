# Production checklist

Run through this for every release. It is short on purpose — a checklist nobody finishes protects
nothing.

## Before

- [ ] `npm run typecheck && npm run test && npm run build && npm run test:e2e` green on the exact
      commit being promoted
- [ ] CI green on that commit, including the `deployment` job
- [ ] Environment variables in Coolify diffed against
      [PRODUCTION_DEPLOYMENT.md §4](PRODUCTION_DEPLOYMENT.md#4-environment-variables) — new
      required variables are the most common deploy failure
- [ ] A recent database backup exists, and its date was actually checked
- [ ] The commit is tagged

## Deploy

- [ ] `main` fast-forwarded; no force-push
- [ ] All three containers healthy
- [ ] `/api/v1/health` returns JSON with `database: up`
- [ ] `/api/v1/does-not-exist` does **not** return `text/html`

## After

- [ ] Register or sign in
- [ ] Open the builder, save, reload — the layout survives
- [ ] Upload an image; it is served as WebP
- [ ] Publish a site; its project subdomain serves it
- [ ] An unknown host returns 404
- [ ] A custom domain, if any is connected, still resolves
- [ ] Container logs for an agreed window: no restarts, no unexplained 5xx

## Rollback window

- [ ] Someone is watching for long enough to notice, with
      [RELEASE_AND_ROLLBACK.md §4](RELEASE_AND_ROLLBACK.md#4-rolling-back) to hand
- [ ] The previous tag is known before it is needed
