# Operations guide

Running the platform: backups, monitoring, smoke checks and incidents. It contains no real secrets.

> **Not yet rehearsed.** No restore has been performed and no staging deploy has been run from this
> repository. The procedures are written and reviewed; the evidence column in §11 is empty on
> purpose rather than filled with an assumption.

---


## Watching from outside

```bash
npm run health
```

Checks the application and the renderer over HTTPS, the way a visitor reaches them, and exits
non-zero when either is not answering. `HEALTH_HOST`, `HEALTH_RENDERER_HOST` and `HEALTH_SITE_HOST`
point it somewhere else; `HEALTH_SITE_HOST` also checks one published customer site.

It exists because Coolify's healthcheck cannot see the failure that actually happened. On
2026-08-12 every container reported healthy for half an hour while every visitor received a 504:
the containers were well, and the gateway was dialling an address it could not reach. A check that
asks a container about itself will answer "yes" for the whole of that outage.

### Making it continuous

The script exits 0 or 1 and prints one line per surface, so anything that runs commands can watch
with it. In rough order of how much it survives:

1. **An external uptime monitor** — any service that requests
   `https://websitebuilder.oneplataforma.com/api/v1/health` every minute and alerts. It is the only
   option that keeps watching when the machine itself is the thing that failed, which is why it is
   first. No code here is involved.
2. **Cron on the VPS** — five minutes apart, alerting through whatever the operator already reads:

   ```cron
   */5 * * * * cd /path/to/WebsiteBuilder && npm run health >> /var/log/wb-health.log 2>&1
   ```

   Cheaper to set up and blind to an outage that takes the host down with it.
3. **By hand**, before and after every deployment. Which is what the command is for.

## 1. Where the deployment is documented

Standing the platform up — Coolify fields, environment variables, DNS, routing and the first deploy
— lives in [PRODUCTION_DEPLOYMENT.md](PRODUCTION_DEPLOYMENT.md). Customer hostnames live in
[CUSTOM_DOMAINS.md](CUSTOM_DOMAINS.md). Promotion and rollback live in
[RELEASE_AND_ROLLBACK.md](RELEASE_AND_ROLLBACK.md).

This file is about running it: backups, monitoring, smoke checks and incidents. It deliberately does
not repeat the topology, because two descriptions of one deployment drift and the reader cannot tell
which is current.

For orientation: one Coolify Compose resource, three containers, one private network. The
application serves the SPA and proxies `/api/*` to a backend that has no public route at all; the
renderer has its own hostname because it serves customer content and must not share an origin with
the authenticated dashboard.

---

## 2. Backups

MongoDB Atlas (current setup):

1. Atlas → Backup → enable **Cloud Backup**. Snapshots are encrypted at rest by default.
2. Retention: daily for 7 days, weekly for 4 weeks, monthly for 12 months.
3. Restore rehearsal, quarterly: restore the latest snapshot into a *new* cluster, point a staging
   API at it, confirm sign-in, one published site rendering, and one publish. Never restore over
   production to test a restore.
4. Record the date, snapshot ID and outcome in §7.

Self-hosted MongoDB in Coolify instead: enable the resource's scheduled backup to S3-compatible
storage with a server-side-encrypted bucket, same retention, same rehearsal.

GridFS media lives in the same database and is covered by the same snapshot.

---

## 3. Monitoring and alerts

| Signal | Where | Alert when |
|---|---|---|
| Disk | Coolify server metrics | > 80 % |
| Memory / CPU | Coolify per-resource | Sustained > 85 % for 10 min |
| Uptime | External checker | `https://${PLATFORM_ROOT_DOMAIN}/api/v1/health` or `https://origin.${PLATFORM_ROOT_DOMAIN}/healthz` fails twice |
| Publish failures | API logs, `msg` contains publish | Any 5xx from `POST /publishing` |
| Unknown-host spike | Renderer logs, 404 with `host` | Sharp rise — usually a DNS change or a scan |
| Certificate failures | Domain records with `status: failed` | Any customer domain failed for over an hour |
| Verification stalls | Domains pending beyond `DOMAIN_VERIFICATION_TIMEOUT_HOURS` | Any |

Renderer logs carry the hostname and the request line only. Published documents may contain
personal data and never enter a log; neither do form submission bodies.

---

## 4. Smoke checklist

Run after every deploy. The per-release list is
[PRODUCTION_CHECKLIST.md](PRODUCTION_CHECKLIST.md); this is the command form.

Replace `example.com` with the real root domain.

