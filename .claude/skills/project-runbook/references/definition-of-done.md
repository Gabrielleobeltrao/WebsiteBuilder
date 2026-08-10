# Definition of done

A task is done only when every line below holds. Section 11 of `IMPLEMENTATION_PLAN.md` is the full
list; this is the per-task subset that applies to almost every change.

## Always

- `npm run typecheck`, `npm run test`, and `npm run build` pass. TypeScript strict, no `any` escape
  hatch to silence a real type error.
- The task's own `Verify:` command passes.
- Tests are deterministic and do not depend on a personal database or a live third-party API.
- No secret is committed. No backend secret appears in `VITE_*`, build artifacts, logs, or docs.
- The project still runs after the change.

## Any user-facing change

- Copy exists in **both** `pt-BR` and `en-US` with key parity. No hardcoded visible string.
- Loading, empty, error, and success states exist.
- Keyboard reachable, visible focus, accessible name, correct semantics. Colour is never the only
  carrier of state.
- Layout holds from `320px` to `1920px`, in both languages — Portuguese labels run longer.

## Any data change

- Scoped by a server-verified `workspaceId` before any resource ID is resolved.
- Writes carry `revision`; a stale write returns `409 REVISION_CONFLICT` rather than overwriting.
- User-supplied URLs pass the shared safe-link allowlist on client **and** server.
- Responsive values are structured allowlisted units — never a raw CSS string.
- No `dangerouslySetInnerHTML`, no arbitrary HTML/CSS/JS execution path.

## Any renderer change

- One shared renderer serves editor, preview, and published output. No duplicated
  property-to-style mapping.
- Editor-only affordances (outlines, handles, labels) never appear in preview or public HTML.

## Closing

- The plan checkbox moves to `[x]` only after verification passed, never before.
- One Progress Log line appended. Decision Log entry only for a real deviation, with its reason.
