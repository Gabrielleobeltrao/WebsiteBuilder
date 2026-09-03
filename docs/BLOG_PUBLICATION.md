# The blog, and what publishing means

Three different things are called "publishing" in this product, and confusing any two of them is
what most of the reported blog problems turned out to be. This is the order they happen in and what
each one changes.

---

## 1. What each act publishes

| Act | Where | What changes | What a visitor sees |
|---|---|---|---|
| **Marking a post published** | The post form's Visibility control | The post's own `status`, and the server stamps `publishedAt` the first time | Nothing yet |
| **Publishing a layout** | Post layout / List layout, the Publish button in the builder | The template's `publishedDocument` — every article at once | Nothing yet |
| **Publishing the site** | The site's Publish screen | A new immutable snapshot, compiled from the current document, the published layouts and every published post | Everything above, at once |

The rule behind the table: **a snapshot is immutable and nothing reaches a visitor until a new one
is compiled**. That is what makes a published site stable while its owner edits, and it is also why
a post can be correctly marked published and correctly absent from the site.

The blog dashboard says which of those states each post is in — on the site, changed since the site
was published, waiting for the site's first publication — rather than one word for all of them.

## 2. Why publishing can be refused

`npm run test -w backend` covers each of these; they are listed here because an operator sees the
message, not the test.

- **The blog is on and a layout was never published.** Its routes would be live and empty. The site
  card says "Needs attention", the site dashboard names it, and publication is blocked.
- **A referenced image is not in the workspace's library.** Includes a post's cover and any image
  custom field. Blocking, because the alternative is a published page pointing at bytes the customer
  does not own.
- **The stored document cannot be read by this build.** A document written by a newer deployment, or
  one that no longer parses, answers `409 UNSUPPORTED_DOCUMENT` rather than being compiled anyway.

A refused publication changes nothing: the previously published version keeps serving.

## 3. Blogs enabled before layouts existed

A blog switched on before template ids existed has `enabled: true` and no layouts, which blocks
publication of the **whole site**, not only the blog.

It repairs itself when anybody opens the blog screen — the settings endpoint repairs on read, so the
site stops being blocked at the moment somebody looks at it rather than when they find a button.

To find the ones nobody has looked at yet:

```bash
MONGODB_URI=... npm run audit:blog -w backend                 # every workspace
MONGODB_URI=... npm run audit:blog -w backend -- --workspace <id>
MONGODB_URI=... npm run audit:blog -w backend -- --json
```

Read-only. It counts and names; it repairs nothing, because the repair belongs where its owner can
see it happen.

## 4. Rolling back a blog change

There is no separate blog rollback: the blog is inside the site's snapshot, so rolling the site back
to a previous version rolls the blog back with it — the posts, both layouts and the settings that
shaped the routes. See `docs/RELEASE_AND_ROLLBACK.md`, section 4.

Two consequences worth stating plainly:

- Rolling back does **not** un-publish a post. The post's own status is live data, not snapshot data;
  the next publication will include it again unless it is set back to draft.
- Analytics heat data is keyed by published version and is deleted with the version it describes.
  Traffic, engagement and Web Vitals survive, because they are not tied to a layout.

## 5. Still owner-only

- Confirming the original incident on the affected production account (`P0-T3` in
  `STABILITY_BLOG_UX_PLAN.md`). It needs the owner's credentials and their site.
- The deployed Coolify smoke (`8.4` in `IMPLEMENTATION_PLAN.md`).

Neither is blocked on code.
