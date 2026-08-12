# Release and rollback

How a change reaches production, and how it leaves again when it should not have.

---

## 1. Branches

Two long-lived branches. Work integrates into `development`; `main` is what production deploys from.

`main` is advanced by **fast-forward** from `development`, and only when every gate passes on the
commit being promoted:

```bash
npm run typecheck && npm run test && npm run build && npm run test:e2e
```

A pull request is not required. With a single maintainer, a review they approve themselves is
process rather than protection; the check suite is what actually catches things, and CI runs it on
every push to both branches.

Never force-push `main` and never commit to it directly. A fast-forward only ever moves it to a
commit that already exists and was already tested on `development`, which is what makes every
promotion recoverable — and those two operations are precisely the ones that are not.

---

## 2. Promoting

```bash
git checkout development && git pull
# gates must be green here, on this exact commit
git checkout main && git merge --ff-only development && git push origin main
git checkout development
```

Tag the promoted commit so a rollback has a name to return to:

```bash
git tag -a v0.1.0 -m "Production deployment: same-origin topology"
git push origin v0.1.0
```

The tag is what makes a rollback a decision rather than an archaeology exercise.

---

## 3. Deploying

Coolify deploys the `main` branch of the single Compose resource. Watch all three containers become
healthy; the frontend waits for the backend by design.

Then run the smoke checks in
[PRODUCTION_DEPLOYMENT.md §7](PRODUCTION_DEPLOYMENT.md#7-first-deployment). The one that matters
most is that `/api/v1/does-not-exist` does not answer `text/html`.

---

## 4. Rolling back

**Preferred: redeploy a known-good commit.** In Coolify, deploy the previous tag. Nothing is deleted
and nothing is rebuilt from a moving branch, so the result is the artefact that was working.

If `main` has already moved:

```bash
git checkout main
git revert --no-edit <bad commit>
git push origin main
```

A revert rather than a reset: `main` keeps its history, the revert is itself reviewable, and nobody
who already pulled has to recover from a rewritten branch.

**What does not need rolling back.** Published customer sites are immutable snapshots served by the
renderer from the database. A code rollback does not change what any visitor sees, because the
snapshot they are being served was not produced by the code being rolled back.

**What to check first.** Whether the bad release wrote anything. Index creation is idempotent and
additive, and there is no destructive migration in this codebase — but confirm before assuming.

---

## 5. After a rollback

1. All three containers healthy.
2. The smoke checks again.
3. Sign in, load the builder, publish once, open a project subdomain.
4. Record what happened in the table below, before the detail is lost.

---

## 6. Releasing the responsive builder

This release changes how every existing site is rendered, so it has one property no previous release
had: **the first time a draft is opened or published after it, the document may be rewritten.**

### What the migration does

`migrateDocumentResponsive` runs when a draft is loaded in the builder and again inside publication,
so a site that is published without anybody opening the editor is migrated too.

It writes tablet and mobile overrides for elements that would otherwise sit outside the screen at
those widths. Three properties bound what it can do:

- **Desktop is never touched.** There is no branch in the function that writes to it.
- **Nothing already authored is overwritten.** A device that already has a value keeps it.
- **It is idempotent.** Running it twice produces the same document, byte for byte.

An element that already fits is left alone. A layout nobody complained about is not "improved".

### Release order

1. Promote and deploy as in sections 2 and 3. The three containers are unchanged — **no new Coolify
   resource, no new domain, no new environment variable is required by this release.**
2. Confirm the API, application and renderer are healthy.
3. Open one existing site in the builder. The draft migrates on load; save it.
4. Publish it, and open its public address at a phone width. Nothing should scroll sideways.

### Rollback limits

Rolling the *code* back is a pointer move, as in section 4. Two things do not roll back with it:

- **Migrated drafts stay migrated.** The overrides are ordinary document data and the previous build
  reads them without complaint — it simply ignores them, so a rolled-back site renders the way it did
  before. Nothing is lost and nothing needs repairing.
- **Published versions are immutable.** A version published by this build stays as it was published.
  If it must be undone, roll the site back to an earlier version from the publish screen; the
  pointer move is the same operation an operator already has.

There is no data migration to reverse, no schema version change, and no backfill job.

### What to watch after deploying

- Publishing refusals mentioning a layout problem. Phone and tablet overflow now blocks publication;
  anything wider is a warning. A customer who cannot publish should see the finding and an **Open in
  builder** link that selects the responsible element.
- Draft preview requests: `GET /api/v1/workspaces/:workspaceId/projects/:projectId/publishing/preview`.
  They are authenticated, cached nowhere, and read-only. A spike in 404s from that route means a
  page slug is being requested that the site does not serve.

---

## 7. Release record

| Date | Tag | Commit | Deployed by | Result |
|---|---|---|---|---|
| 2026-08-11 | `v0.1.0` | `c4e04c2` | Repository owner | First production deployment of the single-origin topology. Application, API and renderer healthy; account creation and sign-in confirmed. Outstanding: no wildcard certificate, so project subdomains answer over HTTP but not HTTPS. |
