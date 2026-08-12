# The block library

How a block is defined, rendered, edited, migrated and published — and what a new one has to do
before it is finished.

---

## 1. One definition per block

`packages/shared/src/element-registry.ts` describes every block once. It is a `Record` over the
`ElementType` union, so a type without a definition does not compile.

A definition carries:

| Field | What it decides |
|---|---|
| `schemaVersion` | The payload version this build writes. Older is migrated on read; newer is refused. |
| `category` | Which group the catalog shows it in. |
| `labelKey`, `keywords` | Its name and its search terms, both resolved per locale. |
| `icon` | The catalog's own icon, not the block's content. |
| `defaultSize` | Its size on the 1440 canvas when inserted. |
| `contexts` | Page, blog template, CMS template. A block absent from a context is hidden there, not disabled. |
| `acceptsChildren`, `freePositionable` | Whether it holds blocks, and whether a free section may place it by coordinate. |
| `feature` | The optional module a reference to it activates. |
| `runtime` | The capability it needs from the public interaction runtime. |
| `defaults()` | The type-specific half of a new element. The base half belongs to the editor. |

Nothing else in the product may keep its own list of block types. Feature detection, the catalog,
create-element, and runtime selection all derive from this one.

---

## 2. What the type system enforces

- **A block with no definition** — `ELEMENT_REGISTRY` is a total record: `npm run typecheck` fails.
- **A block with no renderer** — `VisualElementRenderer` and `ContentElementRenderer` end in a
  `never` check: `npm run typecheck` fails.
- **Defaults that do not match the schema** — a contract test parses every block's defaults with the
  real document schema: `npm run test` fails.

Those three are the reason this is a registry rather than a convention.

---

## 3. Adding a block

1. **Schema** in `visual-elements.ts` (structured display) or `content-elements.ts` (its own data or
   behaviour). Strict, versioned, no field that accepts markup or a raw URL.
2. **Union** — add the name to `ELEMENT_TYPES`.
3. **Definition** in the registry. Typecheck now tells you what is missing.
4. **Renderer** — a case in the matching renderer. It must be complete without JavaScript.
5. **Inspector** — a case in `VisualElementInspector`. Repeatable lists use `ItemsEditor`; never a
   JSON field.
6. **Copy** — `elements.<type>` and `catalog.keywords.<type>` in both locales.
7. **Readiness** — a check in `block-readiness.ts` for the configuration it cannot work without.
8. **Tests** — defaults parse, the inspector edits, the renderer renders, readiness reports.

An unconfigured state is representable on purpose: a block has to be insertable before it can be
filled in, and readiness is what asks for the rest.

---

## 4. Versions and migration

An element carries an optional `version`; absent means 1.

- Migration is a pure function, keyed by the version it upgrades *from*, in `ELEMENT_MIGRATIONS`.
- It runs **on read** — in the builder and in publishing — and writes nothing. Opening a page never
  asks somebody to save a change they did not make.
- A published snapshot is immutable and is never migrated: a live site stays exactly as published.
- An element from a newer deployment is left alone and reported, never half-interpreted.

The gallery's 1 → 2 step is the worked example: bare media ids became items that can carry their own
alternative text, and the migration leaves that text empty rather than inventing a description of a
picture nobody has seen.

---

## 5. The public interaction runtime

One file, `frontend/runtime/src/index.ts`, built into `backend/src/renderer/runtime.generated.ts`
and served at `/__wb/r.js` under its content hash.

- A page references it **only** when one of its blocks declares a `runtime` capability. A static
  page ships no JavaScript and keeps `script-src 'none'` byte for byte.
- Capabilities: tabs, gallery lightbox, carousel, dismissible bar, responsive navigation, countdown,
  counter reveal, table-of-contents active state.
- Everything it does is an upgrade of markup that already works. Tabs fall back to every panel
  visible, never none.
- It requests nothing from anywhere, uses no `eval` and no `innerHTML`, and respects
  `prefers-reduced-motion`.
- Budget: 8 KB brotli, measured against the built artefact. It is 4.7 KB today.

Rebuild with `npm run build:runtime`; a test fails if the committed file and its source disagree.

---

## 6. Patterns

`packages/shared/src/patterns.ts` holds fourteen starter compositions. A pattern is a **factory**,
not a type: inserting one produces an ordinary section of ordinary blocks in one undoable step, and
the document records nothing about where they came from.

That is the property that makes them safe to ship and safe to delete: removing this file would not
break a single page built with one.

Copy is resolved from the current locale at insertion and then belongs to the author.

---

## 7. Readiness

`block-readiness.ts` audits every block against what its own type needs, and publication gates on it.

- **Blocking** — the block cannot work: a video with no id, a form connected to nothing, a countdown
  whose target has no timezone, an image with no decision about its alternative text.
- **Warning** — the block is merely unfinished: an empty gallery, a button that goes nowhere yet.

Each finding carries its page, its element and a code, and the publish screen turns that into a link
that opens the builder on the right page, the right device, the right block and the tab holding the
field.

---

## 8. Where each concern lives

```
packages/shared/src/
  elements.ts            the union, the base shape, the document schema
  visual-elements.ts     structured display blocks
  content-elements.ts    blocks with their own data or behaviour
  element-registry.ts    one definition per block
  element-migrations.ts  versions and pure migrations
  block-readiness.ts     what a block needs before publishing
  patterns.ts            starter compositions

frontend/src/components/renderer/    the one renderer used by editor, preview and public output
frontend/src/features/editor/panel/  the catalog
frontend/src/features/editor/inspector/  the editing surfaces
frontend/runtime/src/                the public interaction runtime
```

The renderer is shared on purpose: the editor, the draft preview and the published page use the same
components, so a block cannot look one way while being authored and another way in public.