```bash
ROOT=example.com

curl -sS -o /dev/null -w '%{http_code} apex\n'        https://$ROOT/
curl -sS -o /dev/null -w '%{http_code} roadmap\n'     https://$ROOT/roadmap
curl -sS -o /dev/null -w '%{http_code} app\n'         https://$ROOT/app
curl -sS -w ' api-health\n'                            https://$ROOT/api/v1/health
curl -sS -w ' renderer-health\n'                       https://origin.$ROOT/healthz

# The API must answer as an API even when it fails. HTML here means the SPA fallback is in front
# of the proxy and every client would parse a login page as JSON.
curl -sS -I https://$ROOT/api/v1/does-not-exist | grep -i content-type

# A published project subdomain and an unknown host.
curl -sS -o /dev/null -w '%{http_code} project\n'     https://acme.$ROOT/
curl -sS -o /dev/null -w '%{http_code} unknown\n'     https://nothing-here.$ROOT/
```

Then, in the application:

1. Publish a site. Confirm the public address serves the new content.
2. Publish again with no changes. Confirm it reports nothing changed and creates no new version.
3. Edit, publish, roll back. Confirm visitors see the older version and the draft is untouched.
4. Connect a disposable test subdomain, watch it move pending → certificate → working, make it
   primary, confirm the secondary redirects, then disconnect it and confirm the site still serves
   on its platform address.
5. Restart the API resource. Confirm published sites keep serving throughout — the renderer reads
   its own snapshots and does not depend on the API process.

---

## 5. Incidents

**Cloudflare API unavailable.** Already-active customer domains keep serving: the renderer resolves
only stored active records and never calls the provider. New activations and re-verification pause
and retry. Do nothing except confirm the refresh loop resumes.

**A publish failed.** Nothing changed for visitors — the pointer only moves after the snapshot is
written and verified. Read the blockers on the publish screen; they are the same ones the server
checked.

**Wrong content on a customer domain.** Check the domain record's `projectId`. Hostnames are
globally unique, so this means a record was written wrong, not that the renderer guessed. Disconnect
the domain to take it out of service immediately.

**Database unreachable.** The API answers health with `database: down`. The renderer serves cached
sites until their TTL expires, then answers 404. Restore from §6.

---

## 6. Branch and deployment protection

> **Not applied automatically.** These rules need an authenticated session with admin rights on the
> repository, which this environment does not have. The exact configuration is below; until it is
> applied, the residual risk is stated with it.

### What to configure

GitHub → Settings → Branches → Add branch ruleset.

**Ruleset `main`** — target branch `main`:

| Setting | Value |
|---|---|
| Restrict deletions | on |
| Block force pushes | on |
| Require a pull request before merging | **off** |
| Require status checks to pass | on — `verify` and `audit` |
| Allow bypass | nobody, including administrators |

**Ruleset `development`** — target branch `development`:

| Setting | Value |
|---|---|
| Restrict deletions | on |
| Block force pushes | on |
| Require status checks to pass | on — `verify` |
| Require a pull request | **off** |

Pull requests are not required on either branch. With a single maintainer, a required review is
granted by the person who wrote the change — that is process, not protection, and it gets clicked
through. What does catch things is the check suite, which is required on both.

Promotion is a fast-forward: `main` is moved to a commit that already exists on `development` and
already passed there. That is why blocking force-push and deletion still matters even without a
review gate — a fast-forward is always recoverable, and the two operations these rules refuse are
the ones that are not.

Also set the default branch to `development` (Settings → General → Default branch), so a clone
starts where work belongs.

### Deployment sources

| Environment | Branch | Where |
|---|---|---|
| Production | `main` | Coolify → each resource → Configuration → Branch |
| Staging (optional) | `development` | A separate set of resources with their own database and secrets |

A task branch cannot deploy production because no resource watches it. Confirm this by looking at
the branch field on all three production resources; it is one screen and worth checking after any
Coolify upgrade.

### Residual risk until the rules are applied

- `main` can be force-pushed or deleted by anyone with write access. This is the one that has no
  undo, and the one the rules exist for.
- `main` can be advanced to a commit whose checks never ran or failed.
- The checks in `.github/workflows/quality.yml` still run and their result is visible; nothing yet
  prevents promoting past a red one.

The local gates are unchanged and unweakened: `npm run typecheck && npm run test && npm run build &&
npm run test:e2e` is the same command the workflow runs.

---

## 7. Rehearsal record

| Date | Action | Result |
|---|---|---|
| — | Staging deploy | Not yet performed |
| — | Restore from backup | Not yet performed |
