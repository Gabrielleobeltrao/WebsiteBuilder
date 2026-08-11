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

## 6. Release record

| Date | Tag | Commit | Deployed by | Result |
|---|---|---|---|---|
| — | — | — | — | First production deployment not yet performed |
