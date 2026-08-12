# Forms: what owns what

One authoritative statement of where each piece of a form lives, which copy is used when, and what
happens when something is edited, published, archived or deleted. Everything else about forms —
schemas, routes, renderers, tests — is written against this document, and a disagreement between
code and this file is a bug in one of them.

---

## 1. Four records, four owners

| Record | Lives in | Owns | Mutable |
|---|---|---|---|
| **Definition** | `formDefinitions` collection | name, stable id, ordered fields, labels, types, options, required rules, validation limits, submit label, success behaviour, error message, retention, `revision` | yes |
| **Placement** | a `form` element inside the builder document | which definition (`formId`) and how it looks on this page: preset, alignment, spacing, colours, typography, border, radius, plus the element's own geometry | yes |
| **Published snapshot** | `publishedVersions.forms[]` | a frozen copy of every definition the published pages reference, at the revision that was live when publish ran | never |
| **Submission** | `formSubmissions` collection | the values a visitor sent, the definition id and revision they answered, a minimal copy of the field schema they saw, and server-derived attribution | append-only, status changes only |

The rule behind the table: **a form's meaning is owned once, its appearance is owned per placement,
and what a visitor actually saw is owned by the version they saw it in.**

### Why the placement holds no fields

A definition is edited once and shown by however many pages reference it. A copy of the fields on
the block would drift from the copy that actually validates a submission, and the two would disagree
about what "required" means. The block therefore holds a reference and presentation, and nothing a
submission is validated against.

### Why the block holds no copy either

Submit label, success behaviour and error message were originally on the block. They are now on the
definition, because they are what the *form* says rather than how the *page* looks — two placements
of one form saying different things after submission is a bug, not a feature. Consent likewise is a
normal `consent` field in the definition, not a block flag: it is a question with an answer that has
to be stored beside the others.

Legacy documents keep their old values (see §5) — they are never read for rendering, and never
silently discarded.

---

## 2. Which definition is used, and when

| Surface | Definition it renders | Can submit |
|---|---|---|
| Builder canvas | the **draft** definition, loaded by the editor | no — fields are inert |
| Draft preview (`/preview/…`) | the **draft** definition | yes, validated, but **nothing is persisted** |
| Published site | the **snapshot** revision embedded in the active published version | yes, persisted |

Editing a definition affects the builder and the preview immediately, and affects a live site only
after the next publish. That is the whole reason the snapshot exists: a visitor half-way through
filling in a form must not have the questions changed under them, and a submission stored against a
definition that has since been rewritten must still be readable.

A form block therefore has a **draft revision** and a **published revision**, and when they differ
the product says so — "changes waiting to publish" — rather than leaving the author to guess whether
the site is showing their edit.

---

## 3. Validation happens twice, and only one of them counts

- The browser validates for feedback, from the same shared function the server uses.
- The server validates as the actual boundary, against the **snapshot** definition, and ignores
  every field the definition does not declare.

A form can therefore never be used as an arbitrary write endpoint: the accepted value set is the
definition's field list, and nothing else in the payload is stored.

---

## 4. Lifecycle

**Archive, don't destroy.** A definition with submissions is archived rather than deleted; the
submissions it explains stay readable. A definition referenced by a page cannot be deleted at all
until the reference is removed or rebound — the alternative is a page holding an id that resolves to
nothing, which publishes as a set of inputs that accept an answer and lose it.

**Removing the last placement does not remove access.** The Forms module stays visible while the
project has a form block, a form definition, or retained submissions. Deleting the last block on the
last page hides nothing that holds business records.

**Retention is per definition.** `retentionDays` deletes submissions older than the window, scoped
to one workspace and one form. It is opt-in; absent means keep.

**Publishing gates on readiness, not on tidiness.** A block bound to nothing, a block bound to a
definition that no longer exists, a definition with no usable field, an invalid redirect target and
an archived referenced form are errors and block publication. A definition edited since the last
publish is a warning and does not.

---

## 5. Versions and migration

The `form` element carries a `version`, migrated on read by `ELEMENT_MIGRATIONS` and never on write.

**1 → 2** moves the block's copy to the definition's side of the boundary. The old values are not
thrown away: they are preserved on the element as `legacyCopy`, which the renderer never reads. The
builder offers them as the seed when a form is created from that block, and clears them once the
block is bound. Running the migration twice is a no-op, because a v2 element has no legacy fields
left to move.

A published snapshot is never migrated. A live site keeps exactly the markup it was published with.

---

## 6. Tenancy

Every authenticated query is scoped by the server-verified `workspaceId` first and the project
second, so a form id from another tenant finds nothing rather than someone else's fields.

The public submission endpoint takes **no identity from its caller**. Workspace, project, page and
site come from the request hostname resolved against the published domain record and route manifest;
the form comes from the snapshot of the version being served. A payload cannot name a workspace, a
project or a page, because those fields do not exist in its schema.

---

## 7. Where the code is

Every path below is checked by `packages/shared/src/forms-contract.test.ts`, so this list cannot
quietly stop describing the repository.

```
packages/shared/src/forms.ts
packages/shared/src/form-usage.ts
packages/shared/src/visual-elements.ts
packages/shared/src/element-migrations.ts
packages/shared/src/publication.ts
backend/src/modules/forms/repository.ts
backend/src/modules/forms/routes.ts
backend/src/modules/forms/export.ts
backend/src/renderer/forms.ts
frontend/src/components/renderer/FormRenderer.tsx
frontend/src/features/forms/FormsRoute.tsx
frontend/src/features/editor/inspector/FormBindingField.tsx
```
