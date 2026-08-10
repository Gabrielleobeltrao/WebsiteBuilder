# Website Builder MVP — Execution Plan

## 0. How to use this document

This file is the source of truth for implementing the first usable version of the website builder.

The executing agent must:

1. Inspect the repository before making changes.
2. Preserve compatible existing work.
3. Execute phases and tasks in dependency order.
4. Work on one task at a time.
5. Change a task checkbox to `[~]` while it is in progress and `[x]` only after verification passes.
6. Never mark a task complete while its tests, typecheck, or build are failing.
7. Record important deviations in the Decision Log at the end of this file.
8. Keep the project runnable after every completed task.
9. Continue automatically to the next unblocked task unless a real blocker requires user input.

Before implementation, the agent may refine exact package versions after checking compatibility with React 19 and the current Node LTS. It must not change the required stack or expand the MVP without recording and justifying the decision.

### Claude Code bootstrap, skills, and reusable subagents

Use project-scoped Claude Code configuration so the operating rules travel with this repository. Keep personal credentials and machine-specific permissions out of version control.

```text
.claude/
├── agents/
│   ├── repo-navigator.md
│   ├── frontend-implementer.md
│   ├── backend-implementer.md
│   ├── test-verifier.md
│   └── security-tenant-reviewer.md
├── skills/
│   ├── execute-plan-task/
│   │   ├── SKILL.md
│   │   └── scripts/extract-plan-task.mjs
│   ├── project-runbook/
│   │   ├── SKILL.md
│   │   └── references/
│   │       ├── architecture-map.md
│   │       ├── commands.md
│   │       └── definition-of-done.md
│   └── graphify/                  # Created by the official Graphify installer.
└── settings.json                  # Only reviewed, shareable project settings.
```

- Keep root `CLAUDE.md` short: project purpose, fixed stack, safety/non-negotiable rules, canonical commands, and pointers to this plan/skills. Do not copy this entire plan into it because `CLAUDE.md` is loaded repeatedly.
- `execute-plan-task` is the normal entrypoint for implementation: `/execute-plan-task P3-T2`. Its deterministic script extracts only the selected task, phase checkpoint, explicit dependencies, and named architecture sections instead of loading this whole document. It marks `[~]`, executes, verifies, records decisions, then marks `[x]` only when acceptance passes.
- `project-runbook` provides concise progressive disclosure. Its `SKILL.md` contains only routing instructions; it reads one relevant reference file on demand. Regenerate the reference summaries when architecture, commands, or definition of done materially changes, and never let them override this plan.
- Install Ponytail in Claude Code using its published plugin flow:

  ```text
  /plugin marketplace add DietrichGebert/ponytail
  /plugin install ponytail@ponytail
  ```

  Review the installed plugin source and every hook before granting trust. Record the installed version/commit in the Decision Log. Ponytail must prefer existing platform features, installed dependencies, and the smallest safe implementation, but it must never remove required validation, security, accessibility, tenant isolation, or tests.
- Install Graphify's official CLI and register its project-scoped Claude skill from the repository root:

  ```bash
  uv tool install graphifyy
  graphify claude install --project
  ```

  Use `pipx install graphifyy` only when `uv` is unavailable. Confirm the package name is exactly `graphifyy` and inspect the generated `.claude/skills/graphify/` files before committing them.
- Run `/graphify .` only after Phase 1 has created meaningful source code. Configure `.graphifyignore` for `node_modules/`, build output, coverage, Playwright artifacts, generated files, uploaded media, secrets, and caches. Query the graph through the Graphify command/skill; do not load the entire `graph.json` into context by default.
- Refresh the structural graph at phase checkpoints and after material architecture/import/schema changes, not after every small edit. Use incremental update where supported. Treat graph answers as navigation hints with source paths, then read the exact files being changed and verify against current code.
- Decide whether to commit `graphify-out/graph.json`, `GRAPH_REPORT.md`, and `graph.html` only after measuring size and update noise on this repository. Always ignore Graphify machine-local manifest, cost, and cache artifacts documented by the installed version. A stale committed graph is worse than a small targeted code search.
- After root install/dev scripts work, run Claude Code's bundled `/run-skill-generator` once to create the project launch recipe used by `/run` and `/verify`. Regenerate it only when startup/build prerequisites change.
- Reuse Claude Code's bundled `/debug` and `/code-review` for diagnosis and review instead of creating duplicate project skills. Use `/loop` only for a clearly bounded recurring check and `/batch` only for independent work with disjoint files; neither replaces the phase/task dependency rules in this plan.
- Skills reduce repeated instructions through progressive disclosure; subagents isolate noisy work in separate context windows. Neither guarantees lower total tokens. Do not spawn an agent for a tiny edit, and do not run multiple agents that must reread the same files.

Reusable project subagents:

| Agent | Model/tools | Responsibility and output contract |
|---|---|---|
| `repo-navigator` | Prefer a low-cost model; read/search/Graphify only | Locate relevant contracts, call paths, ownership boundaries, and likely blast radius. Return a compact list of exact paths/symbols/evidence; never edit. Skip when one direct Graphify query or `rg` is enough. |
| `frontend-implementer` | Coding-capable model; scoped write/test tools | Implement one explicitly bounded frontend/builder task after shared contracts are known. May edit `frontend/` and approved shared contracts only; return changed paths, decisions, commands, and unresolved risks. |
| `backend-implementer` | Coding-capable model; scoped write/test tools | Implement one bounded Express/Mongo/auth/media/publishing task. Enforce workspace/project scope and never expose secrets; return the same compact handoff contract. |
| `test-verifier` | Read plus build/test/browser tools; no product-code edits by default | Independently run the task's acceptance commands, inspect failures and changed behavior, and return pass/fail evidence. It may propose a fix but the implementer owns product-code changes. |
| `security-tenant-reviewer` | Strong reasoning model; read/search only | Review auth, tenancy, uploads, public endpoints, publishing, domains, links, and injection boundaries. Return only actionable findings with severity, evidence path, exploit precondition, and recommended test. |

Agent operating rules:

1. The main Claude session owns the plan checkbox, final integration, and user-facing decisions.
2. Delegate only a bounded task with acceptance criteria, allowed paths, relevant revision, and required output format. A subagent does not inherit the main conversation's discoveries unless they are explicitly included or available in project memory.
3. Run frontend/backend agents concurrently only when their write sets are disjoint and shared contracts are already frozen. Use isolated worktrees for concurrent writers and integrate one verified change at a time.
4. Never let two agents edit this plan, the same contract, lockfile, migration, or shared renderer simultaneously.
5. Prefer read-only agents for exploration/review. Background agents must not require interactive permission prompts or user clarification.
6. Require every agent to return a compact handoff: `result`, `changed paths`, `verification`, `risks/blockers`, and `next action`. Do not paste raw logs or full file contents into the main context.
7. Reuse Claude Code's built-in Explore/Plan agents for one-off discovery. Create the custom agents above because their project-specific output/permission contracts recur throughout this plan.

### Language policy for Claude and repository

- Claude's user-facing responses, progress updates, questions, explanations, and final handoffs must be written in Brazilian Portuguese (`pt-BR`). Commands, exact error messages, and source excerpts may remain in their original language, but Claude explains them in Portuguese.
- Everything committed as a technical artifact must be written in English: source identifiers, filenames, directories, comments, tests, fixture names, translation keys, branch names, commit messages, pull-request titles/descriptions, logs, API contracts, database field names, error codes, `CLAUDE.md`, skills, agent definitions, and developer documentation.
- User-facing product copy is the intentional exception: every platform UI string must exist in both `pt-BR` and `en-US` locale resources. Never hardcode visible copy in components.
- Root `CLAUDE.md` must state these rules concisely: respond to the user in `pt-BR`; create all technical artifacts in English; add/update both product locales whenever a task changes UI copy.
- Customer-authored website, blog, form, and CMS content remains exactly as authored. Do not automatically translate or duplicate published-site content in this scope; multilingual customer websites are a separate future feature.

---

## 1. Product goal

Build the first usable version of a visual website builder. A user can register, create projects, add multiple pages, compose each page with free-positioned or structured sections, place text/image/button elements, drag and resize them, edit responsive layouts, upload media, save the structured project to MongoDB, reload it, and open a clean website preview with working internal and external links.

The structured builder JSON is the source of truth:

```text
Builder JSON -> validated immutable published snapshot -> shared public renderer -> platform subdomain / custom domain
```

AI is not needed for rendering or exporting this MVP.

### MVP definition of done

A clean installation can run `npm install` and `npm run dev` from the repository root. The user can complete this flow:

1. Create a project.
2. Create Home and About pages.
3. Add text, image, and button elements.
4. Drag and resize each element.
5. Edit their properties.
6. Link a button to the About page.
7. Save and reload the browser without losing the layout.
8. Open preview mode and navigate between pages.
9. Use undo/redo and keyboard shortcuts.
10. Receive clear loading, saving, success, empty, and error feedback.
11. Use a desktop-class editor to configure responsive behavior and switch between explicit `Preview Desktop` and `Preview Mobile` experiences.
12. Mix free-layout sections with grid/flex sections on the same page.
13. Upload an image and reuse it from the media library.
14. Reuse shared header and footer sections across pages.
15. Activate a blog for the project and manage posts from the main application sidebar.
16. Design one reusable blog listing template and one reusable article template.
17. Add dynamic fields to the article template and have the post editor generate the matching form automatically.
18. Optimize every uploaded raster image into responsive WebP variants in the backend.
19. Configure global, page-specific, and dynamic blog SEO with indexable metadata outputs.
20. Manage multiple client organizations and sites from one agency workspace.
21. Support self-service SaaS accounts through the same tenant model without duplicating the product architecture.
22. Produce fluid responsive layouts that remain valid at arbitrary viewport/container widths, not only three preset canvases.
23. Visit a public SaaS landing page and product roadmap through a dedicated unauthenticated navigation shell, then continue to login or signup.
24. Build accessible contact/lead forms, receive protected submissions, review them in the dashboard, and export them without requiring an external CRM.
25. Create reusable custom CMS collections and render dynamic listing/detail pages for services, portfolio, team, testimonials, FAQ, jobs, locations, and similar business content.
26. Customize essential system pages and preserve changed page/post URLs through safe 301 redirects.
27. Audit the finished site for accessibility, broken links, and visitor-facing usability problems before it is considered ready.
28. Build practical visitor components including FAQ, gallery/lightbox, video, tabs, icon lists, social links, downloads, breadcrumbs, tables, pricing tables, and announcement bars.
29. Add optional internal search across public pages, blog posts, and CMS items while excluding drafts, private, and `noindex` content.
30. Run deterministic performance checks for images, fonts, layout stability, loading priority, and client-side payload before final handoff.
31. Publish an immutable site version to `projectslug.<PLATFORM_ROOT_DOMAIN>`, serve it through one multi-tenant renderer on the Coolify-managed VPS, and roll back atomically.
32. Connect and verify customer-owned custom hostnames through Cloudflare for SaaS with managed SSL while keeping the domain registered with the customer.
33. Switch the complete platform interface between Brazilian Portuguese and US English, persist the choice per user, and retain the selected locale across sessions and workspace switches.

---

## 2. Scope boundaries

### Included

- Project CRUD.
- Email/password authentication with Better Auth.
- Project ownership and authorization by workspace membership and role.
- Page CRUD, duplication, ordering, homepage, and unique slug.
- Desktop-class visual authoring only, with desktop/mobile preview modes and advanced continuous-width responsive controls inside the desktop editor.
- Preview-only builder/template experience on mobile and tablet-class screens; no canvas mutation, drag, resize, property editing, or autosave from that experience.
- Hybrid sections: free positioning or structured grid/flex/columns per section.
- Text, uploaded/image-by-URL, button, section, and container elements.
- Selection, drag, resize, duplicate, delete, z-order, lock, and hide.
- Eight resize handles: four corners and four side midpoints.
- Copy/paste and cut/paste elements.
- Shared header and footer sections.
- Image upload and reusable media library.
- Permanent application dashboard with a left navigation sidebar.
- Public SaaS marketing shell with its own left sidebar, responsive landing page, and public product roadmap.
- Native form builder, secure submission storage, dashboard, provider-neutral notification contract with a development sink, CSV export, UTM fields, consent field, and built-in anti-spam controls.
- General CMS collections, typed custom fields, reusable listing/detail templates, filtering, ordering, and pagination.
- Editable 404, search-results, thank-you, maintenance, and empty-result system pages.
- Automatic page/post slug history plus validated 301 redirect management.
- Full site accessibility audit and semantic/keyboard/contrast safeguards.
- FAQ/accordion, gallery/lightbox, video, tabs, icons/icon lists, divider/spacer, social links, download, breadcrumbs, table, pricing table, and announcement bar elements.
- Optional internal site search across published pages, posts, and CMS items.
- Pre-handoff performance, broken-link, accessibility, and responsive-width audits.
- Optional per-project blog module with post dashboard, drafts, publishing, categories, tags, and SEO fields.
- Visual blog index and article-template builders with dynamic content slots.
- Navigation/menu element with desktop and mobile behavior.
- Mandatory backend image optimization to WebP plus responsive variants.
- Global site SEO settings, page-level SEO, dynamic blog metadata, sitemap, robots rules, and SEO validation feedback.
- Multi-tenant workspace/account model prepared from the first database migration.
- Agency account dashboard with clients, multiple sites per client, campaigns summary, and future analytics placeholders.
- Self-service SaaS onboarding using automatically created personal workspaces.
- Workspace members, roles, invitations, and server-side tenant isolation.
- Complete fluid responsive system with custom breakpoints, constraints, safe CSS units, container queries, continuous-width preview, and layout diagnostics.
- Property inspector.
- Undo/redo.
- Manual save and debounced autosave.
- MongoDB persistence.
- Clean preview route with internal navigation.
- Production publishing with immutable snapshots, route manifests, cache invalidation, rollback, one multi-tenant renderer, direct project subdomains, custom hostname lifecycle, managed SSL, and Coolify/Cloudflare configuration documentation.
- Complete platform internationalization for `pt-BR` and `en-US`, including public marketing/auth routes, authenticated dashboard, builder, settings, validation, empty/loading/error states, accessibility labels, and localized formatting.
- Schema versioning and one renderer shared by preview and published output.
- Unit, integration, API, and one main end-to-end test.

### Explicitly excluded

- AI generation, RAG, embeddings, and Atlas Vector Search.
- Realtime collaboration.
- Payments.
- Arbitrary HTML, CSS, or JavaScript.
- General-purpose template marketplace, animations, and external keyword/backlink/competitor SEO research.
- External CRM, calendar, maps, newsletter, payment, automation, analytics, and marketing-platform integrations.
- Automatic translation or multilingual variants of customer-authored website, blog, form, or CMS content.

The data model must allow future collaboration, templates, AI generation, multiple renderer replicas, and CDN/object-storage migration without requiring a destructive rewrite.

The public roadmap is a product communication page, not a copy of this technical execution plan. It must not expose internal architecture, credentials, security details, unfinished implementation notes, or dates that the product team has not explicitly committed to.

---

## 3. Required stack and fixed technical choices

### Repository

- Canonical remote: `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git` using the remote name `origin`.
- Exactly two long-lived branches: `main` for reviewed production-ready code and `development` for ongoing integration.
- Normal work starts from and merges into `development`. Promote `development` to `main` only through a reviewed pull request after all required checks pass; never commit or force-push directly to `main`.
- Short-lived `task/Px-Ty-short-description` branches and isolated worktrees are allowed only for bounded concurrent or high-risk work. They must branch from and merge back into `development`, then be deleted. They do not count as long-lived branches.
- Production deployment tracks `main`. A staging/preview deployment may track `development`, but it must use isolated environment values and data.
- npm workspaces.
- Root orchestration with `concurrently`.
- Node version documented in `.nvmrc` and `package.json#engines`.
- One root `package-lock.json`.

### Frontend: `frontend/`

- React 19 + TypeScript + Vite.
- Tailwind CSS.
- `react-router` using its current supported browser APIs.
- Zustand for editor/client state.
- Zod for runtime validation and shared contracts.
- Moveable for selection handles, drag, and resize.
- Lucide React for UI and button icons; persist icon names, never JSX/HTML.
- Tiptap for structured blog rich-text editing; persist validated JSON, not arbitrary executable HTML.
- Vitest + React Testing Library.
- Playwright for E2E.
- `better-auth/react` for the authenticated client.
- `i18next` and `react-i18next` for typed, namespace-based product localization.

### Backend: `backend/`

- Node.js + TypeScript + Express 5.
- MongoDB Atlas with the official `mongodb` driver; do not use Mongoose.
- Zod validation.
- Vitest + Supertest.
- Pino for structured application logs.
- Better Auth email/password with the official MongoDB adapter.
- Better Auth Organization plugin for workspace membership, invitations, roles, and active-organization context; pin and verify the stable compatible release before implementation.
- MongoDB GridFS behind a media-storage interface for initial image storage. Keep the interface replaceable by S3/R2 later.
- Sharp/libvips for server-side image decoding, autorotation, metadata stripping, resizing, and WebP generation.

### Shared contracts: `packages/shared/`

Create a small workspace package for framework-independent TypeScript types, Zod schemas, URL rules, and schema version constants used by frontend and backend. It must not depend on React, Express, browser-only code, or database code.

### Architecture decisions

1. The desktop-class editor provides desktop `1440px`, tablet `768px`, and mobile `390px` working presets plus a continuously resizable preview and project-defined custom breakpoints. `Preview Desktop` and `Preview Mobile` are the two primary preview actions; presets are authoring shortcuts, not the only supported widths.
2. Every page is an ordered list of sections. Each section independently selects `free`, `grid`, or `flex` layout mode.
3. A `free` section behaves like an artboard: child elements use logical pixel geometry and remain freely draggable/resizable.
4. A `grid` or `flex` section uses structured CSS layout, but child width, height, min/max size, span, alignment, order, gap, and padding remain editable.
5. Grid/flex is never a global page restriction. A page may mix free, grid, and flex sections.
6. Free-layout elements expose exactly eight resize handles: four corners plus top, right, bottom, and left midpoint handles. Corners resize both axes; side handles resize one axis.
7. Desktop is the initial base value. Smaller/custom breakpoints store explicit overrides and inherit unset values deterministically from the nearest applicable larger rule. The runtime resolves continuously between breakpoint boundaries.
8. React components render the structured model; generated HTML is not stored in MongoDB.
9. The same section/element renderer is used by editor and preview. Editor-only interaction wrappers remain outside the renderer.
10. Client interactions update local state immediately. Persistence occurs on manual save and debounced autosave, never on every drag pixel.
11. Optimistic concurrency uses a numeric project `revision`.
12. Better Auth owns sessions and organization membership. Every business query is scoped first to a verified active `workspaceId`, then to resource/client IDs; never trust a workspace ID merely because the browser supplied it.
13. Agency and self-service SaaS modes use the same data model. An agency workspace has clients and many sites; a personal SaaS workspace may have sites without a client record.
14. Platform-administrator privileges, if added later, remain separate from workspace owner/admin roles and must never be inferred from an agency subscription.
15. Responsive values are structured typed data, never arbitrary user-supplied CSS strings. The renderer serializes only allowlisted units/functions.
16. Free-layout responsiveness uses anchors/constraints plus optional breakpoint overrides; structured layouts use intrinsic grid/flex sizing and container-aware rules.
17. Visual authoring for site pages, blog templates, CMS templates, shared sections, and system pages is desktop-only in this version. Responsive/mobile values are still edited from the desktop editor while previewing the target width.
18. Mobile/tablet access to visual-editor routes is read-only preview. Do not implement a touch editor, mobile inspector drawer, drag/resize alternative, or device-specific document mutation in this scope.
19. One Coolify-managed public renderer serves every published site. Do not create one Docker container or Coolify application per customer site.
20. Every project receives one unique direct platform hostname: `${projectSlug}.${PLATFORM_ROOT_DOMAIN}`. Do not insert `.sites` or another label between the project slug and platform root domain.
21. Reserve infrastructure labels such as `www`, `app`, `api`, `admin`, `origin`, `customers`, `coolify`, `status`, and `mail`; project slugs can never claim a reserved hostname.
22. Draft/autosaved builder state never serves production traffic. Publishing validates the whole site and atomically points the project to one immutable `PublishedSiteVersion`; rollback changes that pointer without rebuilding drafts.
23. The public renderer normalizes the incoming hostname, resolves only an active `SiteDomain`, loads only the active published version, and returns a neutral unknown-domain response for unrecognized/inactive hosts.
24. Cloudflare for SaaS owns customer custom-hostname validation and edge certificate lifecycle. Coolify/Traefik owns the VPS applications, origin routing, health, and origin-side TLS; provider calls remain behind a replaceable `CustomHostnameProvider` interface.
25. The SaaS itself has one user-facing origin: `https://${PLATFORM_ROOT_DOMAIN}`. Marketing, auth, dashboard, builder, settings, and API use paths on this origin; never expose `app.${PLATFORM_ROOT_DOMAIN}` or `api.${PLATFORM_ROOT_DOMAIN}` as product URLs.
26. User-facing route families are `/`, `/roadmap`, `/login`, `/signup`, `/app/*`, and `/api/*`. The production frontend gateway sends `/api/*` to the private backend service and serves the React app for the remaining application routes.
27. `origin.${PLATFORM_ROOT_DOMAIN}` and `customers.${PLATFORM_ROOT_DOMAIN}` are technical routing/DNS hostnames only for the public renderer and Cloudflare for SaaS. They must not appear as normal navigation, login, dashboard, builder, or client-facing project URLs.
28. The platform UI supports exactly `pt-BR` and `en-US` in this version. Translation keys are English, locale resources are separated by feature namespace, and user-visible strings never come from backend exception text.
29. Locale is a user-level preference, not a workspace setting. An authenticated preference is authoritative across workspace switches; before authentication, an explicit local choice wins, then browser/`Accept-Language`, with `en-US` as the final fallback.
30. The frontend translates stable backend error codes and formats dates, numbers, lists, plurals, and relative time with `Intl` using the active locale. Backend logs, diagnostics, identifiers, and contracts remain in English.
31. Changing language updates the current UI immediately, persists through an authenticated preferences endpoint, updates the document `lang` attribute and localized public metadata, and must not mutate or translate builder content.

---

## 4. Target repository structure

```text
project-root/
├── frontend/
│   ├── src/
│   │   ├── api/
│   │   ├── app/
│   │   ├── components/
│   │   │   ├── common/
│   │   │   └── renderer/
│   │   ├── features/
│   │   │   ├── dashboard/
│   │   │   ├── auth/
│   │   │   ├── workspaces/
│   │   │   ├── clients/
│   │   │   ├── campaigns/
│   │   │   ├── projects/
│   │   │   ├── pages/
│   │   │   ├── blog/
│   │   │   │   ├── posts/
│   │   │   │   ├── templates/
│   │   │   │   └── editor/
│   │   │   ├── media/
│   │   │   ├── editor/
│   │   │   │   ├── canvas/
│   │   │   │   ├── elements/
│   │   │   │   ├── inspector/
│   │   │   │   ├── toolbar/
│   │   │   │   └── store/
│   │   │   └── preview/
│   │   ├── hooks/
│   │   ├── i18n/
│   │   │   ├── locales/en-US/
│   │   │   └── locales/pt-BR/
│   │   ├── lib/
│   │   ├── routes/
│   │   ├── styles/
│   │   └── test/
│   ├── e2e/
│   ├── nginx.conf
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── config/
│   │   ├── db/
│   │   ├── middleware/
│   │   ├── modules/projects/
│   │   ├── modules/workspaces/
│   │   ├── modules/clients/
│   │   ├── modules/campaigns/
│   │   ├── modules/blog/
│   │   ├── modules/media/
│   │   ├── modules/publishing/
│   │   ├── modules/domains/
│   │   ├── renderer/
│   │   ├── routes/
│   │   ├── utils/
│   │   ├── app.ts
│   │   ├── server.ts
│   │   └── renderer-server.ts
│   ├── tests/
│   └── package.json
├── packages/
│   └── shared/
│       ├── src/
│       └── package.json
├── CLAUDE.md
├── IMPLEMENTATION_PLAN.md
├── package.json
├── package-lock.json
├── docker-compose.production.yml
├── .env.example
├── .gitignore
├── .nvmrc
└── README.md
```

Avoid empty architectural layers. Create directories when their first real module is added.

---

## 5. Core data contract

Use discriminated unions and Zod schemas. Exact implementation names may vary, but the persisted meaning must remain equivalent.

```ts
type ElementType = "text" | "image" | "button" | "container";
type BreakpointPreset = "desktop" | "tablet" | "mobile";
type BreakpointId = string;
type SectionLayoutMode = "free" | "grid" | "flex";

type BreakpointDefinition = {
  id: BreakpointId;
  name: string;
  maxWidth: number;
  preset?: BreakpointPreset;
  order: number;
};

type NumericLength = {
  value: number;
  unit: "px" | "%" | "vw" | "vh" | "rem" | "em" | "fr";
};

type ResponsiveLength =
  | NumericLength
  | { keyword: "auto" | "min-content" | "max-content" | "fit-content" }
  | { clamp: { min: NumericLength; preferred: NumericLength; max: NumericLength } };

type ResponsiveElementLayout = {
  width: ResponsiveLength;
  height: ResponsiveLength;
  minWidth?: ResponsiveLength;
  maxWidth?: ResponsiveLength;
  minHeight?: ResponsiveLength;
  maxHeight?: ResponsiveLength;
  aspectRatio?: number;
  horizontalConstraint: "left" | "right" | "center" | "stretch" | "scale";
  verticalConstraint: "top" | "bottom" | "center" | "stretch" | "scale";
  visible: boolean;
};

type Geometry = {
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number; // Persist now; UI remains 0 in MVP.
};

type BaseElement = {
  id: string;
  type: ElementType;
  name: string;
  geometry: Geometry;
  responsiveLayout: ResponsiveElementLayout;
  breakpointOverrides?: Partial<Record<BreakpointId, Partial<ResponsiveElementLayout & Geometry>>>;
  zIndex: number;
  locked: boolean;
  hidden: boolean;
};

type TextElement = BaseElement & {
  type: "text";
  content: string;
  style: {
    fontFamily: string;
    fontSize: ResponsiveLength;
    fontWeight: number;
    fontStyle: "normal" | "italic";
    textAlign: "left" | "center" | "right";
    color: string;
    lineHeight: number | ResponsiveLength;
  };
};

type ImageElement = BaseElement & {
  type: "image";
  source: { kind: "url"; url: string } | { kind: "media"; mediaId: string };
  alt: string;
  style: {
    objectFit: "cover" | "contain" | "fill";
    borderRadius: number;
  };
};

type SafeLink =
  | { kind: "internal"; pageId: string }
  | { kind: "external"; url: string; newTab: boolean }
  | { kind: "email"; email: string }
  | { kind: "phone"; phone: string }
  | { kind: "whatsapp"; phone: string; message?: string };

type ButtonElement = BaseElement & {
  type: "button";
  text: string;
  link: SafeLink;
  icon?: { name: string; position: "before" | "after" };
  style: {
    fontSize: ResponsiveLength;
    fontWeight: number;
    textColor: string;
    backgroundColor: string;
    borderRadius: number;
    horizontalAlign: "left" | "center" | "right";
  };
};

type ContainerElement = BaseElement & {
  type: "container";
  layout: SectionLayoutMode;
  children: BuilderElement[];
  layoutByBreakpoint: Partial<Record<BreakpointId, Record<string, unknown>>>;
};

type BuilderElement = TextElement | ImageElement | ButtonElement | ContainerElement;

type BuilderSection = {
  id: string;
  name: string;
  role: "content" | "header" | "footer";
  sharedSectionId?: string;
  layoutMode: SectionLayoutMode;
  heightByBreakpoint: Partial<Record<BreakpointId, ResponsiveLength>>;
  layoutByBreakpoint: Partial<Record<BreakpointId, Record<string, unknown>>>;
  elements: BuilderElement[];
  backgroundColor: string;
  hidden: boolean;
};

type BuilderPage = {
  id: string;
  name: string;
  slug: string; // Homepage uses "/"; others use normalized slugs.
  isHome: boolean;
  order: number;
  canvas: {
    designWidth: 1440;
    minHeight: number;
    backgroundColor: string;
  };
  seo: PageSeoSettings;
  sections: BuilderSection[];
};

type PageSeoSettings = {
  title: string;
  description: string;
  canonicalPath?: string;
  robots: { index: boolean; follow: boolean };
  openGraph?: {
    title?: string;
    description?: string;
    mediaId?: string;
    type?: "website" | "article";
  };
  twitter?: {
    card: "summary" | "summary_large_image";
    title?: string;
    description?: string;
    mediaId?: string;
  };
  structuredDataType?: "WebPage" | "AboutPage" | "ContactPage" | "Article";
};

type SiteSeoSettings = {
  siteName: string;
  titleTemplate: string; // Example: "%s | Site Name".
  defaultDescription: string;
  defaultSocialMediaId?: string;
  locale: string;
  canonicalBaseUrl?: string;
  organization?: { name: string; logoMediaId?: string };
  defaultRobots: { index: boolean; follow: boolean };
  searchConsoleVerification?: string;
};

type MediaVariant = {
  width: number;
  height: number;
  bytes: number;
  mimeType: "image/webp";
  storageKey: string;
};

type MediaAsset = {
  id: string;
  workspaceId: string;
  uploadedByUserId: string;
  originalFilename: string;
  contentHash: string;
  width: number;
  height: number;
  defaultAlt?: string;
  variants: MediaVariant[];
  createdAt: string;
};

type BuilderProject = {
  id: string;
  schemaVersion: 1;
  workspaceId: string;
  clientId?: string;
  createdByUserId: string;
  name: string;
  breakpoints: BreakpointDefinition[];
  pages: BuilderPage[];
  sharedSections: BuilderSection[];
  seo: SiteSeoSettings;
  featureStates: SiteFeatureState[]; // Derived projection for navigation/readiness; actual documents remain the source of truth.
  revision: number;
  createdAt: string;
  updatedAt: string;
};

type SiteFeatureKey = "forms" | "blog" | "cms" | "search";

type SiteFeatureLifecycle = "unused" | "draft" | "needs_setup" | "ready" | "published" | "error" | "archived";

type SiteFeatureState = {
  feature: SiteFeatureKey;
  lifecycle: SiteFeatureLifecycle;
  draftReferenceCount: number;
  publishedReferenceCount: number;
  blockingIssueCount: number;
  warningCount: number;
  sourceRevision: number;
  firstUsedAt?: string;
  lastUsedAt?: string;
  configuredAt?: string;
};

type BlogSettings = {
  enabled: boolean;
  basePath: string; // Default: "/blog"
  indexTemplateId?: string;
  articleTemplateId?: string;
  defaultAuthorName?: string;
};

type BlogFieldType =
  | "shortText"
  | "longText"
  | "richText"
  | "image"
  | "gallery"
  | "link"
  | "date";

type BlogFieldDefinition = {
  id: string; // Stable ID; never derived from the editable label.
  key: string;
  label: string;
  type: BlogFieldType;
  required: boolean;
  helpText?: string;
  defaultValue?: unknown;
};

type DynamicBinding =
  | { source: "system"; field: "title" | "excerpt" | "cover" | "content" | "author" | "publishedAt" | "category" }
  | { source: "custom"; fieldId: string };

type BlogTemplate = {
  id: string;
  projectId: string;
  kind: "index" | "article";
  draftDocument: BuilderPage;
  publishedDocument?: BuilderPage;
  draftVersion: number;
  publishedVersion?: number;
  fieldDefinitions: BlogFieldDefinition[];
  updatedAt: string;
  publishedAt?: string;
};

type BlogPost = {
  id: string;
  projectId: string;
  workspaceId: string;
  createdByUserId: string;
  title: string;
  slug: string;
  excerpt: string;
  content: unknown; // Validated Tiptap JSON document.
  coverMediaId?: string;
  authorName?: string;
  categoryIds: string[];
  tags: string[];
  customFieldValues: Record<string, unknown>; // Keyed by stable BlogFieldDefinition.id.
  status: "draft" | "published";
  seoTitle?: string;
  seoDescription?: string;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type SupportedAppLocale = "pt-BR" | "en-US";

type UserPreferences = {
  userId: string; // Better Auth user ID; globally unique.
  locale: SupportedAppLocale;
  createdAt: string;
  updatedAt: string;
};

type Workspace = {
  id: string;
  name: string;
  slug: string;
  kind: "personal" | "agency" | "business";
  createdByUserId: string;
  createdAt: string;
  updatedAt: string;
};

type WorkspaceRole = "owner" | "admin" | "designer" | "editor" | "viewer";

type ClientAccount = {
  id: string;
  workspaceId: string;
  name: string;
  type: "person" | "company";
  status: "lead" | "active" | "paused" | "archived";
  primaryContact?: { name?: string; email?: string; phone?: string };
  notes?: string;
  createdAt: string;
  updatedAt: string;
};

type CampaignSummary = {
  id: string;
  workspaceId: string;
  clientId?: string;
  projectId?: string;
  name: string;
  status: "draft" | "active" | "paused" | "completed";
  startsAt?: string;
  endsAt?: string;
};

type FormFieldType = "shortText" | "longText" | "email" | "phone" | "select" | "radio" | "checkbox" | "consent" | "hidden";

type FormDefinition = {
  id: string;
  projectId: string;
  workspaceId: string;
  name: string;
  status: "draft" | "needs_setup" | "ready" | "archived";
  fields: Array<{ id: string; type: FormFieldType; label: string; required: boolean; options?: string[]; defaultValue?: string; validation?: Record<string, unknown> }>;
  submitLabel: string;
  successBehavior: { type: "message" | "internalRedirect"; message?: string; pageId?: string };
  notificationRecipients: string[];
  retentionDays?: number;
  createdAt: string;
  updatedAt: string;
};

type FormSubmission = {
  id: string;
  workspaceId: string;
  projectId: string;
  formId: string;
  values: Record<string, unknown>; // Keyed only by stable FormDefinition field IDs.
  source?: { pageId?: string; path?: string; utm?: Record<string, string> };
  status: "new" | "read" | "archived" | "spam";
  createdAt: string;
};

type CmsFieldType = "shortText" | "longText" | "richText" | "number" | "boolean" | "date" | "image" | "gallery" | "link" | "reference";

type CmsCollection = {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  slug: string;
  fields: Array<{ id: string; key: string; label: string; type: CmsFieldType; required: boolean; referenceCollectionId?: string }>;
  listTemplateId?: string;
  detailTemplateId?: string;
  createdAt: string;
  updatedAt: string;
};

type CmsItem = {
  id: string;
  workspaceId: string;
  projectId: string;
  collectionId: string;
  slug: string;
  status: "draft" | "published";
  values: Record<string, unknown>; // Keyed by immutable CmsCollection field IDs.
  seo?: PageSeoSettings;
  publishedAt?: string;
  createdAt: string;
  updatedAt: string;
};

type UrlRedirect = {
  id: string;
  workspaceId: string;
  projectId: string;
  sourcePath: string;
  destination: { type: "internalPage" | "internalPost" | "internalCmsItem" | "externalPath"; targetId?: string; path?: string };
  statusCode: 301;
  automatic: boolean;
  createdAt: string;
};

type SiteDomain = {
  id: string;
  workspaceId: string;
  projectId: string;
  hostname: string; // Lowercase ASCII/Punycode hostname without scheme, port, path, or trailing dot.
  kind: "platform" | "custom";
  status: "pending_dns" | "verifying" | "pending_ssl" | "active" | "failed" | "disconnected";
  isPrimary: boolean;
  provider: "platform_wildcard" | "cloudflare_for_saas";
  providerHostnameId?: string;
  verification?: { method: "cname" | "txt" | "http"; name?: string; value?: string };
  sslStatus?: "pending" | "active" | "failed";
  lastCheckedAt?: string;
  failureCode?: string;
  createdAt: string;
  verifiedAt?: string;
};

type PublishedRouteManifestEntry = {
  path: string;
  kind: "page" | "blogIndex" | "blogPost" | "cmsList" | "cmsItem" | "system";
  resourceId: string;
  statusCode: 200 | 404;
  seo: Record<string, unknown>; // Fully resolved and safely serializable metadata.
};

type PublishedSiteVersion = {
  id: string;
  workspaceId: string;
  projectId: string;
  version: number;
  sourceRevision: number;
  schemaVersion: number;
  document: unknown; // Validated, normalized, self-contained published rendering document.
  routes: PublishedRouteManifestEntry[];
  redirects: Array<{ sourcePath: string; destinationPath: string; statusCode: 301 }>;
  referencedMediaIds: string[];
  contentHash: string;
  createdByUserId: string;
  createdAt: string;
};
```

### MongoDB

Use one `projects` collection for MVP, with pages embedded in their project. This makes loading/saving an editor document atomic and simple. Reevaluate only if document size or collaboration requirements later justify separating pages.

Use separate `blogPosts`, `blogTemplates`, and `blogCategories` collections because posts have an independent publishing lifecycle and must be queried/paginated without loading the entire builder document. Keep custom field values keyed by stable field IDs so renaming a field label never loses content.

Use separate `formDefinitions` and `formSubmissions` collections. Definitions belong to one site; submissions are write-only through a hardened public endpoint and readable only through authorized workspace routes. Store normalized values by stable field ID, minimize collected request metadata, and apply configured retention deletion without external CRM dependencies.

Keep `BuilderProject.featureStates` as a small derived projection used for fast contextual navigation and readiness badges. It is not an independently editable feature flag and must never be trusted as the only source of truth. Recompute it from the saved builder document plus blog/form/CMS/search records after relevant mutations, tag it with `sourceRevision`, and reconcile it again before publication. This prevents stale client booleans from hiding active modules or allowing incomplete ones to publish.

Use separate `cmsCollections`, `cmsItems`, and `cmsTemplates` collections. Keep collection definitions small, item values keyed by immutable field IDs, draft/published lifecycle separate, and references constrained to collections in the same workspace/project. Do not embed growing CMS item lists in the project document.

Use a `urlRedirects` collection for automatic slug history and manual 301 rules. Normalize paths, reject loops/chains where possible, reserve system paths, and keep redirects scoped to one project.

Use separate `siteDomains` and `publishedSiteVersions` collections. Every project gets exactly one platform hostname derived from its unique project slug and `PLATFORM_ROOT_DOMAIN`; custom hostnames are additional mappings. The project stores only an `activePublishedVersionId` pointer and publication summary, while immutable published versions retain the validated render document/route manifest needed for atomic rollback.

Use Better Auth Organization records for workspace membership/invitations/active-organization context, plus application-owned `workspaceProfiles`, `clients`, and optional `campaigns` collections. Every business collection must carry a required `workspaceId`; client-owned records additionally carry `clientId`, and audit-sensitive records carry `createdByUserId`/`updatedByUserId` where appropriate.

Keep the application locale in a separate `userPreferences` collection keyed by the Better Auth user ID. It is intentionally outside workspace ownership so one user keeps the same language while switching clients or workspaces. Do not store this preference in Better Auth internals or reuse `SiteSeoSettings.locale`, which describes a published website rather than the SaaS interface.

Every new signup receives one personal workspace automatically. Agency/business users may create or switch workspaces later. A client record is an agency CRM/container and does not require a login; client portal access can be added later through workspace invitations or a dedicated portal role.

Required indexes:

- `{ workspaceId: 1, updatedAt: -1 }` for authorized project listing.
- `{ workspaceId: 1, clientId: 1, updatedAt: -1 }` for client site listing.
- Media metadata index `{ workspaceId: 1, createdAt: -1 }`.
- Client index `{ workspaceId: 1, status: 1, updatedAt: -1 }`.
- Unique client-safe project slug/name constraints must always include `workspaceId` where uniqueness is intended.
- Unique blog slug index `{ projectId: 1, slug: 1 }`.
- Blog dashboard index `{ projectId: 1, status: 1, updatedAt: -1 }`.
- Public blog query index `{ projectId: 1, status: 1, publishedAt: -1 }`.
- Form definition index `{ workspaceId: 1, projectId: 1, updatedAt: -1 }` and submission dashboard index `{ workspaceId: 1, projectId: 1, formId: 1, createdAt: -1 }`.
- CMS definition index `{ workspaceId: 1, projectId: 1, updatedAt: -1 }`, unique collection slug `{ projectId: 1, slug: 1 }`, unique item slug `{ collectionId: 1, slug: 1 }`, and public item index `{ projectId: 1, collectionId: 1, status: 1, publishedAt: -1 }`.
- Unique redirect source path `{ projectId: 1, sourcePath: 1 }`.
- Global unique normalized hostname `{ hostname: 1 }` plus project domain listing `{ workspaceId: 1, projectId: 1, status: 1 }`.
- Unique publication version `{ projectId: 1, version: 1 }` and publication history `{ projectId: 1, createdAt: -1 }`.
- Unique user preferences index `{ userId: 1 }`.

Database documents use MongoDB `_id: ObjectId`; API contracts expose it as `id: string`. Element and page IDs are application-generated UUIDs.

Updates must require the last known `revision`. A successful save increments it. A stale update returns HTTP `409 REVISION_CONFLICT` without silently overwriting newer data.

---

## 6. API contract

Base path: `/api/v1`.

All authenticated business routes shown below as `/projects`, `/media`, `/clients`, `/campaigns`, or `/dashboard` are mounted beneath `/workspaces/:workspaceId`. Example: table route `/projects/:projectId` means `/api/v1/workspaces/:workspaceId/projects/:projectId`. Middleware must verify organization membership and permission before resolving any nested resource. Public rendering routes remain outside this authenticated prefix.

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/health` | Process/database health |
| `ALL` | `/auth/*` | Better Auth handlers |
| `GET` | `/me/preferences` | Load authenticated user-level preferences, including locale |
| `PUT` | `/me/preferences` | Validate and persist the authenticated user's locale |
| `GET` | `/workspaces` | List current user's workspaces |
| `POST` | `/workspaces` | Create agency/business workspace |
| `GET` | `/dashboard` | Workspace-level counts, recent clients/sites, campaigns, future analytics slots |
| `GET` | `/clients` | List/filter clients |
| `POST` | `/clients` | Create person/company client |
| `GET` | `/clients/:clientId` | Load client summary and sites |
| `PATCH` | `/clients/:clientId` | Update client profile/status |
| `DELETE` | `/clients/:clientId` | Archive client after impact confirmation |
| `GET` | `/campaigns` | List campaign summaries |
| `POST` | `/campaigns` | Create campaign shell linked to client/site |
| `PATCH` | `/campaigns/:campaignId` | Update campaign summary/status |
| `GET` | `/projects` | List project summaries |
| `POST` | `/projects` | Create project with one Home page |
| `GET` | `/projects/:projectId` | Load complete builder document |
| `PATCH` | `/projects/:projectId` | Rename project |
| `PUT` | `/projects/:projectId/document` | Validate and save complete builder document with revision |
| `GET` | `/projects/:projectId/status` | Return reconciled feature lifecycle, persistent setup issues, draft/published state, and publication readiness |
| `DELETE` | `/projects/:projectId` | Delete project |
| `GET` | `/media` | List current workspace media |
| `POST` | `/media` | Validate and upload image |
| `GET` | `/media/:mediaId/content` | Stream owned image safely |
| `DELETE` | `/media/:mediaId` | Delete unused owned media |
| `GET` | `/projects/:projectId/seo` | Load global site SEO settings |
| `PUT` | `/projects/:projectId/seo` | Validate/update global site SEO settings |
| `GET` | `/projects/:projectId/seo/audit` | Return deterministic SEO checklist for pages/blog |
| `GET` | `/public/projects/:projectId/sitemap.xml` | Generate sitemap from indexable pages/posts |
| `GET` | `/public/projects/:projectId/robots.txt` | Generate project robots directives and sitemap link |
| `GET` | `/projects/:projectId/blog/settings` | Load blog settings |
| `PUT` | `/projects/:projectId/blog/settings` | Enable/configure blog |
| `GET` | `/projects/:projectId/blog/posts` | List/filter/paginate owned posts |
| `POST` | `/projects/:projectId/blog/posts` | Create draft post |
| `GET` | `/projects/:projectId/blog/posts/:postId` | Load owned post |
| `PUT` | `/projects/:projectId/blog/posts/:postId` | Validate and update post |
| `POST` | `/projects/:projectId/blog/posts/:postId/publish` | Publish valid post |
| `POST` | `/projects/:projectId/blog/posts/:postId/unpublish` | Return post to draft |
| `DELETE` | `/projects/:projectId/blog/posts/:postId` | Delete owned post |
| `GET` | `/projects/:projectId/blog/templates/:kind` | Load index/article template |
| `PUT` | `/projects/:projectId/blog/templates/:kind/draft` | Save template draft |
| `POST` | `/projects/:projectId/blog/templates/:kind/publish` | Validate impact and publish template |
| `GET` | `/public/projects/:projectId/blog/posts` | List published posts for site renderer |
| `GET` | `/public/projects/:projectId/blog/posts/:slug` | Resolve one published post |
| `GET/POST/PUT/DELETE` | `/projects/:projectId/forms[/:formId]` | Manage owned draft/ready/archived form definitions with idempotent first-use creation |
| `POST` | `/public/projects/:projectId/forms/:formId/submissions` | Validate and receive a rate-limited public submission |
| `GET` | `/projects/:projectId/forms/:formId/submissions` | Filter/paginate authorized submissions |
| `PATCH` | `/projects/:projectId/forms/:formId/submissions/:submissionId` | Mark read/archive/spam |
| `GET` | `/projects/:projectId/forms/:formId/submissions.csv` | Stream authorized CSV export safely |
| `DELETE` | `/projects/:projectId/forms/:formId/submissions/:submissionId` | Delete one owned submission |
| `GET/POST/PUT/DELETE` | `/projects/:projectId/cms/collections[/:collectionId]` | Manage CMS collection definitions |
| `GET/POST/PUT/DELETE` | `/projects/:projectId/cms/collections/:collectionId/items[/:itemId]` | Manage, filter, and paginate CMS items |
| `POST` | `/projects/:projectId/cms/collections/:collectionId/items/:itemId/publish` | Publish a valid CMS item |
| `POST` | `/projects/:projectId/cms/collections/:collectionId/items/:itemId/unpublish` | Return CMS item to draft |
| `GET/PUT` | `/projects/:projectId/cms/collections/:collectionId/templates/:kind` | Load/save list or detail template draft |
| `POST` | `/projects/:projectId/cms/collections/:collectionId/templates/:kind/publish` | Validate impact and publish CMS template |
| `GET` | `/public/projects/:projectId/cms/:collectionSlug` | Query published items for dynamic lists |
| `GET` | `/public/projects/:projectId/cms/:collectionSlug/:itemSlug` | Resolve one published CMS item |
| `GET/POST/PUT/DELETE` | `/projects/:projectId/redirects[/:redirectId]` | Manage validated project 301 redirects |
| `GET` | `/public/projects/:projectId/search` | Search only public/indexable pages, posts, and CMS items |
| `GET` | `/projects/:projectId/site-audit` | Run/return accessibility, link, responsive, SEO, and performance findings |
| `GET` | `/projects/:projectId/publication` | Load current published version, platform URL, domains, and history summary |
| `POST` | `/projects/:projectId/publish/validate` | Build deterministic preflight report without changing live traffic |
| `POST` | `/projects/:projectId/publish` | Create immutable version and atomically activate it |
| `POST` | `/projects/:projectId/publish/rollback/:versionId` | Atomically reactivate an owned compatible version |
| `GET` | `/projects/:projectId/published-versions` | Paginate authorized publication history |
| `GET` | `/projects/:projectId/domains` | List platform/custom domains and DNS/SSL status |
| `POST` | `/projects/:projectId/domains` | Add and start verification for one custom hostname |
| `POST` | `/projects/:projectId/domains/:domainId/verify` | Refresh provider/DNS/SSL status idempotently |
| `PATCH` | `/projects/:projectId/domains/:domainId` | Set active domain as primary |
| `DELETE` | `/projects/:projectId/domains/:domainId` | Disconnect custom hostname and provider certificate mapping |
| `GET` | `/public/resolve/*` | Internal renderer resolution only; host-derived public content must not trust a client-supplied project ID |

Page and element editing happens locally and is persisted through the complete document endpoint. Do not add many fine-grained endpoints that create inconsistent partial updates during MVP.

Success envelope:

```json
{ "data": {} }
```

Error envelope:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Readable summary",
    "details": []
  }
}
```

Use correct status codes: `200`, `201`, `202`, `204`, `400`, `404`, `409`, `413`, `421`, `422`, `429`, `502`, `503`, and `500` as appropriate. Never return stack traces, provider secrets/responses, or internal database details to the browser.

---

## 7. Navigation architecture and editor behavior

### Public SaaS shell

- Unauthenticated marketing routes use a dedicated public shell with a persistent left sidebar on desktop.
- For the initial version, the public sidebar contains the product logo/name and exactly two primary navigation destinations: `Home` and `Roadmap`.
- The sidebar also provides secondary `Log in` and primary `Create account` actions. These actions are authentication entry points, not additional marketing navigation pages.
- Suggested public routes:
  - `/` — SaaS landing page.
  - `/roadmap` — public product roadmap.
  - `/login` — authentication entry.
  - `/signup` — account creation entry.
- The landing page should contain, in this order: hero with one clear value proposition and CTA, visual builder explanation/demo area, core benefits, feature summary, agency and self-service use cases, simple three-step workflow, roadmap preview, FAQ, final CTA, and footer with essential legal placeholders.
- Copy must describe only features that exist or clearly label future functionality. Do not present roadmap items as already available.
- The Roadmap page uses a typed local data source for the MVP so cards are not duplicated in JSX. Each item has stable ID, title, concise public description, status, category, optional target period, and display order.
- Initial roadmap statuses are `Released`, `In progress`, `Planned`, and `Under consideration`. Do not show an exact delivery date unless one was explicitly configured.
- The Roadmap page supports status sections or filters, a visible legend, empty states, accessible status text in addition to color, and a CTA back to signup or the landing page.
- The public shell must be fully responsive. On small screens, the left sidebar becomes an accessible drawer triggered from a public top bar; it must support keyboard use, focus trapping, Escape to close, active-route indication, and restored focus.
- Login/signup pages may use a reduced authentication layout that retains the public brand and a link back to Home. They do not mount the authenticated application sidebar.
- If an authenticated user visits a public route, keep the public page available but replace the signup emphasis with an `Open dashboard` action.
- Provide a compact language selector in the public shell so an unauthenticated visitor can switch between `Português (Brasil)` and `English (United States)`. Persist that explicit choice locally and apply it to Home, Roadmap, login, and signup without requiring an account.

### Shell separation rules

- Implement `PublicShell` and `AuthenticatedAppShell` as separate layout-route components; do not build one sidebar full of authentication conditionals.
- Public routes never render the authenticated workspace sidebar.
- `/app/*` routes never render the public sidebar.
- Only one left navigation shell may be mounted at a time.
- The builder's right control panel is contextual editor UI, not a third application navigation shell.
- Route guards must send unauthenticated `/app/*` visitors to login while preserving a validated internal return path; successful authentication returns them there or to their workspace dashboard.

### Permanent application shell

- After authentication, the application uses a permanent left sidebar on workspace, client, site, and management routes.
- The sidebar header contains a workspace switcher. Agency/business workspaces and a user's personal SaaS workspace use the same shell.
- Workspace-level navigation: Dashboard, Clients, All Sites, Campaigns, Media, Team, and Settings.
- `Settings -> Language` contains the authenticated selector for `Português (Brasil)` and `English (United States)`. Switching is immediate, remains active across workspace changes, and is persisted to the user account through `/api/v1/me/preferences`.
- Inside a selected site, the always-visible core navigation contains Site, Pages, SEO, Site Audit, Publish, Domains, and site-specific Settings while retaining the workspace sidebar.
- Optional management modules are contextual: Forms, Blog, CMS, Search, and future modules appear in the site portion of the left sidebar only after real saved usage or explicit activation. Merely browsing or selecting a block in the right Elements library must not activate a module.
- There are three dashboard levels:
  - Workspace dashboard: all clients/sites, totals, recent activity, campaign summaries, storage usage, and future analytics widgets.
  - Client dashboard: client profile, all sites for that client, campaigns, recent activity, and aggregate future traffic.
  - Site dashboard: site status, pages, CMS, blog, forms/submissions, SEO/readiness issues, recent changes, campaigns linked to that site, and future page-access analytics.
- A personal SaaS workspace may hide the Clients navigation until the user creates a client or upgrades; sites may belong directly to the workspace with no `clientId`.
- `Site` opens page/site management and provides `Edit in builder` actions.
- Optional modules may be activated from their relevant builder block, Site settings, or an intentional setup flow. Once active, `Blog` opens its post dashboard, `CMS` opens collections/items and dynamic templates, `Forms` opens definitions/submissions, and `Search` opens index/result settings. `Site Audit` consolidates accessibility, link, responsive, SEO, and performance findings; `Publish` owns preflight/history/rollback; `Domains` owns the direct platform URL and customer hostname lifecycle.
- `Media` opens the reusable asset library.
- The left sidebar remains visible while editing the site or blog templates on desktop; it may collapse to icons but must not be replaced by the builder controls.
- On small application viewports it may become an accessible drawer.
- Every shell, navigation item, inspector label, validation message, notification, empty/loading/error state, dialog, and accessibility label uses locale resources. Translation namespaces are organized by `common`, `auth`, `public`, `dashboard`, `builder`, `settings`, `forms`, `blog`, `cms`, `publish`, and `errors`; tasks that add user-facing copy must update both locales in the same change.
- Suggested routes:
  - `/app/:workspaceId/dashboard`
  - `/app/:workspaceId/clients`
  - `/app/:workspaceId/clients/:clientId`
  - `/app/:workspaceId/sites`
  - `/app/:workspaceId/sites/:projectId/dashboard`
  - `/app/:workspaceId/sites/:projectId/builder/:pageId`
  - `/app/:workspaceId/sites/:projectId/blog`
  - `/app/:workspaceId/sites/:projectId/blog/posts/new`
  - `/app/:workspaceId/sites/:projectId/blog/posts/:postId/edit`
  - `/app/:workspaceId/sites/:projectId/blog/design/index`
  - `/app/:workspaceId/sites/:projectId/blog/design/article`
  - `/app/:workspaceId/sites/:projectId/cms`
  - `/app/:workspaceId/sites/:projectId/cms/:collectionId/items`
  - `/app/:workspaceId/sites/:projectId/cms/:collectionId/design/list`
  - `/app/:workspaceId/sites/:projectId/cms/:collectionId/design/detail`
  - `/app/:workspaceId/sites/:projectId/forms`
  - `/app/:workspaceId/sites/:projectId/forms/:formId/submissions`
  - `/app/:workspaceId/sites/:projectId/redirects`
  - `/app/:workspaceId/sites/:projectId/audit`
  - `/app/:workspaceId/sites/:projectId/publish`
  - `/app/:workspaceId/sites/:projectId/domains`
  - `/app/:workspaceId/media`
  - `/app/:workspaceId/campaigns`
  - `/app/:workspaceId/team`
  - `/app/:workspaceId/settings`

### Contextual feature activation and persistent site status

- Keep feature discovery separate from feature administration. Optional block types such as Form remain visible and searchable in the right builder `Elements` library so they can be added. Their long-lived management entry appears in the permanent left site sidebar only after the module is actually used or explicitly activated.
- Drive navigation from the reconciled `SiteFeatureState` projection, never a browser-only toggle. Actual saved page/template references and module records remain the source of truth. Update the projection after project autosave, form/blog/CMS/search mutations, restore/archive actions, and before publish.
- Use lifecycle states `unused`, `draft`, `needs_setup`, `ready`, `published`, `error`, and `archived`. Contextual navigation is visible for `draft`, `needs_setup`, `ready`, `published`, and actionable `error`; it is hidden for `unused`. Archived data stays reachable through `Settings -> Archived/unused features` so hiding a module can never erase access to historical records.
- Show a status badge beside each visible optional module: `Setup required`, blocker count, warning count, or a neutral ready state. Sidebar visibility changes only after a committed placement/activation, not pointer hover, drag start, or failed drop.
- Adding the first Form block is one recoverable user action:
  1. Create an idempotent draft `FormDefinition` with stable IDs and a setup status.
  2. Insert a Form element that references that definition and optimistically reveal Forms in the left sidebar.
  3. Autosave the builder document and reconcile the backend feature projection. A failed document save retains/retries the local change and must not falsely mark the module ready.
  4. Open the selected Form element's right inspector for instance-level content, style, layout, responsive behavior, field presentation, and a prominent `Finish form setup` action.
  5. Use the Forms management route for long-lived concerns such as definition name, complete field schema, success behavior, submissions, retention, and future notification configuration. Preserve a validated internal `returnTo` destination containing the originating page and element so Back returns to the same builder context.
- The existing autosaved project document is the site draft; do not create a second full temporary copy of the site. A form definition created during first use is also a durable draft, while the current immutable published site snapshot remains unchanged until a successful publication.
- A draft form becomes `ready` only when its configured checklist passes: it has at least one valid enabled field, stable accessible labels, valid option/validation data, a submit label, and a complete success behavior with no missing internal destination. Automatic security defaults such as honeypot/rate limiting are backend concerns and must not burden the basic setup screen.
- Removing a form instance is reference-aware. If it was the last draft reference and the definition has no submissions or published references, offer to delete the unused draft or keep it archived. If it has submissions, history, or a published reference, never delete data silently: archive/hide it from primary navigation only when no active references remain and keep recovery/history under Settings.
- Apply the same activation contract to Blog, CMS, and Search: Blog appears after explicit activation or a committed blog route/template use; CMS after the first saved collection/dynamic binding; Search after a search element is placed or site search is intentionally enabled. Unused optional modules create neither navigation clutter nor publication warnings.
- Add one non-obstructive `Site status` pill in the authenticated builder/top bar. It shows `Draft`, `Setup required (N)`, `Ready to publish`, `Publishing`, `Published`, `Unpublished changes`, or `Publish failed`. This is persistent state, not a disposable toast.
- Clicking the status pill opens an accessible popover/status center with blockers and warnings grouped by module/page, severity, affected resource, and a deep-link action such as `Finish form setup`. It must not cover essential canvas controls, must restore focus, and remains available in read-only mobile preview. Use toasts only for transient save success/failure.
- Publication validation consumes the same reconciled issue registry shown in the status center. Only deterministic required issues block publication; warnings and manual-review items remain visible but do not block. An incomplete module with a saved live reference blocks; an unused module does not.
- Direct navigation to an authorized but unused optional-module route shows a clear onboarding/activation state rather than a 404, but it does not make the left-sidebar entry visible until activation is confirmed.

### Dashboard information architecture

- Workspace dashboard cards: active clients, total sites, sites in draft/published/error states, total pages, published blog posts, open SEO issues, media storage, active campaigns, and recent activity.
- Workspace lists: recently edited sites, clients needing attention, active/upcoming campaigns, and sites with SEO/publishing problems.
- Client dashboard cards: sites, pages, campaigns, blog posts, SEO issues, and—when analytics exists—combined visits and top-performing site.
- Site dashboard cards: site status, last publish/update, total pages, draft/published pages, posts, SEO health, linked campaigns, and future visits/unique visitors.
- Page table: page name, slug, status, last update, SEO warning count, and future views/unique visitors.
- Campaign summary in this phase is lightweight management data (name, client/site, status, dates, optional notes), not an advertising-platform integration.
- Analytics cards must use an explicit `Not connected`/`No data yet` state until a real analytics provider or first-party event pipeline is implemented. Never display fabricated zeros as measured traffic.
- Dashboard aggregate endpoints should calculate authorized server-side counts efficiently and must not return full builder documents merely to count pages.

### Application pages versus overlays

- Give each primary workflow a dedicated route/page rather than stacking unrelated management screens into one dashboard: dashboard, clients, sites, pages/builder, CMS, blog, forms/submissions, SEO, redirects, site audit, media, campaigns, team, and settings.
- Use nested routes or stable tabs for subsections that users may bookmark or revisit, such as site settings, CMS collection items/templates, form submissions, and SEO categories.
- A route/page owns long-lived work, large tables, multi-step editing, filters, pagination, and data that should survive refresh/back/forward navigation.
- A modal dialog owns only a short blocking decision or focused transient task. A popover owns a compact anchored choice. A drawer/sheet is the responsive form of an existing panel, not a substitute for missing information architecture.
- Do not open normal pages inside nested modals. Never stack more than one modal dialog; close/resolve the current dialog before opening another.
- Preserve route, filters, pagination, panel mode, and appropriate scroll position when users return from a detail page.

### Layout

- The permanent application sidebar remains on the left.
- Top bar: project name, save state, undo, redo, preview.
- Center: scrollable workspace containing the scaled desktop canvas.
- Right control panel: pages, element library, and property inspector organized into clear tabs or modes.
- Do not create a second builder-specific left sidebar. The canvas must occupy the center and builder editing controls remain on the right.
- When an element is selected, the right panel opens its property inspector. When nothing is selected, it shows the currently chosen Pages or Elements view and the relevant page/project settings.

### Right builder panel state machine

- The right builder panel is one fixed visual region with explicit mutually exclusive modes: `Pages`, `Elements`, `Layers`, `Page settings`, `Section inspector`, and `Element inspector`.
- The panel keeps a stable desktop width so selecting an element never resizes or horizontally jumps the canvas. Changing modes replaces only the panel content.
- When nothing is selected, show the last non-inspector mode the user intentionally opened. Persist that mode per editor session.
- Clicking an editable element on the canvas or in Layers selects it, raises its `Element inspector`, and remembers the previous non-inspector mode for return.
- Selecting another element replaces the inspector immediately with the new element's settings; do not briefly show Pages/Elements or lose canvas scroll/zoom.
- The inspector header contains a Back action, element icon/type, editable display name, and compact actions for duplicate, lock/unlock, hide/show, and delete. Destructive delete confirmation is required only when the element owns nested content or referenced data; ordinary element deletion remains undoable.
- Back, clicking empty canvas, or `Escape` clears selection and returns to the remembered prior panel mode. `Escape` exits inline editing before it clears the selection.
- Selecting a section opens `Section inspector`; selecting an element inside it opens `Element inspector`. Provide a breadcrumb such as `Page / Section / Button` so the user can move to a parent without hunting on the canvas.
- Inspector content is grouped consistently as `Content`, `Style`, `Layout`, `Responsive`, and `Advanced`. Show only relevant groups/controls for the selected type; do not display disabled controls that can never affect it.
- `Content`: visible text/data, image/media, icon, links, form/CMS bindings, labels, and semantic purpose.
- `Style`: typography, text/color/background, border, radius, shadow, opacity, and state styles where supported.
- `Layout`: width/height, position, margin/padding, alignment, grid/flex child rules, z-index, min/max, aspect ratio, and overflow where valid.
- `Responsive`: current breakpoint/container context, inherited/base value badges, overrides, visibility, fluid sizing, and reset-to-inherited actions.
- `Advanced`: lock/hide, accessible name/alt/semantic tag, element display name, and safe IDs/data needed by the builder. Never expose arbitrary HTML/CSS/JavaScript.
- Inspector changes update the canvas live. Text/input editing, sliders, color drags, and other continuous controls create one undo history transaction when the interaction is committed, not one entry per keystroke/pointer event.
- Preserve the open inspector group and its scroll position while the same element remains selected. Switching element type may reset only groups that do not exist for the new type.
- Do not render the editable right panel on mobile/tablet-class visual-editor access. Those routes use the preview-only experience defined below; a future touch editor may revisit a drawer/sheet inspector as a separate scoped project.

### Canvas selection feedback

- Every selected element receives a high-contrast editor-only outline that never appears in preview/public rendering. The outline color must remain visible against light and dark content.
- Show a small editor-only label with element display name/type near the selection when space permits; avoid covering the element's editable text or important controls.
- Free-layout selection shows the existing eight resize handles. Structured grid/flex children show only interactions valid for their layout context and never imply free positioning when it is not available.
- Hovering an unselected editable element shows a lighter outline; selected outline always wins. Parent/section boundaries may be shown subtly when needed to explain nesting.
- Locked elements cannot be moved/resized. They remain selectable from Layers so the user can inspect or unlock them, and their locked state is visibly indicated.
- Hidden elements remain absent from preview/public rendering but appear in Layers with a hidden indicator and can be selected there for recovery.

### Popovers, dialogs, and pickers

- Use anchored popovers for compact reversible choices: color picker, font chooser, icon chooser, alignment, unit selector, and small state menus. Close on outside click or `Escape` and return focus to the trigger.
- Use modal dialogs only for focused blocking tasks: destructive confirmations with material impact, page/section layout conversion warning, CMS/blog template impact report, redirect conflict resolution, keyboard-shortcut help, and unsaved-navigation conflict.
- Use a large dialog or responsive drawer for reusable resource pickers such as Media Library and internal-link/page selection when the choice requires search, filters, previews, or pagination.
- Creating/renaming a simple page, element, section, category, or collection should prefer inline/right-panel forms. Use a dialog only when the action requires several fields or an impact decision.
- All dialogs require an accessible title, description when necessary, initial focus, focus trap, `Escape` behavior unless a non-dismissible operation is actively running, explicit cancel/confirm actions, loading/error state, and focus restoration.
- Render overlays through one application portal/layer manager with documented z-index levels. Prevent popovers from appearing behind the canvas or dialogs and never allow background shortcuts to act while a modal is open.

### Visitor-facing content capabilities

- Forms are builder elements backed by stable `FormDefinition` records. Designers arrange fields visually, but submission validation is derived from the same shared schema on client and server.
- Native form delivery is sufficient for this scope: store submissions, show them in the authorized dashboard, expose a provider-neutral notification adapter with a development sink, and export CSV. Do not connect an external email provider, CRM, calendar, newsletter, automation, or payment service in this phase.
- Public form endpoints use strict payload/field limits, origin/project checks, honeypot, per-IP/per-form rate limits, duplicate suppression, safe text normalization, and generic responses that do not reveal internal recipients or storage state.
- CMS collections use schema-driven fields and reusable list/detail templates. Blog remains a specialized editorial module; do not force blog posts into the general CMS or duplicate the builder renderer.
- Initial CMS presets may accelerate Services, Portfolio, Team, Testimonials, FAQ, Jobs, Locations, and simple Catalogs, but presets create ordinary editable collections rather than hardcoded product types.
- CMS reference fields are single-reference in the first implementation. Multi-reference, deeply nested relationships, and arbitrary queries remain future work.
- Dynamic list elements support collection, filters, sort, limit, pagination, empty state, and one reusable card sub-layout. Dynamic detail templates bind elements to one item using stable field IDs.
- System pages use the same renderer and builder controls where safe. Provide editable 404, search results, thank-you, maintenance, and generic empty-result templates with protected system bindings.
- Changing a page, blog-post, or CMS-item slug offers/creates an automatic 301 from the old path. Redirect validation rejects self-redirects, loops, conflicting source paths, dangerous external URLs, reserved routes, and destinations outside the current project unless explicitly represented as a safe path.
- Internal search is opt-in per site and indexes only public/indexable textual content from pages, published posts, and published CMS items. It excludes drafts, disabled modules, password/private content, hidden fields, and `noindex` routes.
- Search results expose title, excerpt, type, and safe internal destination; query length, pagination, highlighting, and resource use are bounded. Search does not promise semantic/vector behavior.
- Essential visitor elements: form, icon, icon list, divider, spacer, FAQ/accordion, tabs, gallery/lightbox, video, social links, download button, breadcrumbs, table, pricing table, and announcement bar.
- Gallery/lightbox, accordion, tabs, menu, search, and announcement bar must be keyboard-operable, expose correct semantics/ARIA, restore focus, support reduced motion, and remain usable at touch sizes.
- Video supports safe provider URLs or owned media only; do not accept arbitrary iframe/HTML/JavaScript. Downloads must reference owned media or validated safe links.

### Site readiness audit

- Provide one consolidated site-readiness report with severity, affected route/element, explanation, and direct editor destination when possible.
- Accessibility checks cover semantic landmarks, heading order, accessible names, alt text, field labels/instructions/errors, keyboard reachability, focus indication/order, contrast, touch target size, language, reduced motion, and dialog behavior. Automated checks must clearly identify manual review items and never claim guaranteed legal compliance.
- Link checks cover missing internal IDs, redirect loops, unsafe protocols, orphan system routes, and optionally reachable external URLs only when network access is explicitly enabled for the audit.
- Performance checks cover responsive image variants, dimensions, loading priority, lazy loading, font count/weight strategy, render-blocking resources, layout-shift risks, excessive element/page payload, and client JavaScript budget.
- Run responsive audits at configured breakpoints plus intermediate widths from `320–1920px`, reusing the existing layout diagnostics rather than inventing a separate resolver.
- Findings never silently modify the site. Safe one-click fixes may be offered only when deterministic and undoable.

### Element defaults

- Text: `320 x 64`, readable placeholder text.
- Image: `400 x 260`, safe placeholder URL or empty-image state.
- Button: `180 x 48`, text `Button` and unconfigured-link state.
- Add new elements near the visible canvas center with a unique ID and topmost z-index.

### Interactions

- Single selection in MVP.
- Free-layout elements show a Photoshop/Illustrator-style selection box with eight visible handles: four corner handles and four side handles.
- Dragging a corner handle changes width and height. Dragging a side handle changes only the corresponding axis.
- Buttons, text, images, and containers can be resized manually; presets or grid rules must never force a button to full-screen width in a free section.
- Enforce sensible minimum dimensions but do not impose arbitrary full-width sizing.
- Drag and resize commits one history entry at interaction end, not on every movement event.
- Locked elements render but cannot be selected through normal canvas interaction or moved/resized.
- Hidden elements are excluded from preview and visually indicated in the editor layer/panel.
- Delete and duplicate selected element.
- Bring forward/send backward with normalized z-index values.
- Double-click text to enter inline editing; inspector remains an alternative.
- Copy, cut, and paste selected elements with new IDs and a small positional offset. Clipboard operations must work inside the app even when browser clipboard permission is unavailable.
- Input focus prevents Delete/Backspace and undo shortcuts from hijacking typing.

### Hybrid section layout

- A page is composed of reorderable vertical sections.
- Each section independently chooses `free`, `grid`, or `flex` mode.
- In a free section, elements may overlap and are positioned/resized manually with the eight handles.
- In a grid section, users configure columns, rows, gap, padding, alignment, and per-child span; elements are dragged into grid cells/areas.
- In a flex section, users configure direction, wrap, gap, justification, alignment, padding, and child order/grow/shrink/basis.
- Containers can be nested with a conservative documented depth limit to prevent pathological documents.
- Converting a populated section between free and structured modes must show a warning and use a deterministic conversion strategy; never silently destroy positions.
- The renderer must support mixed layout modes on the same page.

### Responsive editing

- Responsive authoring happens only inside the desktop-class editor. The user may configure mobile/tablet/custom breakpoint overrides there; “mobile responsive” describes the resulting website, not an editor that runs on a phone.
- The desktop editor top bar exposes two primary actions: `Preview Desktop` and `Preview Mobile`. Desktop preview uses the configured desktop/base width; Mobile preview defaults to `390px` or a configured mobile width. Both open clean renderer-only preview without editor chrome.
- Keep tablet/custom widths as advanced responsive tools behind the numeric width/preset control; do not compete visually with the two primary Desktop/Mobile preview actions.
- Desktop-class responsive controls provide desktop/tablet/mobile presets, custom breakpoints, a numeric width input, and draggable preview edges for continuous widths (target test range `320–1920px`).
- Users may add, rename, reorder, and remove safe custom max-width breakpoints; the system prevents duplicate/ambiguous ranges and preserves default presets.
- Desktop values are the initial base. Breakpoint overrides inherit deterministically from the nearest applicable larger rule until explicitly changed.
- The inspector indicates base, inherited, fluid, and overridden values and can reset any override.
- Safe length controls support `px`, `%`, `vw`, `vh`, `rem`, `em`, `fr` where semantically valid; `auto`, intrinsic keywords, min/max constraints, and structured `clamp(min, preferred, max)` are supported without arbitrary CSS input.
- Sizing modes expose fixed, fill/stretch, hug/intrinsic, min/max, and fluid/clamp behavior.
- Free sections support horizontal constraints (left, right, center, stretch, scale) and vertical constraints (top, bottom, center, stretch, scale), plus explicit breakpoint overrides when constraints are insufficient.
- Free elements support aspect-ratio lock, min/max size, percentage positioning/sizing where valid, and breakpoint-specific visibility.
- Grid supports `auto-fit`/`auto-fill`, `minmax`, responsive column counts, implicit rows, gaps, spans, alignment, and overflow-safe child minimums.
- Flex supports wrap, direction changes, grow/shrink/basis, order, gap, min/max sizing, and responsive alignment.
- Containers may opt into container-query rules so reusable components respond to their actual container width instead of only the viewport.
- Typography supports responsive `clamp()` font sizes and line-height/spacing overrides.
- Images support responsive `srcset`/`sizes`, breakpoint-specific object position/focal point, optional art-direction source override, aspect ratio, and explicit dimensions.
- Navigation supports configurable collapse width and mobile drawer/hamburger behavior at continuous widths.
- Preview switches presets or resizes freely and must use the exact same breakpoint/container resolver as the editor and public renderer.
- Responsive diagnostics detect horizontal overflow, clipped content, impossible min/max constraints, off-canvas free elements, unintended overlap, unreadably small text/tap targets, and missing breakpoint assets.
- Diagnostic warnings identify the exact section/element and affected width range; warnings do not silently mutate user layout.

### Desktop-only authoring and mobile preview

- Site-page builder, blog index/article template builder, CMS list/detail template builder, shared header/footer editor, form visual layout, and system-page templates are authoring surfaces and require a desktop-class editing environment in this release.
- Treat the authoring gate as a product capability check, not a security boundary. Enforce it in the route layout and UI; all actual mutation endpoints still require normal authentication, authorization, schema validation, and revision checks.
- The initial desktop-class gate requires a sufficiently wide editing viewport (default minimum `1024px`) and a fine primary pointer. Keep the threshold configurable and do not depend on user-agent detection alone. Tablet/touch-first devices remain preview-only by default even when their screen is large.
- If a desktop window becomes narrower than the authoring minimum while editing, pause canvas interactions and show a non-destructive `Increase your window size to continue editing` gate. Preserve local unsaved state, zoom, selection, and panel state; do not silently save responsive changes or discard work.
- On mobile/tablet-class access to any visual-editor route, do not mount Moveable, selection layers, property inspectors, drag/drop, resize, inline editing, mutation shortcuts, autosave, or document write actions.
- Instead show the project/template name, current page selector, saved-version timestamp, an explanation that editing is available on desktop, and two preview choices: `Mobile preview` and `Desktop preview`.
- `Mobile preview` renders the clean site at the actual available mobile viewport while using the same production responsive resolver. `Desktop preview` renders the configured desktop width scaled to fit with an optional pan/zoom/fullscreen control; scaling must never change the document or pretend to be a mobile layout.
- Preview-only mode allows navigation through working menus, internal links, pages, published/draft preview data according to permission, and rotating/reloading the viewport. It must not expose editor chrome or mutate content.
- Non-canvas management screens such as dashboard, submission viewing, post/CMS tables, and audit reports may remain responsive where already planned. This restriction specifically blocks visual layout/template authoring; adding mobile content-management edits later requires an explicit product decision.
- Show a clear `Continue editing on a computer` message rather than disabled controls. Never imply that a phone user can edit by requesting desktop browser mode.

### Keyboard shortcuts

- `Delete` / `Backspace`: delete selection outside editable controls.
- `Ctrl/Cmd + D`: duplicate selection.
- `Ctrl/Cmd + C`: copy selection.
- `Ctrl/Cmd + X`: cut selection.
- `Ctrl/Cmd + V`: paste selection.
- `Ctrl/Cmd + Z`: undo.
- `Ctrl/Cmd + Shift + Z` and `Ctrl/Cmd + Y`: redo.
- `Ctrl/Cmd + S`: save.
- `Escape`: exit inline editing or clear selection.

### State and history

Zustand store slices:

- document: project/pages/elements;
- UI: current page, selected element, zoom, panels;
- history: past/present/future or command patches;
- persistence: clean/dirty/saving/saved/error/conflict.

History must cover document mutations, not temporary UI state. Limit history to 100 committed actions. Loading or successful saving must not add history entries.

Autosave after 1.5 seconds of inactivity. Do not autosave while dragging, resizing, or inline editing. Manual save flushes immediately. Failed saves preserve dirty state and offer retry. A browser navigation guard warns when unsaved changes exist.

### URL security

- Never accept `javascript:`, `data:`, `vbscript:`, or arbitrary protocols.
- External URLs allow only `https:` and optionally `http:` in local development.
- Email, phone, WhatsApp, and internal links are modeled as typed data and converted to hrefs by one shared safe-link utility.
- New-tab external links include `rel="noopener noreferrer"`.
- User text is rendered as text, never `dangerouslySetInnerHTML`.

### SEO settings and output

- `Settings -> SEO` in the permanent left sidebar manages site-wide defaults: site name, title template, default description, default social image, locale, canonical base URL, organization name/logo, default index/follow behavior, and optional Search Console verification.
- The builder right panel includes `Page -> SEO` for the selected page: SEO title, meta description, canonical override, index/noindex, follow/nofollow, Open Graph title/description/image/type, Twitter card/title/description/image, and structured-data page type.
- Display a Google-style search snippet preview and social-card preview. Previews are advisory and must not claim guaranteed rankings.
- Provide a deterministic SEO checklist for missing/duplicate titles, missing/weak descriptions, invalid canonical paths, no H1 or multiple H1s, missing image alt text, broken internal links, non-descriptive link text, oversized images, and unintended `noindex`.
- Do not expose a misleading `meta keywords` field as a ranking feature. An optional focus phrase may be used only for content guidance and must not generate obsolete keyword metadata.
- Resolve metadata through inheritance: page/post override -> project SEO default -> safe generated fallback.
- Blog metadata defaults dynamically to post title, excerpt, cover image, author, and publication date, with per-post overrides.
- Generate safe metadata outputs: `<title>`, description, robots, canonical, Open Graph, Twitter Card, and validated JSON-LD (`WebSite`, `Organization`, `WebPage`, and `Article` where appropriate).
- Generate `sitemap.xml` from indexable public pages and published posts only. Exclude drafts, disabled blog routes, and `noindex` content.
- Generate `robots.txt` from project settings and include the sitemap URL when a canonical public base URL exists.
- SEO metadata must be part of the shared rendering/export contract. Client-side preview may update document metadata, but the plan must not claim strong crawler indexing until publishing produces pre-rendered/static or server-rendered HTML per public route.
- Performance-related SEO uses responsive WebP `srcset`, explicit image dimensions to reduce layout shift, lazy loading below the fold, and eager/high-priority loading only for intentional hero/LCP images.

### Blog content and template behavior

- Blog is disabled by default per project. Enabling it creates safe starter index/article templates without publishing posts automatically.
- The post editor is a CMS form, not a separate free canvas for every post.
- Standard post fields are title, slug, excerpt, cover image, rich body content, author, categories, tags, publication status/date, SEO title, and SEO description.
- Rich body content uses Tiptap structured JSON; never store raw executable HTML as the source of truth.
- The article-template builder uses the same canvas/section system plus dynamic blog elements bound to system or custom fields.
- The index-template builder includes a repeatable `Post Collection` element with a nested card design and controls for query, sort, pagination, columns, and visible fields.
- Normal image/text/button elements inside a template are static decoration. Dynamic elements explicitly show their binding in the editor.
- If the designer adds one dynamic image field, the post form requests one image. If the designer adds two distinct dynamic image fields, the form requests two separately labeled images.
- Duplicating a dynamic element must ask whether to reuse the same binding (display the same value twice) or create a new field (request another value from the post author).
- Field labels may be renamed without changing stable IDs or losing post values.
- New custom fields are optional by default. Making a field required triggers a compatibility check across existing published posts.
- Removing a custom field hides it from the form/template but retains its orphaned post values for recovery until an explicit cleanup action is confirmed.
- Templates have separate draft and published versions. Editing a template never changes the live blog immediately.
- `Publish template` shows an impact report. It is blocked when required fields are missing from existing published posts unless the designer supplies a fallback or resolves the affected posts.
- Publishing a template updates all existing and future posts that use it. Posts do not clone the layout.
- Preview mode can select a real draft/published post as sample data and clearly identifies missing fields.
- Public article URLs use `${basePath}/${post.slug}` and resolve only published posts.

---

## 8. Preview and renderer

Frontend route:

```text
/preview/:projectId/*
```

The route loads the saved project and resolves the trailing path to a page slug. Unknown slugs show a project-scoped not-found view. Internal button links navigate inside this preview route without opening the editor.

Create pure presentational renderer components:

- `ProjectPageRenderer`
- `ElementRenderer`
- `TextRenderer`
- `ImageRenderer`
- `ButtonRenderer`

The editor wraps these components with selection and Moveable interaction layers. Preview and production rendering use them without editor chrome. Do not duplicate property-to-style conversion.

### Production publication contract

- `Publish` first runs the complete site-readiness and publication preflight against one exact project revision. Block only deterministic critical failures; show warnings/manual-review items separately.
- Build one fully resolved `PublishedSiteVersion` containing pages, shared sections, published blog/CMS templates and items, forms needed for public rendering, system pages, SEO, routes, redirects, and owned media references. Draft-only content never enters it.
- Write the immutable version first, verify its content hash/route manifest, then atomically update `activePublishedVersionId`. A failed build never changes the live site.
- Rollback validates ownership/schema/media availability and atomically points to an earlier immutable version. Rollback itself records an audit event; it does not modify or overwrite either snapshot.
- Autosave/editor revisions are independent from publication versions. The dashboard explicitly shows `Unpublished changes` when source revision differs from the active published version.
- Initial implementation uses server-side/pre-rendered HTML responses from the shared renderer so every public route delivers route-specific content and SEO metadata without depending on client-side JavaScript for crawlability. Static export may be added later behind the same publication contract.

### Multi-tenant public renderer

- Deploy one stateless public-renderer service/application in Coolify. Never provision a container, port, repository, build, or Coolify resource for each customer site.
- Normalize the request hostname: remove port/trailing dot, lowercase, convert IDN to ASCII/Punycode, reject invalid lengths/labels/control characters, and never trust forwarded host headers unless the request came through configured trusted proxies.
- Resolve `hostname -> active SiteDomain -> projectId -> activePublishedVersionId`. Cache positive mappings/snapshots with short bounded TTL and invalidate after publish, rollback, primary-domain change, activation, or disconnect.
- Unknown, pending, disconnected, or cross-tenant hosts return a neutral non-branded `404`/`421` response. Never fall back to another project, a project ID query parameter, or the editor draft.
- Resolve request paths only through the snapshot route/redirect manifest. Apply bounded redirects before content; render the configured 404 for unknown paths.
- Canonical metadata uses the active primary hostname. Secondary active hostnames redirect to the primary by default, with an explicit temporary diagnostic override only for authorized preview tools.
- Health endpoints do not require a site hostname and reveal no tenant data. Renderer logs use domain/project identifiers only as needed and must not log secrets, form bodies, or full private content.

### Direct platform subdomains

- `PLATFORM_ROOT_DOMAIN` is the user's real SaaS domain, for example `osistema.com`.
- Each project receives `${projectSlug}.${PLATFORM_ROOT_DOMAIN}`, for example `acme.osistema.com`. Do not use `acme.sites.osistema.com`.
- Normalize project slugs to lowercase ASCII DNS labels: `a-z`, `0-9`, hyphen; 3–63 characters; no leading/trailing hyphen. Handle collisions deterministically and let authorized users change an unclaimed slug with redirect/impact warnings.
- `PLATFORM_RESERVED_SUBDOMAINS` must at least include `www,app,api,admin,origin,customers,coolify,status,mail,cdn,assets,static,docs,support`. Validate this server-side during project creation/rename and seed migration.
- Create a wildcard DNS record for `*.${PLATFORM_ROOT_DOMAIN}` pointing/proxying to the public origin and configure matching origin routing/certificate behavior. Explicit infrastructure DNS records override the wildcard.

### Customer custom domains

- In `Site -> Settings -> Domains`, show the permanent platform hostname, custom hostname list, primary badge, DNS instructions, ownership/hostname status, SSL status, last check, retry, disconnect, and safe error guidance.
- First release officially supports customer subdomains such as `www.customer.com` or `site.customer.com` through CNAME to `CLOUDFLARE_SAAS_CNAME_TARGET`. Encourage `www` as primary and let the customer's DNS provider redirect the apex/root to `www`.
- Apex/root domains are supported only when the customer's DNS provider offers CNAME flattening/ALIAS compatible with the configured SaaS target, or when a separately approved apex-proxy feature exists. Do not instruct users to guess an A record or promise universal apex support.
- Adding a hostname creates a local pending record, creates the provider custom hostname idempotently, returns exact DNS/validation instructions, and polls/refreshes separate hostname and SSL states.
- Mark production-ready only when local ownership/project association is valid, provider hostname status is active, provider SSL status is active, and DNS resolves to the configured SaaS target.
- Disconnect removes provider mapping/certificate association idempotently, invalidates renderer cache, retains a minimal audit record, and never deletes the project or domain registration.

### Environment variables

Maintain a documented root `.env.example`; Coolify production values are configured per service. Never commit real values, echo secrets in logs, expose backend-only variables through Vite, or reuse broad Cloudflare account tokens.

```dotenv
# Shared public addresses
PLATFORM_ROOT_DOMAIN=osistema.com
PLATFORM_PUBLIC_ORIGIN=https://osistema.com
API_PUBLIC_BASE_PATH=/api
PLATFORM_RESERVED_SUBDOMAINS=www,app,api,admin,origin,customers,coolify,status,mail,cdn,assets,static,docs,support

# Frontend (public variables only)
VITE_PUBLIC_ORIGIN=https://osistema.com
VITE_API_URL=/api/v1

# Backend/auth/database (existing values remain required)
NODE_ENV=production
API_PORT=3000
PUBLIC_RENDERER_PORT=3001
TRUSTED_PROXY_CIDRS=<coolify-traefik/internal-proxy-cidrs>
MONGODB_URI=<secret>
MONGODB_DB_NAME=<name>
BETTER_AUTH_SECRET=<secret-at-least-32-bytes>
BETTER_AUTH_URL=https://osistema.com
BETTER_AUTH_BASE_PATH=/api/auth
FRONTEND_ORIGIN=https://osistema.com

# Public renderer/cache/publication
PUBLIC_RENDERER_ORIGIN=https://origin.osistema.com
PUBLIC_RENDERER_HEALTH_PATH=/healthz
PUBLIC_SITE_CACHE_TTL_SECONDS=60
DOMAIN_CACHE_TTL_SECONDS=60
PUBLISHED_VERSION_RETENTION_COUNT=20
PUBLISH_MAX_DOCUMENT_BYTES=<validated-limit>
PUBLISH_LOCK_TIMEOUT_SECONDS=120

# Cloudflare for SaaS (backend worker/API only)
CLOUDFLARE_ACCOUNT_ID=<secret>
CLOUDFLARE_ZONE_ID=<secret>
CLOUDFLARE_API_TOKEN=<least-privilege-secret>
CLOUDFLARE_SAAS_CNAME_TARGET=customers.osistema.com
CLOUDFLARE_SAAS_FALLBACK_ORIGIN=origin.osistema.com
CLOUDFLARE_CUSTOM_HOSTNAME_SSL_METHOD=http
CLOUDFLARE_API_BASE_URL=https://api.cloudflare.com/client/v4
DOMAIN_VERIFICATION_INTERVAL_SECONDS=60
DOMAIN_VERIFICATION_TIMEOUT_HOURS=72

# Optional operational configuration; no secret placeholders become defaults
LOG_LEVEL=info
PUBLIC_REQUEST_TIMEOUT_MS=10000
SHUTDOWN_TIMEOUT_MS=30000
```

- Validate required production variables at startup with Zod and fail fast with variable names but never secret values.
- `VITE_*` variables are bundled into public frontend code; only the public origin and relative API path belong there. Cloudflare, database, auth, storage, and signing credentials are backend-only.
- The Cloudflare token must be least-privilege and limited to the required account/zone/custom-hostname operations. Document permissions without storing the token in README screenshots or shell history.
- Keep provider/base URLs configurable for tests. Tests use fakes; automated suites never modify real DNS, Coolify, Cloudflare, or production certificates.
- Determine and document the real Coolify/Traefik proxy chain before setting `TRUSTED_PROXY_CIDRS`; do not use unconditional `trust proxy=true`, and restrict direct origin access where practical.

### Coolify deployment and DNS checklist

Deploy from one repository as a Coolify Docker Compose stack (preferred for the single-origin requirement) or equivalent connected resources, retaining one source revision and health-gated deployment. The frontend production gateway is the only public entry for the SaaS origin and proxies `/api/*` to the private backend over the internal Coolify network.

| Resource | Coolify domain/FQDN | Responsibility |
|---|---|---|
| Frontend gateway | `https://${PLATFORM_ROOT_DOMAIN}` | Landing, roadmap, auth pages, `/app/*`; reverse-proxy `/api/*` to backend and use SPA fallback only outside `/api` |
| API/backend | Private internal service/port; publicly reachable only through `https://${PLATFORM_ROOT_DOMAIN}/api/*` | Auth, data, publishing, domain-provider jobs |
| Public renderer | Technical `https://origin.${PLATFORM_ROOT_DOMAIN}` plus validated catch-all host routing | Every `project.${PLATFORM_ROOT_DOMAIN}` and custom-domain public request |
| MongoDB | No public domain | Private application data |

Required operator checklist:

1. Point the apex/root `${PLATFORM_ROOT_DOMAIN}` (and optionally `www` redirecting to it) to the VPS/frontend gateway. Do not create or advertise `app.${PLATFORM_ROOT_DOMAIN}` or `api.${PLATFORM_ROOT_DOMAIN}` product endpoints.
2. Configure the frontend gateway so `/api/*` proxies to the private backend service; `/`, `/roadmap`, `/login`, `/signup`, and `/app/*` serve the frontend/SPA. API failures must return API errors and never fall through to `index.html`.
3. Create `*.${PLATFORM_ROOT_DOMAIN}` DNS for direct project hostnames. Explicit technical records take priority over the wildcard.
4. Create/proxy `customers.${PLATFORM_ROOT_DOMAIN}` as the Cloudflare for SaaS CNAME target and configure the technical `origin.${PLATFORM_ROOT_DOMAIN}` as the fallback origin.
5. Configure Coolify/Traefik so the exact apex/root host reaches the frontend gateway and all remaining validated project/custom hosts reach the renderer. Use a documented catch-all `HostRegexp` rule only for the renderer; it must reject unknown/reserved hosts.
6. Configure origin HTTPS, wildcard certificate/DNS challenge where required, ports `80/443`, trusted proxy behavior, health checks, restart policy, CPU/memory limits, and rolling/health-gated deploy behavior.
7. Set production environment variables in the correct Coolify service; never put backend secrets in frontend build arguments or public variables.
8. Confirm Cloudflare custom-hostname fallback origin, CNAME target, API token scope, hostname validation, SSL issuance, and active/SSL-active checks with a disposable test domain before client onboarding.
9. Configure external encrypted database/Coolify backups, retention, restore test, disk alerts, proxy/application logs, uptime checks, and certificate/domain failure alerts.
10. Run smoke tests for root frontend routes, `/api/health`, technical origin health, one wildcard project hostname, one customer CNAME hostname, unknown-host rejection, publish, republish, and rollback.
11. Record provider-neutral manual fallback steps. The product must continue serving already active published sites during a temporary Cloudflare API outage; only new domain activation/reverification may pause.

---

## 9. Execution phases and tasks

Checkbox meanings: `[ ]` pending, `[~]` in progress, `[x]` verified, `[!]` blocked.

### Phase 0 — Repository discovery

- [x] **P0-T1 — Inspect and reconcile repository**
  - Inspect all non-generated files, package manifests, Git status, and existing conventions.
  - Preserve compatible code and user changes.
  - Update this plan only where the existing repository requires a justified adjustment.
  - Acceptance: existing state is summarized in the Decision Log; no files are overwritten blindly.
  - Verify: `git status --short` when Git is available; list relevant manifests and source directories.

- [x] **P0-T2 — Create token-efficient Claude project memory and plan skill**
  - Create the short root `CLAUDE.md`, `.claude/skills/execute-plan-task/`, its deterministic task-extraction script, and `.claude/skills/project-runbook/` with the progressive-disclosure references defined in Section 0.
  - The extraction script must accept exactly one valid task ID, find one unique task, include its containing phase/checkpoint and explicit referenced sections, reject missing/duplicate IDs, and never modify the plan. The skill—not the script—owns status changes after verification.
  - Keep generated summaries concise, source-linked, and reproducible. Add a documented command to regenerate them when fixed architecture/commands change.
  - Acceptance: invoking `/execute-plan-task P0-T1` loads a bounded task packet rather than the whole plan, and project memory does not duplicate large plan sections.
  - Verify: script fixture tests for valid/missing/duplicate IDs, Claude skill discovery, link/path checks, and token-size comparison of one task packet versus the complete plan.

- [x] **P0-T3 — Create reusable project subagents**
  - Create the five `.claude/agents/*.md` definitions from Section 0 with unique names, precise delegation descriptions, explicit model choice, least-privilege tool allowlists, write-scope instructions, compact handoff schema, and bounded turn limits.
  - Keep `repo-navigator`, `test-verifier`, and `security-tenant-reviewer` non-writing by default. Frontend/backend implementers may edit only their declared task scope and must refuse overlapping shared-file work.
  - Do not set a subagent as the automatic session-wide default. The main session remains plan/integration owner and delegates naturally or by explicit mention.
  - Acceptance: Claude Code discovers every agent; one read-only trial returns the required compact handoff without modifying files; descriptions are distinct enough to avoid ambiguous automatic routing.
  - Verify: `/agents` inspection plus safe dry-run prompts for navigator and verifier; confirm no duplicate names and review available tools/permissions.

- [x] **P0-T4 — Install and audit Ponytail and Graphify**
  - Install Ponytail through its Claude Code marketplace/plugin commands and review its skill, commands, and hooks before approval. Record source, installed version/commit, permissions, and any local deviation without copying third-party code into this plan.
  - Install official `graphifyy`, run the project-scoped Claude installer, inspect the generated Graphify skill, add a repository-specific `.graphifyignore`, and record the installed version.
  - Do not run the first full graph against an empty scaffold, enable Graphify strict blocking mode, start an MCP server, or commit generated graph artifacts yet. Those decisions wait for P1-T7 measurements.
  - Acceptance: both tools are available to Claude Code from this project, no unreviewed hook has broad permission, and generated project files contain no secrets or machine-specific paths.
  - Verify: plugin/skill listing, `graphify --version`, generated-path inspection, hook review, secret scan, and clean Git diff limited to approved project configuration.

- [!] **P0-T5 — Reconcile the canonical GitHub remote and branch workflow** — *partially complete;
  blocked only on the GitHub API settings that require the repository owner's authentication.
  Done: `origin` is the exact canonical URL, the remote was verified empty before any write, `main`
  was created as the production baseline and `development` branched from it, both were pushed with
  known shared ancestry, and no commit was lost or force-pushed. Blocked: setting `development` as
  the repository default branch and configuring branch protection require an authenticated GitHub
  session (`gh auth login` or a token with repo admin scope); `gh auth status` reports no logged-in
  host. Until the owner authenticates, `main` is still the GitHub default branch and neither branch
  is protected. Same blocker as P19-T4.*
  - Verify authenticated access to `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`, inspect remote branches/history, local Git status, remotes, divergence, and the repository's default branch before changing anything. Treat the remote as possibly private or empty until this check succeeds.
  - Clone the repository when starting outside it, or set/repair `origin` when already inside the intended working tree. Never replace an unrelated remote, discard local/user work, rewrite remote history, or use a force push to make the state match this plan.
  - Preserve or create `main` from the latest verified production baseline. Create `development` from the reconciled `main`, push both when authorized, and make `development` the default collaboration branch when repository permissions allow it. If the default branch or protections require a manual GitHub setting, record the exact step as a blocker instead of pretending it succeeded.
  - Configure the documented flow: work and short-lived task branches target `development`; only a reviewed, green `development -> main` pull request promotes production. Delete merged task branches/worktrees and keep only `main` and `development` long-lived.
  - Acceptance: `origin` resolves to the exact canonical URL; local/remote `main` and `development` have known ancestry; no existing commit is lost; the branch and deployment policy is documented in English.
  - Verify: `git remote -v`, `git fetch --all --prune`, `git branch -vv`, `git ls-remote --heads origin`, clean/understood `git status --short`, and GitHub default-branch/protection inspection where authorized.

**Checkpoint 0:** the existing repository and canonical GitHub remote are understood; `main`/`development` have a safe documented workflow; Claude can load one plan task at a time; reusable least-privilege agents are available; and Ponytail/Graphify are installed without yet treating third-party claims or a stale graph as authoritative.

### Phase 1 — Workspace foundation

- [x] **P1-T1 — Create npm workspace and root scripts**
  - Add root workspace configuration for `frontend`, `backend`, and `packages/shared`.
  - Add `dev`, `dev:frontend`, `dev:backend`, `dev:renderer`, `build`, `typecheck`, `test`, and `test:e2e` scripts. The renderer remains code inside `backend/`, not a third top-level workspace.
  - `npm run dev` must start frontend, API backend, and public renderer development processes and terminate all cleanly.
  - Acceptance: one root install; no nested lockfiles; both dev processes start.
  - Verify: `npm install`, `npm run typecheck`, `npm run build`.

- [x] **P1-T2 — Scaffold frontend**
  - Configure React 19, TypeScript strict mode, Vite, Tailwind, React Router, tests, and base app routes.
  - Add accessible app shell, global styles, and frontend environment typing.
  - Acceptance: frontend renders and has a passing smoke test.
  - Verify: `npm run typecheck -w frontend && npm run test -w frontend && npm run build -w frontend`.

- [x] **P1-T3 — Scaffold backend**
  - Separate `app.ts` from `server.ts`; configure Express 5, JSON payload limit, CORS, logging, errors, env validation, and graceful shutdown.
  - Acceptance: health route works and server tests do not require a real network port.
  - Verify: `npm run typecheck -w backend && npm run test -w backend && npm run build -w backend`.

- [x] **P1-T4 — Create shared contracts package**
  - Add types, Zod schemas, schema version, ID rules, slug normalization, and safe-link helpers.
  - Add contract tests, including dangerous URL rejection.
  - Acceptance: frontend and backend import the package through workspaces without copying types.
  - Verify: `npm run typecheck && npm test`.

- [x] **P1-T5 — Public SaaS shell, landing page, and roadmap**
  - Implement the separate `PublicShell` route layout and public left sidebar defined in Section 7, with Home/Roadmap active states and login/signup actions.
  - Build the responsive landing-page sections and reusable marketing components without coupling them to builder documents or the authenticated app shell.
  - Build `/roadmap` from a typed roadmap data module with stable items, the four defined statuses, category/status presentation, honest availability labels, and no uncommitted exact dates.
  - Add public-page title/description, canonical-ready metadata contracts, semantic landmarks, heading order, keyboard support, reduced-motion handling, and responsive drawer behavior.
  - During this foundation phase, login/signup actions may point to route placeholders; Phase 7 must replace them with the real Better Auth flow without changing the public shell.
  - Acceptance: `/` and `/roadmap` share only the public sidebar; `/app/*` never mounts it; mobile navigation is accessible; roadmap content is data-driven; marketing copy never labels planned features as released.
  - Verify: route/layout/component tests, keyboard navigation tests, responsive checks at `320`, `768`, `1024`, and `1440px`, `npm run typecheck -w frontend`, and `npm run build -w frontend`.

- [x] **P1-T6 — Establish bilingual product localization**
  - Configure `i18next` and `react-i18next` with typed `pt-BR` and `en-US` resources split into the namespaces defined in Section 7. English source keys must be stable; missing keys are test failures, not visible production fallbacks.
  - Implement locale resolution in this order before login: explicit local choice, browser/`Accept-Language`, then `en-US`. Add the compact public-shell selector and localize Home, Roadmap, route placeholders, shared loading/error/empty states, accessibility labels, and metadata.
  - Update `document.documentElement.lang`, use `Intl` helpers for dates/numbers/lists/plurals/relative time, escape interpolation safely, and verify long Portuguese labels do not truncate or break responsive layouts.
  - Add a translation-key parity check and a lint/test rule that detects new hardcoded user-facing strings in covered UI paths. Technical code, tests, documentation, logs, and translation keys remain in English.
  - Acceptance: a visitor can switch the complete public/auth foundation between both languages immediately and the preference survives reload; no customer-authored content is modified.
  - Verify: locale resolver/unit tests, key-parity test, public route tests in both locales, `lang`/metadata assertions, `320–1440px` layout checks with both languages, frontend typecheck and build.

- [x] **P1-T7 — Generate the first code graph and reproducible run skill**
  - After P1-T1 through P1-T6 pass, run `/graphify .`, inspect `GRAPH_REPORT.md`, query representative frontend/backend/shared call paths, and confirm results against exact source files.
  - Measure generated file sizes and change noise; decide in the Decision Log which portable Graphify outputs are committed. Ignore local manifests, cost files, caches, secrets, build output, dependencies, test artifacts, and uploads.
  - Run bundled `/run-skill-generator` from a clean development setup, inspect the generated project run skill, and verify `/run` and `/verify` use the documented root scripts without reading unrelated files or exposing environment values.
  - Acceptance: a fresh Claude session can locate a representative route-to-contract-to-repository path through a compact Graphify query and can start/verify the app through the saved recipe.
  - Verify: targeted Graphify query/path checks, generated-size report, clean-clone-safe ignore rules, `/run`, `/verify`, root health/UI smoke tests, and secret scan.

**Checkpoint 1:** `npm run dev` starts frontend/API/renderer; health and UI smoke tests pass; the public landing page and roadmap work through a distinct responsive public shell in `pt-BR` and `en-US`; the initial code graph and reproducible Claude run recipe are verified.

### Phase 2 — Persistence and project API

- [x] **P2-T1 — MongoDB connection layer**
  - Add validated `MONGODB_URI` and `MONGODB_DB_NAME`, one shared Mongo client, startup connection, indexes, and graceful close.
  - Make repository code injectable/testable without global database state.
  - Acceptance: startup fails clearly for invalid configuration; health reports database state.
  - Verify: backend unit/integration tests and typecheck.

- [x] **P2-T2 — Project repository and mapping**
  - Implement ObjectId/API ID mapping, workspace/client-scoped summary listing, complete document read, create, rename, save with revision, and delete.
  - Require an injected verified workspace context even before the real auth UI is wired; tests may use an explicit seeded development workspace, never an unscoped fallback.
  - Acceptance: stale revision cannot overwrite data; timestamps and revision update correctly; no repository method can query business data without `workspaceId`.
  - Verify: repository tests against an isolated test database or approved test container strategy.

- [x] **P2-T3 — Project REST API**
  - Implement routes, controllers/services, Zod validation, standard envelopes, not-found, payload, and conflict errors.
  - Acceptance: all routes match Section 6; malformed IDs and documents return safe errors.
  - Verify: Supertest API suite.

- [x] **P2-T4 — Frontend API client and preliminary site list**
  - Add typed fetch wrapper and preliminary workspace-scoped site list/create/rename/delete/open UI, confirmation dialog, loading/error/empty states.
  - This is not yet the final agency dashboard; keep components reusable for the later workspace/client dashboards.
  - Acceptance: project CRUD works through the real backend and never leaks across seeded workspace contexts.
  - Verify: frontend integration tests and manual CRUD smoke test.

**Checkpoint 2:** create, rename, list, open, and delete persisted projects.

### Phase 3 — Editor document and pages

- [x] **P3-T1 — Implement editor store foundation**
  - Add Zustand document/UI/history/persistence slices and typed actions.
  - Implement dirty tracking, 100-action undo/redo, and history transaction boundaries.
  - Acceptance: document actions are reversible; selection/zoom changes do not pollute history.
  - Verify: store unit tests.

- [x] **P3-T2 — Load, manual save, and autosave**
  - Load project into store; implement revision-aware manual save, 1.5s debounce, retry, conflict UI, navigation warning, and save-state indicator.
  - Acceptance: reload preserves state; failed save remains dirty; no per-pixel requests.
  - Verify: fake-timer tests and API integration tests.

- [x] **P3-T3 — Page management**
  - Create, rename, duplicate, delete, reorder, select, set homepage, and normalize unique slugs.
  - Prevent deletion of the final page and maintain exactly one homepage.
  - Acceptance: every page keeps an independent element array and valid slug.
  - Verify: page action/schema tests.

- [x] **P3-T4 — Build editor shell**
  - Implement the top bar, center canvas workspace, permanent application navigation on the left, and a unified right-side builder control panel for pages, available elements, and the property inspector.
  - Organize the right panel with clear tabs or modes so pages, elements, and settings do not compete for space.
  - Do not create a second builder-specific left sidebar.
  - Acceptance: the canvas remains centered; application navigation is on the left; builder controls are on the right; all major editor states are visible and keyboard navigable.
  - Verify: component tests and visual manual smoke test.

- [x] **P3-T5 — Right-panel state machine and overlay foundation**
  - Implement the mutually exclusive right-panel modes, remembered return mode, section/element inspector transitions, parent breadcrumb, fixed desktop width, desktop-only authoring gate, and selection-driven focus behavior from Section 7.
  - Add one accessible overlay manager for popovers, dialogs, and large resource pickers with documented stacking, outside-click/Escape rules, focus trapping/restoration, and background-shortcut suppression.
  - Acceptance: selecting a button/text/image/section replaces the right panel with the matching inspector without moving the canvas; Back/deselect restores the prior mode and scroll position; only one modal can exist at a time.
  - Verify: reducer/state-machine, route preservation, panel transition, focus, keyboard, authoring-gate, and overlay stacking tests.

**Checkpoint 3:** open a persisted project, manage pages, save, reload, undo, and redo.

### Phase 4 — Canvas and element interactions

- [x] **P4-T1 — Build logical canvas and zoom mapping**
  - Render 1440px logical canvas scaled to the workspace; implement coordinate conversion and scroll behavior.
  - Acceptance: persisted geometry does not change when editor zoom/fit changes.
  - Verify: coordinate utility tests at multiple scales.

- [x] **P4-T2 — Shared element renderer**
  - Implement text/image/button renderers and centralized model-to-style mapping.
  - Render plain text safely; handle missing/broken images; render typed links safely.
  - Acceptance: renderer contains no editor selection logic and works in a standalone test harness.
  - Verify: renderer unit/component tests.

- [x] **P4-T3 — Add/select/delete/duplicate elements**
  - Add default elements near viewport center; click-select; click-empty deselect; hover/selected outlines and element label; delete; duplicate; lock/hide behavior; Layers-based recovery for locked/hidden elements.
  - Acceptance: IDs are unique, operations create correct history entries, the selected element is unambiguous on light/dark content, and editor outlines never appear in preview/public rendering.
  - Verify: store and interaction tests.

- [x] **P4-T4 — Drag and resize with Moveable**
  - Add selection outline, exactly eight resize handles (four corners and four side midpoints), drag, two-axis corner resize, one-axis side resize, minimum sizes, logical coordinate conversion, and reasonable canvas bounds.
  - Commit one history action at interaction end.
  - Acceptance: interactions remain smooth and do not trigger API calls continuously.
  - Verify: interaction tests plus manual drag/resize at multiple zoom levels.

- [x] **P4-T5 — Z-order and canvas height**
  - Bring forward/send backward, normalize z-indexes, and allow controlled page-height adjustment or growth when needed.
  - Acceptance: visual stacking is deterministic after save/reload.
  - Verify: z-order tests.

**Checkpoint 4:** add, select, move, resize, duplicate, delete, lock, hide, and reorder the initial element types.

### Phase 5 — Property inspectors and shortcuts

- [x] **P5-T0 — Shared inspector framework**
  - Build reusable inspector section primitives for Content, Style, Layout, Responsive, and Advanced; standardize labels, units, inherited/override badges, validation, reset actions, disclosure state, and continuous-control history transactions.
  - Keep inspector state keyed by selected element/type without writing UI-only disclosure/scroll state into the builder document.
  - Acceptance: every element inspector follows one predictable structure and switching selections never creates document history or loses canvas state.
  - Verify: inspector framework, transaction grouping, selection switching, disclosure persistence, and validation tests.

- [x] **P5-T1 — Text inspector and inline editing**
  - Implement content, font family, size/unit, weight, style, decoration, transform, alignment, color, line-height, letter spacing, wrapping, and semantic heading/paragraph controls plus double-click inline editing.
  - Bundle a small safe initial font list; do not implement arbitrary remote font loading.
  - Acceptance: inspector and inline edits stay synchronized and undoable.
  - Verify: component and store tests.

- [x] **P5-T2 — Image inspector**
  - Implement owned-media/HTTPS source, alt/decorative state, object-fit, focal position, radius, opacity, border, shadow, aspect ratio, and shared geometry/layout controls with invalid/broken-image feedback.
  - Acceptance: bad input cannot corrupt document state; the source model supports both URL and uploaded media selection.
  - Verify: validation and component tests.

- [x] **P5-T3 — Button inspector and links**
  - Implement button text, typography, text/background colors for normal/hover/focus/disabled states, border, radius, shadow, padding, alignment, shared width/height/min/max controls, typed link editor, internal page selector, new-tab choice, Lucide icon allowlist/search, icon position, icon size, and icon/text gap.
  - Acceptance: unsafe protocols are rejected; deleted internal targets show a repairable validation state.
  - Verify: safe-link and button tests.

- [x] **P5-T4 — Keyboard shortcuts and accessibility pass**
  - Implement documented shortcuts with editable-target guards, focus handling, labels, and tooltips.
  - Acceptance: typing in an input/contenteditable is never deleted or undone by canvas shortcuts.
  - Verify: keyboard interaction tests.

**Checkpoint 5:** complete editable text/image/button experience with safe links and shortcuts.

### Phase 6 — Preview

- [x] **P6-T1 — Preview routing and page resolution**
  - Implement `/preview/:projectId/*`, load saved data, resolve homepage/slugs, and show project-specific not-found state.
  - Acceptance: preview opens separately from editor and contains no editor chrome.
  - Verify: routing tests.

- [x] **P6-T2 — Preview navigation and isolation**
  - Use shared renderer; support internal/external/email/phone/WhatsApp links; exclude hidden elements; prevent editor event handlers/styles from leaking.
  - Acceptance: links behave according to their typed configuration and internal navigation stays in preview.
  - Verify: integration tests.

- [x] **P6-T3 — Desktop/Mobile preview actions and mobile-only gate**
  - Add primary `Preview Desktop` and `Preview Mobile` actions to every desktop visual builder/template top bar, using one renderer/resolver and saved or explicitly previewable draft data.
  - Implement the mobile/tablet-class visual-editor route gate from Section 7: no editing code or mutation controls, page selector, saved-version timestamp, `Mobile preview`, `Desktop preview`, and `Continue editing on a computer` guidance.
  - Desktop preview on a phone is scaled read-only output with optional pan/zoom/fullscreen; Mobile preview uses the actual viewport. Neither mode writes document state or triggers autosave.
  - Acceptance: desktop and mobile previews render the same document under different viewport rules; mobile access cannot drag, resize, type, open an inspector, call document mutation actions, or accidentally save.
  - Verify: viewport/capability gate, preview-mode routing, renderer parity, no-mutation network assertion, navigation, rotation, and mobile E2E tests.

**Checkpoint 6:** saved multi-page projects have clean Desktop/Mobile previews, and mobile/tablet-class visual-editor access is safely preview-only.

### Phase 7 — Authentication, workspaces, and tenant authorization

- [x] **P7-T1 — Configure Better Auth**
  - Implement email/password signup, login, logout, session retrieval, MongoDB adapter, Organization plugin, environment secrets, and trusted origins.
  - Add frontend auth client and protected-route handling.
  - Acceptance: a user can register, sign in, refresh the browser, retain the session, and sign out.
  - Verify: auth API/integration tests and frontend route tests.

- [x] **P7-T2 — Personal workspace bootstrap and switching**
  - Create exactly one personal workspace for every new user, make it active, and implement authorized workspace listing/switching.
  - Make bootstrap idempotent so retries cannot create duplicate personal workspaces.
  - Acceptance: a self-service user can begin creating sites immediately without understanding organizations.
  - Verify: signup/bootstrap/retry/switch tests.

- [x] **P7-T3 — Enforce workspace authorization**
  - Require authentication for all business routes, resolve membership/role server-side, and scope every repository operation by verified `workspaceId` plus nested resource IDs.
  - Define permission checks for owner, admin, designer, editor, and viewer; do not trust client-supplied roles or active workspace alone.
  - Acceptance: users cannot list, load, preview, edit, upload, or delete resources belonging to workspaces where they lack permission.
  - Verify: multi-workspace, two-user, role, ID-guessing, and nested-resource authorization tests.

- [x] **P7-T4 — Authenticated workspace experience**
  - Add signup/login pages, validation, pending/error states, logout, safe redirect-back behavior, and workspace switcher.
  - Connect the public shell's login/signup actions to Better Auth. After login/signup, replace the public shell with the authenticated shell and route to the validated return path or workspace dashboard.
  - When a signed-in user views Home or Roadmap, show `Open dashboard` instead of the primary signup CTA without hiding the public content.
  - Acceptance: unauthenticated users reach auth; authenticated users see only workspaces/sites allowed by membership.
  - Verify: component and E2E auth tests.

- [x] **P7-T5 — Persist user language preference and localize the authenticated platform**
  - Implement the application-owned `userPreferences` repository and authenticated `GET/PUT /api/v1/me/preferences` endpoints with the `SupportedAppLocale` allowlist. The record is keyed by Better Auth user ID and is never workspace-scoped or accepted for another user ID from the request body.
  - Add `Settings -> Language` with `Português (Brasil)` and `English (United States)`. Switching updates the interface immediately and persists to the backend; workspace switching, reload, logout/login, and a second authenticated device must resolve the same saved preference.
  - On authentication, an existing server preference is authoritative. For a first-time user with no preference record, seed the explicit pre-auth local choice when present, otherwise the resolved browser locale, then persist it idempotently. Never overwrite a saved preference merely because browser language changed.
  - Localize the authenticated shell, dashboard foundation, auth validation, notifications, inspector/shared controls, and all UI already implemented. Backend responses expose stable language-neutral error codes; the frontend maps them to locale resources while backend logs remain English.
  - Acceptance: both locales cover the complete platform implemented through Phase 7; no hardcoded user-facing strings remain in covered code; changing UI language does not change workspace/site data or customer-authored content.
  - Verify: API authorization/validation/idempotency tests, preference precedence tests, settings component tests, cross-workspace and relogin persistence E2E in both locales, key parity/hardcoded-copy checks, typecheck and build.

**Checkpoint 7:** accounts/workspaces work; all business data is isolated by verified workspace membership and role; and the authenticated platform switches between `pt-BR` and `en-US` with a user-level persisted preference.

### Phase 8 — Hybrid sections, containers, and manual freedom

- [x] **P8-T1 — Migrate page model to ordered sections**
  - Add versioned migration from legacy page-level elements into one default free section.
  - Implement section create, rename, duplicate, reorder, hide, delete, and background controls.
  - Acceptance: existing documents migrate without losing geometry.
  - Verify: schema migration and section action tests.

- [x] **P8-T2 — Complete free-layout section behavior**
  - Ensure text, images, buttons, and containers remain freely draggable and manually resizable with eight handles.
  - Never force full-width sizing because another section uses grid/flex.
  - Acceptance: a user can make a button narrow, wide, short, or tall within sensible minimums.
  - Verify: handle-direction, geometry, zoom, history, save/reload tests.

- [x] **P8-T3 — Grid sections**
  - Add grid configuration, visible editor guides, drag/drop into cells, column/row span, gap, padding, alignment, and child sizing.
  - Acceptance: grid behavior applies only inside the selected grid section.
  - Verify: grid renderer/store/interaction tests.

- [x] **P8-T4 — Flex sections**
  - Add direction, wrap, justify, align, gap, padding, order, grow, shrink, basis, and drag reordering.
  - Acceptance: flex behavior applies only inside the selected flex section.
  - Verify: flex renderer/store/interaction tests.

- [x] **P8-T5 — Nested containers and safe mode conversion**
  - Add container elements with free/grid/flex children, a documented nesting-depth limit, breadcrumbs, and drop-target indication.
  - Add warned, undoable, deterministic conversion between section layout modes.
  - Acceptance: conversion never silently discards elements or their previous state.
  - Verify: nesting, drag/drop, conversion, undo, and persistence tests.

- [x] **P8-T6 — Copy, cut, and paste**
  - Implement toolbar/context actions and keyboard shortcuts; regenerate IDs recursively and offset pasted free elements.
  - Support pasting between pages/sections while validating layout compatibility.
  - Acceptance: copied nested content has no duplicate IDs and one undo removes the pasted tree.
  - Verify: clipboard/store/keyboard tests.

**Checkpoint 8:** a page can mix manually resizable free sections with grid/flex sections and nested containers.

### Phase 9 — Complete fluid responsiveness

- [x] **P9-T1 — Device canvas controls and inheritance engine**
  - Inside the desktop-class editor, add the primary Desktop/Mobile preview actions plus desktop/tablet/mobile working presets, custom breakpoint CRUD, continuous draggable width, numeric width input, and centralized deterministic inheritance/resolution.
  - Reject overlapping/duplicate ambiguous breakpoint definitions and preserve schema migrations.
  - Show base/inherited/overridden state and allow reset-to-inherited.
  - Acceptance: switching or resizing never mutates another breakpoint accidentally; every width resolves one unambiguous rule set.
  - Verify: inheritance, custom-breakpoint, boundary, migration, and store tests.

- [x] **P9-T2 — Typed responsive values and sizing inspector**
  - Implement validated structured values for safe units, intrinsic keywords, min/max, aspect ratio, fixed/fill/hug, and clamp; never accept arbitrary CSS expressions.
  - Add clear inspector controls, unit conversion rules, inherited indicators, and invalid-combination prevention.
  - Acceptance: values serialize safely and editor/preview/public renderer produce identical allowlisted CSS.
  - Verify: Zod, serialization, unit, clamp, reset, and injection tests.

- [x] **P9-T3 — Free-layout constraints and fluid geometry**
  - Implement left/right/center/stretch/scale and top/bottom/center/stretch/scale constraints, percentage/fluid sizes, min/max, aspect lock, visibility, and breakpoint overrides.
  - Add deterministic geometry calculation at arbitrary widths without changing stored base layout during preview.
  - Acceptance: free elements remain intentionally positioned from `320–1920px`; mobile adjustments preserve desktop/base geometry.
  - Verify: constraint matrix, arbitrary-width drag/resize, save/reload, overflow, and history tests.

- [ ] **P9-T4 — Intrinsic responsive grid and flex**
  - Add responsive columns/spans/direction/wrap/gap/padding/alignment/order/sizing plus grid `auto-fit`, `auto-fill`, `minmax`, and overflow-safe child minimums.
  - Acceptance: layouts adapt between breakpoints without requiring an override at every pixel and never force accidental horizontal overflow.
  - Verify: grid/flex renderer and inspector tests across boundary/intermediate widths.

- [ ] **P9-T5 — Container queries and reusable component behavior**
  - Implement opt-in container names/rules and container-width resolution for nested/reusable sections/components, with cycle/ambiguity protection.
  - Acceptance: the same component can render differently in a narrow sidebar and wide main area at the same viewport width.
  - Verify: nested-container, query-boundary, renderer, and safety tests.

- [ ] **P9-T6 — Fluid typography, spacing, and navigation**
  - Add safe `clamp()` typography/spacing controls, responsive line height, configurable navigation collapse width, tap-target checks, and mobile drawer behavior.
  - Acceptance: text/menu transitions smoothly at intermediate widths without abrupt unreadable states.
  - Verify: typography resolver, navigation, accessibility, and visual tests.

- [ ] **P9-T7 — Responsive image art direction**
  - Connect media variants to `srcset`/`sizes`, explicit dimensions, focal/object position, aspect ratio, and optional per-breakpoint source override.
  - Acceptance: browser can select an appropriate WebP variant and mobile can use a different crop/source without affecting desktop.
  - Verify: source selection, markup, layout-shift, fallback, and renderer tests.

- [ ] **P9-T8 — Continuous preview and responsive diagnostics**
  - Add draggable preview between `320–1920px`, common-device presets, exact numeric widths, zoom-independent measurements, and optional width sweep.
  - Detect overflow, clipping, off-canvas elements, impossible constraints, unintended overlaps, small text/tap targets, and missing responsive assets; link each warning to its element.
  - Acceptance: diagnostics report affected width ranges and never auto-change layout without user action.
  - Verify: diagnostic fixtures and visual/integration tests at `320`, `375`, `390`, `768`, `1024`, `1280`, `1440`, `1920`, plus breakpoint-adjacent widths.

- [x] **P9-T9 — Desktop authoring gate and preview-only mobile shell**
  - Enforce the configurable desktop-class visual-authoring requirement and implement the small-screen/touch-first preview-only shell without mounting canvas interaction, inspector, mutation shortcuts, or autosave code.
  - Keep non-canvas application navigation appropriately responsive, but route visual page/blog/CMS/system-template editing attempts into the preview-only experience.
  - Handle a desktop window crossing below/above the minimum width without losing unsaved local editor state or mutating the document.
  - Acceptance: phones/tablet-class devices can inspect Desktop/Mobile previews and navigate pages but cannot visually edit; resizing a desktop window pauses/resumes editing without data loss.
  - Verify: capability/width matrix, state preservation, no-mutation requests, route guards, mobile navigation, rotation, keyboard, and E2E tests.

**Checkpoint 9:** the desktop editor can author and diagnose every supported responsive width, while mobile/tablet-class access remains clean preview-only with no document mutation path.

### Phase 10 — Media library and shared site sections

- [x] **P10-T1 — Secure image upload storage**
  - Implement an image-storage interface backed initially by MongoDB GridFS, authenticated ownership, magic-byte MIME sniffing, file-size/pixel/dimension limits, safe filenames, streaming, content hashing, and deletion rules.
  - Route every accepted upload through one backend image-processing service/helper using Sharp; frontend MIME/extension claims are never trusted.
  - Decode, apply EXIF orientation, strip metadata/EXIF, preserve transparency where present, and normalize output to WebP.
  - Generate responsive WebP variants at target widths `320`, `768`, `1440`, and `1920` without upscaling beyond the decoded source. Record actual width, height, bytes, MIME, storage key, and content hash.
  - Use a configurable default WebP quality around `82`; tests must verify meaningful byte reduction without depending on an exact compressed byte count.
  - Persist variants atomically: no database metadata may reference partial uploads. Remove temporary/orphaned bytes after failure.
  - Discard the unoptimized original only after all required WebP variants are stored successfully. Store only optimized WebP outputs by default.
  - Reject SVG initially unless a proven sanitization pipeline is added. Reject animated inputs in MVP rather than silently converting only one frame; document supported JPEG/PNG/WebP inputs.
  - Acceptance: every stored usable image variant is `image/webp`; only validated raster images owned by the current user can be uploaded/read/deleted; corrupted/oversized/decompression-bomb inputs fail safely.
  - Verify: upload security, orientation, transparency, metadata stripping, variant dimensions, no-upscale, atomic failure cleanup, and API tests.

- [x] **P10-T2 — Media library UI**
  - Add upload, list, search, select, preview, reuse, delete, progress, empty, and error states inside the right panel.
  - Show optimized dimensions/file sizes and allow a default alt description. Renderer selects responsive variants with `srcset`/`sizes` and explicit dimensions.
  - Acceptance: uploaded media can be reused in multiple image elements without duplicate upload and public rendering never uses the raw source upload.
  - Verify: component/integration/E2E tests.

- [x] **P10-T3 — Shared header and footer**
  - Add project-level shared sections with header/footer roles; pages reference them instead of copying their contents.
  - Provide enable/disable or override controls per page while retaining one shared source.
  - Acceptance: editing a shared header/footer updates every referencing page and all previews.
  - Verify: shared-reference, page override, renderer, persistence, and E2E tests.

**Checkpoint 10:** users can upload/reuse images and maintain one shared responsive header/footer across pages.

### Phase 11 — Application dashboard, navigation, and blog CMS

- [x] **P11-T1 — Permanent application shell and site dashboard**
  - Implement the authenticated workspace-aware left sidebar, workspace switcher, contextual site navigation, and route structure defined in Section 7.
  - Add the site-level dashboard with page/blog/SEO/campaign summaries, recent activity, future analytics placeholders, and prominent `Edit site` action.
  - Keep this shell around both site and blog-template builders; builder-specific controls remain on the right.
  - Acceptance: navigating to the builder never replaces or duplicates the permanent left navigation.
  - Verify: route, layout, responsive drawer, focus, and navigation tests.

- [x] **P11-T2 — Navigation/menu builder element**
  - Add a navigation element that references page IDs, blog index, or safe external links; support reorder, nested submenu, styles, active state, and mobile hamburger behavior.
  - Internal destinations must survive slug changes because bindings use IDs.
  - Acceptance: a shared header can render one responsive menu across every page and include the optional blog link.
  - Verify: menu binding, slug-change, responsive, keyboard, and renderer tests.

- [x] **P11-T3 — Blog activation and settings**
  - Add the disabled-blog onboarding state in the left sidebar and safe starter templates/settings on activation.
  - Support base path, default author, posts per page, and deactivate-without-delete behavior.
  - Acceptance: enabling blog does not publish content; disabling it hides public routes while retaining data.
  - Verify: settings API/UI and lifecycle tests.

- [x] **P11-T4 — Blog post repository and API**
  - Implement separate posts/categories/templates collections, workspace/project ownership, unique slugs, filtering, pagination, draft/publish/unpublish/delete, and public published-only reads.
  - Validate Tiptap JSON and custom field values against the current template field definitions.
  - Acceptance: draft posts never resolve publicly; cross-workspace and cross-project access is blocked.
  - Verify: repository, API, authorization, validation, and pagination tests.

- [x] **P11-T5 — Blog post dashboard**
  - Add post list, search, status/category filters, create, edit, duplicate, publish, unpublish, delete, and empty/loading/error states under the permanent left-sidebar Blog route.
  - Acceptance: the user can manage a growing blog without entering the visual builder.
  - Verify: component/integration tests.

- [x] **P11-T6 — Generated post editor**
  - Build the standard post form with Tiptap rich content, cover media, author, category, tags, slug, status, publish date, and SEO fields.
  - Generate additional form controls from stable template field definitions, including one control per distinct dynamic image field.
  - Clearly distinguish missing required fields, optional fields, inherited defaults, and fields no longer used by the published template.
  - Acceptance: a template with two distinct image bindings produces two independently saved image inputs; reusing one binding displays one input whose value may render more than once.
  - Verify: form-generation, rich-text, media, validation, and save/reload tests.

- [x] **P11-T7 — Article template builder and dynamic elements**
  - Reuse the site builder with permanent left navigation and right builder controls.
  - Add dynamic elements for title, excerpt, cover, rich content, author, date, category, custom text/image/gallery/link/date fields, and related posts.
  - On duplication, ask whether to reuse the binding or create a new field.
  - Acceptance: static decorations stay fixed while dynamic values change with the selected sample post.
  - Verify: binding, duplication choice, renderer, preview, and persistence tests.

- [x] **P11-T8 — Blog index template and repeatable post collection**
  - Add a Post Collection element whose card sub-layout can be designed once and repeated from published post data.
  - Support query/sort, category filter, pagination, responsive columns, visible fields, empty state, and safe link to each article.
  - Acceptance: adding a published post automatically appears according to the configured query without editing the index layout.
  - Verify: collection query, card renderer, pagination, responsive, and empty-state tests.

- [x] **P11-T9 — Template draft/publish lifecycle and impact report**
  - Keep draft and published template documents/versions separate; preview draft with selectable sample posts.
  - Detect added required fields, removed fields, type changes, orphaned values, and affected published posts before template publication.
  - Block unsafe publication until required values/fallbacks are resolved; retain removed field data for recovery.
  - Acceptance: editing a template does not change the live blog until explicit publish, and publishing intentionally updates all existing/future posts.
  - Verify: compatibility, versioning, rollback-safe failure, and impact-report tests.

- [x] **P11-T10 — Public blog rendering and SEO basics**
  - Resolve blog index and `${basePath}/:slug` using only published templates/posts, shared header/footer, menu, media, and responsive renderer.
  - Render semantic headings, canonical path data, title/description metadata, publication date, alt text, and article not-found behavior.
  - Acceptance: public article layout changes globally only when the article template is published.
  - Verify: public routing, metadata, security, and E2E tests.

- [x] **P11-T11 — Contextual feature registry, navigation, and site status center**
  - Implement the typed `SiteFeatureState` lifecycle and backend reconciler from saved builder references plus Blog, Forms, CMS, and Search records. Persist the revision-tagged projection on the project, reconcile after relevant mutations and project saves, and expose `/projects/:projectId/status`.
  - Split core site navigation from optional module entries. Keep optional blocks discoverable in the right Elements library, reveal their left-sidebar management route only after committed use/activation, show setup/error badges, and provide archived/unused recovery under Settings.
  - Add the persistent Site status pill and accessible status-center popover with draft/published state, blockers, warnings, affected resources, validated internal deep links, and return-to-builder context.
  - Acceptance: adding the first actual optional-module reference reveals its navigation without reload; unused modules stay hidden and never create warnings; reload/reconciliation cannot disagree with saved data; an issue action returns to the exact originating page/element when possible.
  - Verify: lifecycle reducer, source-revision reconciliation, route authorization, optimistic/rollback behavior, navigation visibility, accessible popover, deep-link validation, archived recovery, and cross-module integration tests.

**Checkpoint 11:** the application has a permanent dashboard/navigation shell, usage-driven optional modules with one persistent site-status center, and a complete optional blog workflow with globally reusable, safely publishable templates.

### Phase 12 — SEO configuration, audit, and metadata rendering

- [x] **P12-T1 — SEO contracts and inheritance resolver**
  - Implement Zod contracts for global/page/post SEO and one shared pure resolver for override -> default -> fallback behavior.
  - Normalize canonical paths, titles, descriptions, robots directives, social images, locale, and structured-data types.
  - Acceptance: editor, preview, public renderer, and future exporter consume the same resolved metadata object.
  - Verify: contract, inheritance, normalization, and fallback unit tests.

- [x] **P12-T2 — Global SEO settings**
  - Add `Settings -> SEO` under the permanent left sidebar with site name, title template, default description/social image, locale, canonical base URL, organization name/logo, default robots, and optional verification token.
  - Provide validation, examples, save state, and clear explanations without promising rankings.
  - Acceptance: new pages inherit global defaults and changing defaults does not erase page overrides.
  - Verify: settings API/component/integration tests.

- [x] **P12-T3 — Page SEO inspector**
  - Add `Page -> SEO` to the right builder panel with title, description, canonical override, robots, Open Graph, Twitter Card, and structured-data type.
  - Add search/social previews, character guidance, inherited-value indicators, and reset-to-default actions.
  - Acceptance: every page can override or inherit metadata independently and saving/reloading preserves it.
  - Verify: inspector, inheritance, persistence, and preview tests.

- [x] **P12-T4 — Dynamic blog SEO**
  - Resolve post metadata dynamically from title/excerpt/cover/author/date with per-post overrides and published article template rules.
  - Emit safe Article JSON-LD with canonical URL and optimized social image; drafts must remain noindex and absent publicly.
  - Acceptance: two posts rendered by one article template produce distinct titles, descriptions, canonicals, social cards, and Article data.
  - Verify: dynamic metadata, draft, escaping, and structured-data tests.

- [x] **P12-T5 — SEO audit and previews**
  - Implement a deterministic audit for title/description issues, heading structure, alt text, internal links, canonical/robots conflicts, oversized assets, and indexability.
  - Show project summary and actionable per-page/post results; label it as guidance, not a guaranteed ranking score.
  - Acceptance: each warning links to the exact setting or element needing correction where practical.
  - Verify: audit rule and UI tests with passing/failing fixtures.

- [x] **P12-T6 — Sitemap, robots, and metadata output**
  - Generate XML sitemap for public indexable pages and published posts, plus project robots.txt with sitemap reference.
  - Render title, description, canonical, robots, Open Graph, Twitter, and safely serialized JSON-LD in preview/public metadata.
  - Document that the production renderer must deliver server-rendered route HTML/metadata from the active published snapshot; a client-only preview is not sufficient evidence of crawler indexability.
  - Acceptance: drafts/noindex routes are excluded, XML/text outputs are valid, and metadata is unique per route.
  - Verify: sitemap, robots, metadata, security, and route tests.

**Checkpoint 12:** users can configure and audit global/page/blog SEO, and the rendering contract produces route-specific metadata, sitemap, and robots outputs.

### Phase 13 — Agency workspace, clients, campaigns, and SaaS readiness

- [x] **P13-T1 — Workspace account dashboard**
  - Implement authorized aggregate endpoint and dashboard cards/lists from Section 7: clients, sites, page/post totals, SEO issues, campaigns, storage, recent activity, and explicit analytics-not-connected states.
  - Do not load complete builder documents to calculate dashboard counts.
  - Acceptance: switching workspaces changes every number/list and cannot retain stale data from the previous tenant.
  - Verify: aggregation, cache-key, authorization, component, and workspace-switch E2E tests.

- [x] **P13-T2 — Client management**
  - Implement person/company client CRUD, lead/active/paused/archived status, primary contact, notes, search/filter, archive confirmation, and client dashboard.
  - Client records do not require authentication accounts.
  - Acceptance: an agency can open one client and see only sites/campaigns belonging to that client.
  - Verify: repository/API/UI/tenant-isolation tests.

- [x] **P13-T3 — Direct and client-owned sites**
  - Allow projects with optional `clientId`; provide `All Sites`, client-specific site creation, reassignment with permission/impact checks, and direct personal-workspace sites.
  - Acceptance: the same builder works unchanged for agency client sites and self-service personal sites.
  - Verify: creation, reassignment, filtering, authorization, and E2E tests.

- [x] **P13-T4 — Campaign summary module**
  - Implement lightweight campaign CRUD with name, client, optional site, status, dates, notes, dashboard summaries, and filtering.
  - Keep provider metrics/integrations behind a future adapter; do not fabricate campaign performance.
  - Acceptance: workspace/client/site dashboards show correctly scoped active/upcoming campaigns.
  - Verify: CRUD, relationship, aggregation, and UI tests.

- [x] **P13-T5 — Workspace team, invitations, and roles**
  - Use Better Auth Organization membership/invitation capabilities and application permission mapping for owner/admin/designer/editor/viewer.
  - Add member list, invite, revoke/cancel, role change, leave workspace, and protected ownership-transfer/deletion flows.
  - Acceptance: role permissions are enforced on the server and the final owner cannot accidentally remove the only recoverable ownership path.
  - Verify: invite, expiry, role matrix, membership removal, and security tests.

- [x] **P13-T6 — Self-service SaaS onboarding readiness**
  - Implement personal-workspace onboarding, first-site wizard, empty states, plan/entitlement abstraction, and feature-limit checks that default to a development/free entitlement without integrating payments yet.
  - Do not hardcode agency-only assumptions into navigation or project creation.
  - Acceptance: a new SaaS user can register and create a site without creating a client; an agency owner can create clients and many sites through the same APIs.
  - Verify: personal and agency onboarding E2E tests.

- [x] **P13-T7 — Analytics-ready contracts without fake data**
  - Define provider-neutral daily metrics contracts keyed by workspace/project/page/date for future views, unique visitors, referrers, devices, and campaign attribution.
  - Add `Not connected` dashboard states and adapter interfaces only; do not implement invasive tracking or claim measured traffic in this phase.
  - Acceptance: a future analytics implementation can populate widgets without changing workspace/client/project ownership schemas.
  - Verify: contract and empty-state tests.

- [x] **P13-T8 — Multi-tenant security audit**
  - Audit every collection, index, repository, cache key, background job payload, media stream, public/private preview, and aggregate endpoint for tenant scoping.
  - Add adversarial tests using two workspaces, shared users with different roles, guessed IDs, stale active-workspace state, and nested resources from another tenant.
  - Acceptance: no unauthorized cross-workspace data is returned, mutated, counted, cached, or inferred.
  - Verify: complete tenant-isolation/security suite.

**Checkpoint 13:** agency workspaces can manage clients, sites, campaigns, and teams, while self-service users use the same product through a personal workspace.

### Phase 14 — Native forms and submissions

- [x] **P14-T1 — Form contracts, persistence, and builder element**
  - Implement shared form/field schemas, stable field IDs, `draft`/`needs_setup`/`ready`/`archived` lifecycle, form-definition repository/API, and a responsive builder form element with reorderable fields and property controls.
  - On the first committed Form drop, create the definition idempotently, insert its stable reference, autosave the site draft, reveal Forms with a `Setup required` badge, and expose `Finish form setup` in the selected element's right inspector. The interaction may be optimistic but must compensate/retry safely when either definition creation or document save fails; unused orphan drafts are cleaned only after a safe grace period.
  - Keep instance-level visual/layout controls in the right inspector and long-lived definition/submission settings on the Forms route. Preserve a validated `returnTo` page/element reference between them.
  - Support short text, long text, email, phone, select, radio, checkbox, consent, and hidden attribution fields; do not support file upload in this phase.
  - Acceptance: one form can be designed, saved, duplicated, reloaded, and rendered identically in editor/preview with accessible labels and validation states; the live published snapshot is unchanged while the form remains only in the editable draft.
  - Verify: schema, idempotency, partial-failure recovery, orphan cleanup, repository, renderer, persistence, contextual navigation, return path, responsive, and accessibility tests.

- [x] **P14-T2 — Hardened public submission pipeline**
  - Implement the public submission endpoint with shared validation, strict size/count limits, honeypot, rate limiting, duplicate suppression, origin/project validation, safe normalization, consent capture, and generic success/error responses.
  - Store only configured field values, minimal attribution/path/UTM data, and operational metadata required for abuse prevention; never store arbitrary request bodies.
  - Acceptance: valid submissions are stored once; invalid/spam/oversized/cross-project attempts fail safely without leaking recipients or tenant data.
  - Verify: API, fuzz/abuse, rate-limit, authorization, validation, and concurrency tests.

- [x] **P14-T3 — Submission dashboard and lifecycle**
  - Add the contextual site-level `Forms` route with definition list, setup checklist, counts, paginated submissions, search/filter, new/read/archive/spam state, detail view, single delete, bulk archive/delete with confirmation, and empty/loading/error states.
  - Implement reference-aware last-instance removal: unused drafts may be deleted after confirmation; definitions with submissions, published references, or history are archived and recoverable rather than silently deleted. Hide Forms from primary navigation only when no active references remain.
  - Enforce optional retention days through an idempotent cleanup job scoped by workspace/project.
  - Acceptance: authorized users manage only their site's submissions, retention cannot delete another tenant's data, and hiding an unused module never loses historical submissions.
  - Verify: repository/API/UI, reference counting, archive/restore, pagination, bulk-action, retention, and tenant-isolation tests.

- [ ] **P14-T4 — Notification contract, CSV, and visitor completion states**
  - Add one provider-neutral notification adapter with a safe development sink only. Document the future provider boundary, but do not connect SMTP or a transactional-email API in this phase; future notification failure must never be allowed to lose a stored submission.
  - Add streaming CSV export with spreadsheet-formula injection protection and configurable success message or safe internal thank-you-page redirect.
  - Do not implement CRM, calendar, newsletter, webhook automation, or payment integrations.
  - Acceptance: submissions remain usable without external services; CSV is safe; notification failure does not misreport the visitor submission as lost.
  - Verify: adapter, retry, CSV security, redirect, and E2E form-submission tests.

**Checkpoint 14:** users can build accessible forms and receive, manage, and export protected submissions without an external CRM or provider integration.

### Phase 15 — General CMS and dynamic pages

- [ ] **P15-T1 — Collection schemas, presets, repositories, and APIs**
  - Implement CMS collection/item contracts and CRUD with stable field IDs, validation, draft/published state, project ownership, pagination, safe single references, and initial editable presets for Services, Portfolio, Team, Testimonials, FAQ, Jobs, Locations, and simple Catalogs.
  - Support short/long/rich text, number, boolean, date, image, gallery, link, and single-reference fields.
  - Acceptance: presets create ordinary editable collections; field renames preserve values; cross-project references and draft public reads are blocked.
  - Verify: schema, migration, repository, API, reference-integrity, authorization, and pagination tests.

- [ ] **P15-T2 — CMS dashboard and item editor**
  - Add site-level `CMS` navigation with collections, schema editor, item table, search/filter/status, create/edit/duplicate, publish/unpublish/delete, media selection, validation, and impact warnings for field changes/removal.
  - Preserve orphaned values until explicit cleanup and block destructive required/type changes that invalidate published items unless resolved.
  - Acceptance: business content can be managed without opening the visual builder and schema changes never silently discard data.
  - Verify: form generation, impact analysis, rich text/media, lifecycle, and UI tests.

- [ ] **P15-T3 — Dynamic list/repeater builder element**
  - Implement a CMS Collection element with one reusable card sub-layout, collection binding, filters, sort, limit, grid/list layout, pagination/load-more, and editable empty state.
  - Bind dynamic elements through immutable field IDs and preview with selectable real draft/published sample items.
  - Acceptance: publishing a matching item adds it to every configured listing without editing those pages.
  - Verify: query resolver, card renderer, filters, pagination, responsiveness, empty-state, and E2E tests.

- [ ] **P15-T4 — Dynamic detail templates and public routes**
  - Reuse the builder for one draft/published detail template per collection, with dynamic field bindings, shared header/footer, SEO inheritance, responsive behavior, and template impact report.
  - Resolve only published items at `/<collection-path>/<item-slug>`; keep template edits off the live/preview-published contract until explicit template publication.
  - Acceptance: one published template renders all existing and future items; drafts never resolve publicly; changes apply globally only after intentional publication.
  - Verify: route collision, slug, binding, template lifecycle, SEO, authorization, renderer, and E2E tests.

**Checkpoint 15:** sites can manage reusable business content and render dynamic listings/detail pages without duplicating layouts.

### Phase 16 — System pages, redirects, search, and essential visitor elements

- [ ] **P16-T1 — Editable system-page templates**
  - Add protected templates for 404, search results, thank-you, maintenance, and generic empty-result states using the shared renderer and safe system bindings.
  - System templates cannot be deleted or assigned conflicting routes; reset-to-safe-default remains available.
  - Acceptance: each state is brandable and responsive while preserving required status/behavior and accessibility.
  - Verify: renderer, protected-binding, route, reset, responsive, and accessibility tests.

- [ ] **P16-T2 — Slug history and redirect manager**
  - Create automatic 301 redirects for changed page, blog-post, and CMS-item paths; add authorized manual redirect list/create/edit/delete/test UI.
  - Normalize paths and reject loops, self-redirects, ambiguous duplicates, unsafe destinations, reserved routes, and excessive chains.
  - Acceptance: old links resolve to the intended current content and invalid rules cannot make the site unreachable.
  - Verify: history, collision, loop/chain, normalization, authorization, and routing tests.

- [ ] **P16-T3 — Internal site search**
  - Implement an opt-in bounded text index/query abstraction for public pages, published posts, and published CMS items using MongoDB-supported text search for this phase; keep the interface replaceable without adding Atlas Vector Search.
  - Exclude drafts, disabled/private/noindex content; add a Search input element and bind the editable search-results system template.
  - Acceptance: visitor queries return safe, relevant, paginated internal results with correct empty state and never reveal nonpublic content.
  - Verify: indexing, exclusion, ranking stability, query limits, XSS, pagination, and E2E tests.

- [ ] **P16-T4 — Essential visual elements**
  - Add icon, icon list, divider, spacer, FAQ/accordion, tabs, gallery/lightbox, safe video, social links, download button, breadcrumbs, table, pricing table, and announcement bar elements.
  - Use allowlisted icons/providers/URLs; no arbitrary iframe, HTML, CSS, or JavaScript. Reuse existing responsive sizing, inspector, copy/paste, history, visibility, and renderer contracts.
  - Acceptance: every new element saves/reloads, supports meaningful responsive settings, and renders without editor-only dependencies.
  - Verify: schema, inspector, renderer, persistence, responsive, safe-link/provider, and visual tests.

- [ ] **P16-T5 — Interactive-element accessibility**
  - Implement keyboard patterns, semantic roles/elements, focus management/restoration, accessible names/states, reduced motion, escape behavior, and touch targets for menu, form, search, FAQ, tabs, gallery/lightbox, and announcement controls.
  - Acceptance: complete visitor interaction works without a pointer and screen-reader state is not communicated by color alone.
  - Verify: automated accessibility, keyboard sequence, focus, reduced-motion, and manual checklist tests.

**Checkpoint 16:** finished sites include essential business components, branded system states, durable old URLs, and safe optional internal search.

### Phase 17 — Site readiness, accessibility, and performance

- [ ] **P17-T1 — Unified accessibility audit**
  - Implement the site-readiness accessibility rules from Section 7 with severity, route/element IDs, explanations, manual-review items, and direct editor navigation.
  - Clearly state that automated checks improve quality but do not guarantee legal compliance.
  - Acceptance: known violations are reproducible, actionable, and cannot be dismissed globally without an explicit documented acknowledgement.
  - Verify: rule fixtures, false-positive controls, route mapping, and accessibility regression tests.

- [ ] **P17-T2 — Broken-link, redirect, and content audit**
  - Audit internal ID bindings, missing routes/media, unsafe URLs, redirect loops/chains, orphaned CMS/blog bindings, empty required metadata, and unreachable system states.
  - Acceptance: the report identifies the exact source and destination problem before handoff.
  - Verify: deterministic fixture suite covering deleted/renamed pages, posts, items, media, and redirects.

- [ ] **P17-T3 — Performance budget and asset/font audit**
  - Define measured budgets for builder document/route payload, client JavaScript, image bytes/dimensions, font families/weights, layout shift risks, and above-the-fold loading priority.
  - Enforce responsive images, explicit dimensions, lazy loading below the fold, hero-image priority, safe font fallbacks, and minimal render-blocking assets in the shared renderer.
  - Acceptance: failures name the responsible route/element/asset and provide a practical fix; audits use measured output rather than unsupported performance promises.
  - Verify: build artifact checks, renderer fixtures, image/font cases, and representative Lighthouse or equivalent local audit where deterministic.

- [ ] **P17-T4 — Full responsive width sweep and readiness report**
  - Combine existing layout diagnostics with accessibility, links, content, and performance results across configured breakpoints and representative intermediate widths from `320–1920px`.
  - Add site-dashboard readiness summary, severity filters, issue ownership/status, rerun controls, and explicit `Not checked` states.
  - Acceptance: a user can understand what is ready, what is blocking, and what still needs manual review without the system claiming the site is published.
  - Verify: aggregation, stale-result invalidation, width sweep, dashboard, and end-to-end audit tests.

**Checkpoint 17:** the complete unpublished site can be audited for accessibility, broken content, responsiveness, and performance before handoff.

### Phase 18 — Production publishing, platform subdomains, and custom domains

- [ ] **P18-T1 — Publication/domain contracts and repositories**
  - Add shared Zod contracts, MongoDB repositories, indexes, migrations, and authorization for `PublishedSiteVersion`, `SiteDomain`, publication summaries/audit events, active-version pointer, normalized hostnames, reserved platform labels, and unique project slugs.
  - Automatically create exactly one platform domain `${projectSlug}.${PLATFORM_ROOT_DOMAIN}` for every project; existing projects receive an idempotent collision-safe migration.
  - Acceptance: no two projects can claim one hostname; reserved labels are rejected; immutable versions cannot be updated after creation; cross-workspace publication/domain access is impossible.
  - Verify: normalization/Punycode, reserved slug, collision, migration/retry, repository, immutability, index, and tenant-isolation tests.

- [ ] **P18-T2 — Deterministic publication builder and preflight**
  - Implement preflight and snapshot compilation from one exact project revision, including pages, shared sections, published blog/CMS content/templates, forms needed publicly, system pages, SEO, sitemap/robots data, redirects, search data, route manifest, and owned media references.
  - Reconcile contextual feature states from source records and consume the same normalized issue registry used by the Site status center. Block only incomplete/invalid modules that have saved public references; ignore unused modules and surface noncritical warnings separately.
  - Detect revision changes during compilation, route collisions, missing media/bindings, invalid SEO/redirects, unsupported schema versions, and readiness blockers. Never partially publish.
  - Acceptance: the same valid source revision produces the same normalized content hash/manifest; drafts are excluded; failures leave the active version untouched.
  - Verify: deterministic fixtures, concurrency, route collision, draft exclusion, media ownership, size limit, and failure-atomicity tests.

- [ ] **P18-T3 — Publish, history, rollback, and dashboard UI**
  - Implement publication API/UI with preflight report, explicit confirmation, progress, success/failure, permanent platform URL, active version, source revision, `Unpublished changes`, paginated history, and rollback confirmation. Feed the persistent Site status pill from this same state machine so status-center blockers and publish-screen blockers cannot disagree.
  - Write snapshot first and atomically change the active pointer; invalidate renderer caches only after commit. Retain the configured number of versions without deleting active/referenced versions.
  - Acceptance: publish/republish/rollback are atomic, authorized, auditable, idempotent on retry, and never expose half-built output.
  - Verify: transaction/compare-and-swap strategy, duplicate request, cache invalidation, retention, UI, and E2E tests.

- [ ] **P18-T4 — Multi-tenant public renderer and server HTML**
  - Add/deploy the stateless renderer service that resolves only normalized active host mappings and immutable active snapshots; implement path/redirect/404 resolution, route-specific server HTML/SEO, canonical primary-host behavior, cache, health, structured safe logs, and neutral unknown-host response.
  - Trust forwarded host/protocol only from configured Coolify/Cloudflare proxies. Do not allow query/header project IDs to override hostname mapping.
  - Acceptance: many platform/customer hostnames share one renderer process without content leakage; unknown/pending hosts never render another site; public HTML includes the correct content and metadata before client JavaScript.
  - Verify: two-tenant host/path matrix, spoofed forwarded headers, cache isolation/invalidation, redirects, SEO HTML, unknown hosts, load/concurrency, and renderer E2E tests.

- [ ] **P18-T5 — Cloudflare for SaaS provider adapter**
  - Implement a backend-only `CustomHostnameProvider` plus Cloudflare for SaaS adapter for create/get/refresh/delete, hostname ownership instructions, separate hostname/SSL statuses, timeouts/backoff, idempotency, provider error mapping, and mocked tests.
  - Use least-privilege token and configurable endpoints. Never call real provider APIs from unit/E2E tests or expose credentials/provider responses to the browser.
  - Acceptance: provider outages do not affect already active rendered sites; new activation remains pending/retryable; duplicate requests cannot create conflicting mappings.
  - Verify: fake provider contract, recorded response fixtures within allowed copyright/security limits, retry/backoff, timeout, outage, idempotency, and secret-redaction tests.

- [ ] **P18-T6 — Custom-domain onboarding UI and lifecycle**
  - Add `Site -> Settings -> Domains`: platform URL, add customer subdomain, normalized preview, exact CNAME/TXT/HTTP instructions returned by provider, hostname/SSL status, last checked, refresh, primary selection, failure guidance, and disconnect confirmation.
  - Officially support `www.customer.com`/other subdomains first. Explain apex requirements honestly and do not mark active until local association, provider hostname, SSL, and DNS are all active.
  - Acceptance: an authorized user can connect a disposable test subdomain, watch status transitions, make it primary, redirect secondary domains, and disconnect it without deleting the site.
  - Verify: state-machine, DNS/status polling, primary/canonical redirects, permissions, disconnect, provider-failure UI, and E2E tests with fakes plus one documented manual staging smoke test.

- [ ] **P18-T7 — Environment validation and Coolify production manifests**
  - Complete `.env.example`, service-specific env schemas, Dockerfiles/Compose or Coolify-compatible manifests, frontend gateway route configuration, health checks, graceful shutdown, ports, trusted proxy configuration, resource limits, and frontend/backend secret separation exactly as defined in Section 8.
  - Add an operator guide with apex/root frontend routing, `/api/*` private-backend proxying, SPA fallback exclusions, DNS records, wildcard project routing, Cloudflare fallback/CNAME target, Traefik renderer catch-all, origin TLS/DNS challenge when needed, Coolify service configuration, environment placement, and validation checks without real secrets.
  - Acceptance: a new production environment can be configured from documentation; startup fails safely for missing/invalid variables; no backend secret enters the frontend bundle.
  - Verify: clean production build, env-schema fixtures, container health, secret scan/frontend bundle inspection, Compose/config validation, and documented staging deployment rehearsal.

- [ ] **P18-T8 — Operational hardening, backups, and publication smoke tests**
  - Configure/document external encrypted MongoDB/Coolify backups, retention and restore rehearsal; disk/CPU/memory/uptime monitoring; proxy/API/renderer logs; alerts for publish failure, unknown-host spikes, DNS/SSL failures, and expiring/failed certificates where provider status exposes them.
  - Smoke-test root marketing/auth/`/app/*` routes, `/api/health`, technical origin health, direct `${projectSlug}.${PLATFORM_ROOT_DOMAIN}`, customer CNAME, unknown host, publish, content update, secondary-to-primary redirect, rollback, provider outage, and service restart.
  - Acceptance: restart/deploy cannot erase published mappings/versions; restore procedure is proven in staging; active sites remain served when the custom-hostname provider API is temporarily unavailable.
  - Verify: backup/restore record, restart/redeploy tests, staging smoke checklist, and incident runbook review.

**Checkpoint 18:** one Coolify-managed renderer serves every published site at a direct project subdomain and verified customer domains with atomic versions, rollback, server-rendered SEO, managed SSL, and documented operations.

### Phase 19 — Hardening and handoff

- [ ] **P19-T1 — Complete automated coverage**
  - Fill unit/API/integration gaps for schemas, URLs, history, pages, renderer, persistence, conflicts, errors, locale precedence, translation-key parity, and hardcoded user-facing copy detection.
  - Acceptance: tests are deterministic and do not depend on a developer's personal database.
  - Verify: `npm test`.

- [ ] **P19-T2 — Main Playwright E2E flow**
  - Automate the full MVP flow from Section 1 in an isolated test environment. Run the core journey in both `pt-BR` and `en-US`, including public selection, authenticated Settings selection, reload, workspace switch, logout/login, localized accessibility labels, and confirmation that builder-authored content is unchanged.
  - Acceptance: tests prove save/reload, preview navigation, immediate language switching, and persisted preference in both locales.
  - Verify: `npm run test:e2e`.

- [ ] **P19-T3 — Documentation and environment setup**
  - Complete the English README, `.env.example`, installation, scripts, architecture, repository/branch workflow, MongoDB/Better Auth/media/i18n setup, testing, responsive behavior, publishing/domain/Coolify/Cloudflare operations, known limitations, and optional future static-export path.
  - Never commit secrets or real credentials.
  - Acceptance: a new developer can run the project using only the documentation.
  - Verify: follow README from a clean install state where practical.

- [ ] **P19-T4 — Enforce GitHub promotion and deployment policy**
  - Confirm `development` is the default collaboration branch and repository rules prevent force-push/deletion of `main`. Require pull requests and the available typecheck/test/build/security checks before `development` can merge into `main`; configure equivalent protection for `development` where it will not block the planned task-branch flow.
  - Configure/document Coolify production deployment from `main` only and optional isolated staging from `development`. Verify a task branch cannot deploy production and a failed required check cannot promote `development` to `main`.
  - If GitHub plan/permissions prevent an automated rule, document the exact manual configuration and residual risk; do not weaken local/CI quality gates silently.
  - Acceptance: the remote, default branch, protections, pull-request path, and deployment sources match Section 3 with no direct-production shortcut.
  - Verify: GitHub rules/default branch inspection, one non-destructive pull-request/check dry run where practical, and Coolify source-branch configuration review.

- [ ] **P19-T5 — Final quality gate**
  - Remove dead code, debug logs, permanent mocks, warnings, and TODOs that block MVP behavior.
  - Do not expand scope during cleanup.
  - Acceptance: all MVP criteria pass, both locale catalogs are complete, branch/deployment protections are active or explicitly blocked, and known non-blocking limitations are documented.
  - Verify: `npm run typecheck && npm run test && npm run build && npm run test:e2e`.

**Checkpoint 19:** complete bilingual multi-tenant builder, blog, CMS, forms, system pages, search, accessibility, performance, publishing/domains, media optimization, SEO, agency, and SaaS-ready product passes user acceptance testing and promotes production only from protected `main`.

---

## 10. Per-task execution protocol

For every task:

1. Read the task, its dependencies, and affected existing code.
2. Mark only that task `[~]`.
3. State the smallest intended change internally or in the session task list.
4. Implement without unrelated refactors.
5. Add or update tests in the same task. Any user-facing UI change must add/update both `pt-BR` and `en-US` locale resources and cannot introduce hardcoded visible copy.
6. Run the task-specific verification command.
7. Run impacted workspace typecheck/build.
8. Fix all failures caused by the task.
9. Mark `[x]` and append a short Progress Log entry.
10. Continue to the next unblocked task.

Do not stop merely because a phase ends. Stop only for:

- missing credentials or a service the user must configure;
- a destructive or irreversible decision requiring approval;
- conflicting requirements that materially change the product;
- repeated failure after documenting concrete diagnostics and attempted safe fixes.

When blocked, mark `[!]`, record the exact blocker, and continue with other tasks only if doing so cannot hide or worsen the blocker.

---

## 11. Quality gates

The implementation is not complete unless:

- TypeScript strict checks pass.
- `origin` is exactly `https://github.com/Gabrielleobeltrao/WebsiteBuilder.git`; `main` and `development` are the only long-lived branches; work integrates through `development`; and production promotion/deployment occurs only from reviewed, green `main`.
- Claude's user-facing communication is in Brazilian Portuguese while committed technical artifacts remain in English, as defined in Section 0.
- The complete platform UI is available in `pt-BR` and `en-US`; both locale catalogs have key parity; user-facing strings are not hardcoded; and every UI task updates both languages.
- An authenticated language choice persists per user across reload, relogin, device, and workspace switch; unauthenticated explicit choice persists locally; `document.lang` and `Intl` formatting match the active locale.
- Backend error codes are stable and language-neutral, frontend messages are localized, backend logs remain English, and changing platform locale never mutates customer-authored site/blog/form/CMS content.
- Root `CLAUDE.md` stays concise and project skills use progressive disclosure; one normal plan task can be extracted without loading this complete plan.
- Project subagents have unique routing descriptions, least-privilege tools, bounded scope/turns, compact handoffs, and no two concurrent writers own the same file or contract.
- Ponytail and Graphify versions/sources/hooks are reviewed and recorded; third-party benchmark claims are never treated as guaranteed project savings.
- Graphify queries point to current source evidence, generated artifacts exclude secrets/build/dependency noise, and the graph is refreshed at checkpoints before it informs broad changes.
- `/run` and `/verify` use a reviewed project run recipe generated after the real root startup flow exists.
- Production builds pass.
- Automated tests pass.
- No secrets are committed.
- No arbitrary HTML/JS execution exists.
- Unsafe links are rejected on client and server.
- The real backend is used for the principal flow.
- Save conflicts are visible and do not silently overwrite.
- Drag/resize remains correct under canvas scaling.
- Free elements expose four corner and four side resize handles and remain manually resizable.
- Grid/flex behavior is scoped to its section and never removes free-layout capability elsewhere.
- Presets, custom breakpoints, intermediate widths, and container-query rules resolve identically in editor, preview, and public renderer.
- Responsive values accept only structured allowlisted units/functions; arbitrary CSS strings cannot enter persisted documents.
- Free-layout constraints, grid/flex intrinsic behavior, min/max sizing, aspect ratio, and fluid typography remain valid from `320–1920px` test widths.
- Continuous preview diagnostics identify overflow, clipping, off-canvas content, impossible constraints, overlap, and accessibility sizing issues.
- Authentication and project/media ownership are enforced by the backend.
- Uploaded media is validated and isolated by verified workspace membership.
- Shared headers/footers update every referencing page.
- The permanent left application sidebar and right builder sidebar remain distinct.
- Core site navigation remains stable; optional Forms/Blog/CMS/Search management entries appear only from reconciled saved use or explicit activation, while their addable blocks remain discoverable in the right Elements library.
- Feature visibility and badges survive reload and match source records at the current project revision; client-only flags cannot hide an active module or mark an incomplete module ready.
- Adding the first Form block creates an idempotent durable draft plus a stable page reference, reveals Forms with `Setup required`, and leaves the active published snapshot unchanged.
- Removing a final module reference never silently deletes definitions, submissions, published history, or recoverable data; archive/recovery and unused-draft cleanup follow the documented reference rules.
- The persistent Site status center and publication preflight consume one issue registry, distinguish blockers from warnings, deep-link to the affected configuration, and never block on an unused optional module.
- The public and authenticated left sidebars are separate route layouts and are never mounted together.
- Home and Roadmap share the responsive public sidebar; public navigation remains keyboard-accessible and clearly indicates the active route.
- Public roadmap labels distinguish released, in-progress, planned, and uncommitted ideas without exposing internal implementation details or presenting estimates as guarantees.
- Primary management workflows have dedicated routes/pages; modals are limited to short blocking decisions and compact transient pickers use accessible popovers.
- Selecting any editable canvas element gives unambiguous editor-only visual feedback and replaces the fixed right panel with that element's inspector without moving the canvas.
- Deselect/Back restores the remembered Pages/Elements/Layers mode and appropriate panel scroll; switching selection does not pollute undo history or reset canvas zoom/scroll.
- Text, image, button, section, container, form, CMS, and visitor-component inspectors use the shared Content/Style/Layout/Responsive/Advanced organization while exposing only relevant controls.
- Popovers/dialogs/pickers have correct stacking, focus trap/restoration, Escape/outside-click rules, accessible titles/names, loading/error states, and background-shortcut suppression.
- Visual authoring routes for pages, blog/CMS/system templates, shared sections, and form layout are desktop-class only; mobile/tablet-class access never mounts mutation-capable editor interaction or autosave code.
- `Preview Desktop` and `Preview Mobile` use the same saved/draft document and responsive resolver at different widths; preview-mode switching never mutates breakpoint data.
- Mobile preview uses the actual available viewport; Desktop preview on a phone is explicitly scaled read-only output and is never mistaken for the responsive mobile result.
- Crossing the desktop authoring-width threshold pauses/resumes editing without losing unsaved state, selection, panel state, scroll, or zoom.
- Blog template drafts never alter the live blog before explicit publication.
- Dynamic template fields generate matching post form controls using stable field IDs.
- Public blog routes expose only published posts and templates.
- Every stored uploaded image output is an optimized WebP variant produced by the backend.
- Responsive images use `srcset`/`sizes`, explicit dimensions, and appropriate loading priority.
- Global/page/post SEO inheritance is deterministic and shared by editor, preview, and export contracts.
- Sitemap excludes drafts/noindex content; metadata and JSON-LD are safely escaped per route.
- SEO UI makes no guarantee of ranking and documents the need for indexable published HTML.
- Every business collection and aggregate is scoped by required `workspaceId`; client-owned sites additionally validate `clientId` belongs to that workspace.
- Personal SaaS and agency client sites use the same project/builder schemas and APIs.
- Dashboard traffic/campaign-performance widgets never present fabricated analytics.
- Workspace roles are enforced server-side, including media, preview, blog, SEO, and background operations.
- Public form submissions are schema-validated, bounded, rate-limited, spam-protected, tenant-scoped, and never expose notification recipients or internal errors.
- Submission exports neutralize spreadsheet formulas; retention and deletion actions are authorized, auditable, and project-scoped.
- CMS schema changes preserve values by immutable field ID; only published items/templates resolve publicly and references cannot cross project/workspace boundaries.
- Slug changes preserve old paths through validated 301 rules; redirect loops, conflicts, unsafe targets, reserved paths, and excessive chains are rejected.
- Search never indexes or returns drafts, disabled/private/noindex content, hidden fields, or cross-tenant data.
- Interactive visitor elements work by keyboard, expose correct semantics/state, retain visible focus, restore focus after dialogs, and respect reduced motion.
- Site-readiness findings identify exact routes/elements and distinguish deterministic failures, warnings, and manual review; they never claim guaranteed legal compliance or publication.
- Performance audit checks measured route/assets/fonts/layout risks and the shared renderer applies responsive images, explicit dimensions, correct loading priority, and lazy loading below the fold.
- Every project receives exactly one collision-safe `${projectSlug}.${PLATFORM_ROOT_DOMAIN}` hostname and reserved infrastructure subdomains can never be claimed by projects.
- Publishing compiles one exact revision into an immutable version and changes live traffic only through an atomic active-version pointer; a failed publish cannot alter the live site.
- Rollback is authorized, schema/media validated, atomic, audited, and does not overwrite immutable versions or editor drafts.
- Public requests resolve project identity only from a normalized active hostname; unknown/pending/disconnected/spoofed hosts never fall back to another tenant or client-supplied project ID.
- Public HTML contains route-specific content, canonical metadata, redirects, sitemap/robots behavior, and 404 responses without requiring client-side JavaScript for core crawlability.
- Custom hostnames are considered ready only when local ownership, DNS target, provider hostname status, and provider SSL status are all active; credentials remain backend-only and redacted.
- Existing active domains continue serving during a Cloudflare management-API outage; activation/reverification is idempotent and retryable.
- Coolify production configuration includes exact service domains, wildcard/catch-all routing, health checks, trusted proxies, env placement, resource limits, backups, monitoring, and a staging smoke test.
- No backend secret is present in frontend `VITE_*` variables, build artifacts, logs, documentation examples, or committed files.
- The SaaS has one user-facing origin `${PLATFORM_PUBLIC_ORIGIN}`: marketing/auth/application routes use normal paths and API calls use same-origin `/api/*`; no normal workflow redirects to `app.*` or `api.*`.
- The frontend gateway never applies SPA `index.html` fallback to `/api/*`; backend health/errors/status/content types pass through unchanged.
- Better Auth session cookies work across `/app/*` and `/api/*` on the same origin with production-safe `Secure`, `HttpOnly`, and reviewed `SameSite`/path settings.
- Technical `origin.*` and `customers.*` hostnames are excluded from product navigation, canonical SaaS URLs, auth callbacks, and user-facing dashboard links.
- Reload preserves pages, elements, properties, and z-order.
- Preview uses the shared renderer.
- README accurately describes setup and limitations.

---

## 12. Known risks and mitigations

| Risk | Mitigation |
|---|---|
| Free positioning and responsive layouts conflict | Combine anchors/constraints, typed fluid sizes, deterministic inheritance, and explicit overrides only where necessary. |
| Grid/flex accidentally limits the whole editor | Scope layout mode to each section and test mixed-mode pages. |
| Switching layout modes loses work | Warn, convert deterministically, retain an undoable snapshot, and never silently discard elements. |
| Drag coordinates break when canvas is scaled | Centralize screen/logical coordinate conversion and test multiple zoom levels. |
| Arbitrary CSS values enable injection or invalid layouts | Persist structured allowlisted units/keywords/clamp values and serialize through one validated renderer. |
| Custom breakpoints become ambiguous | Validate ordering/ranges, reject duplicate boundaries, and use one deterministic resolver shared everywhere. |
| Viewport breakpoints fail inside reusable narrow containers | Support opt-in container queries and test the same component in differently sized parents. |
| Layout works at presets but breaks between them | Provide continuous-width preview, automated width sweep, and diagnostics across boundaries/intermediate sizes. |
| Responsive diagnostics become noisy | Classify severity, report exact element/width range, allow intentional-overlap acknowledgement, and never auto-mutate layouts. |
| Huge undo snapshots consume memory | Limit to 100 actions; initially use immutable snapshots/patches and measure before optimizing. |
| A giant `CLAUDE.md` or skill increases every turn's context | Keep always-loaded memory short, route details through on-demand references, and measure the extracted task packet against the full plan. |
| Too many subagents increase total token usage or duplicate work | Delegate only bounded noisy/reusable tasks, prefer one low-cost read-only navigator, require compact handoffs, and skip agents for small direct changes. |
| Parallel agents overwrite shared work | Freeze shared contracts first, declare write sets, use isolated worktrees for concurrent writers, and integrate one verified change at a time. |
| Graphify graph becomes stale or bloats the repository | Refresh at phase/architecture checkpoints, confirm exact source before editing, ignore local artifacts, and commit generated outputs only after measuring size/noise. |
| Third-party skill/plugin introduces unsafe hooks or unexpected behavior | Inspect source and hooks before trust, use project scope/least privilege, record the installed version, and keep validation/security requirements authoritative. |
| Remote repository already contains private, divergent, or unrelated history | Authenticate and fetch first, inspect ancestry/status/remotes, preserve every existing commit, and stop for a real conflict instead of force-pushing or replacing history. |
| Work reaches production from the wrong branch | Keep only `main`/`development` long-lived, protect `main`, require reviewed green promotion, and configure Coolify production to track `main` only. |
| Translation catalogs drift or visible copy is hardcoded | Enforce namespace conventions, key-parity and hardcoded-copy checks, and require both locales in the definition of done for every UI task. |
| Saved locale fights browser or pre-login preference | Use deterministic precedence: authenticated saved preference; otherwise explicit local choice; then browser/`Accept-Language`; finally `en-US`. Seed only when the account has no preference. |
| Portuguese text breaks layouts or accessibility | Test both locales at target widths, allow text wrapping/expansion, localize ARIA and validation copy, and never size controls from English text alone. |
| Platform language switching accidentally translates customer sites | Keep application locale separate from `SiteSeoSettings.locale` and builder content; never run automatic translation on authored documents in this scope. |
| Autosave races or overwrites | Debounce, serialize saves, track dirty generation, and require project revision. |
| Editor and preview drift apart | One shared pure renderer and centralized style/link utilities. |
| MongoDB document becomes too large | Embed for atomic MVP; monitor size; split pages/assets only when real limits justify it. |
| User-controlled URL leads to XSS | Typed links, protocol allowlist, server validation, no raw HTML, safe new-tab attributes. |
| Library incompatibility with React 19 | Confirm current compatibility before installation; record substitution if required. |
| Deleted page leaves broken internal links | Detect references and show repairable invalid state; optionally warn before page deletion. |
| Uploaded image abuse or unsafe files | Authenticate, sniff MIME, limit bytes/dimensions, reject SVG initially, and stream safely. |
| Cross-workspace data access | Scope every server query/cache/job by verified workspace membership and test with multiple users/workspaces/roles. |
| Template change breaks existing posts | Separate draft/published versions, run an impact report, default new fields to optional, and block incompatible publication. |
| Renaming/removing blog fields loses data | Store values by immutable field ID and retain orphaned values until explicit cleanup. |
| Dynamic and static images are confused | Give dynamic elements a visible binding badge and keep static decoration unbound. |
| Two template images create ambiguous author input | Let duplication reuse one binding or create a new field; generate one form input per distinct field ID. |
| Image conversion creates partial/corrupt media records | Process and store variants atomically; clean temporary/orphaned bytes on failure. |
| Malicious or enormous image exhausts resources | Sniff bytes, cap input size/pixels/dimensions, reject unsupported/animated files, and configure Sharp limits/timeouts. |
| WebP conversion damages orientation/transparency | Autorotate before stripping metadata and test transparent/oriented fixtures. |
| SEO settings imply guaranteed ranking | Present deterministic checks as guidance and explain content, authority, performance, crawlability, and publishing requirements. |
| SPA metadata is not reliably indexed | Keep SEO in the render contract and require the implemented production renderer to return server-rendered HTML/metadata from the active snapshot. |
| Incorrect canonical/noindex removes pages from search | Validate conflicts, preview resolved directives, and warn prominently before publish/export. |
| Adding multi-tenancy late requires a destructive rewrite | Require `workspaceId` from the first migration and make `clientId` optional on projects. |
| Guessed nested IDs cross tenant boundaries | Verify workspace membership first, then verify every client/project/post/media relationship within the same tenant. |
| Workspace switch shows stale tenant data | Include workspace ID in query/cache keys, cancel stale requests, and clear tenant-scoped stores on switch. |
| Agency role is confused with platform super-admin | Keep platform administration separate and never grant it through workspace subscription/ownership. |
| Dashboard implies analytics that are not connected | Display explicit empty/not-connected states until verified data exists. |
| Public forms become a spam/data-abuse channel | Strict field schemas and limits, honeypot, rate limiting, duplicate suppression, minimal metadata, retention, and generic responses. |
| Optional modules clutter every site | Keep addable blocks discoverable but derive left-sidebar management entries from committed usage/activation and hide only truly unused modules. |
| Feature menu visibility becomes stale after reload or deletion | Treat source documents as authoritative, revision-tag the derived projection, reconcile after mutations/read/publish, and test repair of stale projections. |
| First Form drop creates an orphan or broken reference | Use stable client action/idempotency IDs, recoverable two-step persistence, retry/compensation, safe orphan grace-period cleanup, and publication blocking until setup is valid. |
| Hiding Forms makes historical submissions inaccessible | Archive definitions with submissions/history, expose recovery under Settings, and never silently cascade-delete business data when the last canvas instance is removed. |
| Status pill and publish screen disagree | Build both from one normalized backend issue registry reconciled against the same project revision. |
| CSV export triggers formulas on open | Prefix/escape formula-leading cells and test common spreadsheet injection payloads. |
| CMS schema edits destroy existing content | Immutable field IDs, compatibility impact report, orphan retention, draft/published separation, and explicit destructive confirmation. |
| Dynamic routes collide with pages/blog/system paths | Central route registry, reserved paths, normalized uniqueness validation, and collision tests before save/publish. |
| Redirects create loops or hide content | Detect self/loop/chain/conflict cases, limit hops, provide test UI, and preserve an undoable change record. |
| Search leaks drafts or another tenant's content | Build/query the index from explicit public records scoped by project and test adversarial status/workspace combinations. |
| New interactive widgets are visually correct but inaccessible | Ship keyboard/focus/semantics/reduced-motion tests with each widget rather than relying only on the final audit. |
| Performance scoring becomes misleading or flaky | Prefer deterministic budgets and measured artifacts; label environment-dependent lab metrics separately and never promise real-user scores. |
| Right-panel switching makes the canvas jump or loses context | Keep one fixed-width panel region, model modes explicitly, remember return/scroll state, and never alter logical canvas geometry when UI chrome changes. |
| Inspector controls become inconsistent across element types | Use shared Content/Style/Layout/Responsive/Advanced primitives, typed control metadata, centralized validation, and element-specific capability maps. |
| Continuous inspector edits flood undo history | Open one transaction on focus/pointer start and commit on blur/Enter/pointer end, with cancellation restoring the prior value. |
| Popups become the default navigation system | Require dedicated routes for long-lived workflows, allow one modal maximum, and reserve popovers/dialogs for the documented transient cases. |
| Overlay traps focus or canvas shortcuts fire behind it | Central overlay manager, focus trap/restoration, background inert state, Escape policy, and keyboard regression tests. |
| Mobile editing UI becomes cramped and unreliable | Do not implement touch visual authoring in this version; route phones/tablet-class devices to clean Desktop/Mobile preview only. |
| Device detection blocks valid users or enables accidental editing | Combine configurable viewport and pointer capability checks, avoid user-agent-only logic, and treat the gate as UX while server authorization remains authoritative. |
| Narrowing a desktop window loses unsaved changes | Pause editor interaction in place, preserve local state, and resume only after the desktop-class requirement is restored. |
| Desktop preview on a phone is confused with mobile responsiveness | Label it as scaled desktop output, keep Mobile preview separate, and never persist scale as a breakpoint/layout change. |
| Wildcard project hostname captures infrastructure subdomains | Create explicit DNS/router rules first, enforce a server-side reserved list, and test every reserved label against project creation/rename. |
| Host header spoofing leaks another site | Normalize host, trust forwarded headers only from configured proxies, resolve only active domain records, and never accept project ID as public routing authority. |
| Publish failure breaks the live site | Compile/validate/write immutable version first and atomically swap the active pointer only after success. |
| Concurrent publish/rollback races | Use project-scoped lock plus revision/active-version compare-and-swap and idempotency keys; expose a clear conflict instead of last-write-wins. |
| Custom domain points to another tenant | Global unique hostname index, ownership/provider validation, project association checks, and neutral pending/unknown-host responses. |
| Cloudflare API outage takes active sites down | Keep runtime host mappings/snapshots local and provider calls out of the request path; only onboarding/status refresh depends on provider availability. |
| Catch-all renderer accidentally serves the SaaS or API | Exact apex/root gateway rule has priority; the gateway owns `/api/*`; renderer validates active host mapping and returns neutral rejection for infrastructure/unknown hosts. |
| SPA fallback converts an API outage into a fake HTML success | Exclude `/api/*` from frontend fallback, proxy it before SPA routing, preserve backend status/content type, and test backend-unhealthy behavior. |
| Same-origin proxy creates ambiguous auth/cookie paths | Fix Better Auth at `/api/auth`, use secure host-wide session cookie settings where required, validate callback URLs, and test login/refresh/logout under `/app/*`. |
| Secrets leak through Vite or Coolify logs | Strict service-specific env schemas, public-variable allowlist, secret redaction, frontend bundle scan, and least-privilege tokens. |
| Single VPS failure takes every site offline | External encrypted backups, tested restore, uptime/resource/disk alerts, stateless renderer design, and documented later replica/multi-server migration. |

---

## 13. Future phases — do not implement now

1. Optional static-file export/CDN mode in addition to the implemented server-rendered multi-tenant publication path.
2. External object storage/CDN migration, AVIF negotiation, focal-point crops, and advanced image optimization.
3. Universal apex-domain automation beyond DNS providers that support compatible flattening/ALIAS; advanced Cloudflare Apex Proxying only after explicit cost/plan approval.
4. Templates and reusable design system.
5. AI-assisted page/layout/content generation using the same builder schema.
6. Collaboration, comments, richer document version history, and granular permissions.
7. Advanced keyword/content research, backlink/competitor tooling, analytics, animations, scheduled publication, RSS, imports, file-upload forms, multi-step/conditional forms, and external integrations.
8. SaaS billing, subscriptions, trials, invoices, quotas, metered usage, plan enforcement, and customer billing portal.
9. First-party analytics collection or provider integrations, consent/privacy controls, retention policies, campaign attribution, and verified traffic dashboards.
10. Client portal/approvals, white labeling, custom roles, agency billing, and client-facing reports.
11. Multilingual customer websites with per-page/post/CMS locale variants, language-specific URLs/SEO, fallback rules, and optional translation assistance. This is separate from the bilingual SaaS interface implemented now.

---

## 14. Decision Log

Append entries; do not erase history.

| Date | Task | Decision | Reason |
|---|---|---|---|
| YYYY-MM-DD | Initial | Hybrid section layout | Each section can use free, grid, or flex layout without globally restricting the page. |
| YYYY-MM-DD | Initial | Eight-handle free resize | Free elements remain manually resizable from four corners and four sides. |
| YYYY-MM-DD | Initial | Two persistent navigation layers | Left sidebar navigates the application; right sidebar controls the active builder. |
| YYYY-MM-DD | Initial | Schema-driven blog templates | One published article template renders all posts; distinct dynamic slots generate matching post fields. |
| YYYY-MM-DD | Initial | Draft/published template versions | Layout experimentation cannot silently break the live blog. |
| YYYY-MM-DD | Initial | Backend-only WebP pipeline | Every uploaded raster image is validated and stored as responsive optimized variants. |
| YYYY-MM-DD | Initial | Layered SEO settings | Site defaults, page overrides, and dynamic post metadata resolve through one shared contract. |
| YYYY-MM-DD | Initial | Honest SEO boundary | Metadata is prepared now, but reliable crawlability requires pre-rendered/static or server-rendered public output. |
| YYYY-MM-DD | Initial | Workspace-first multi-tenancy | Every business record belongs to a workspace from the first migration. |
| YYYY-MM-DD | Initial | Optional client ownership | Agency sites may belong to clients; personal SaaS sites can belong directly to a workspace. |
| YYYY-MM-DD | Initial | One product architecture | Agency and self-service SaaS modes share schemas, APIs, renderer, and builder. |
| YYYY-MM-DD | Initial | No fake analytics | Dashboard placeholders remain visibly unconnected until real measurement is implemented. |
| YYYY-MM-DD | Initial | Presets plus continuous responsiveness | Desktop/tablet/mobile are shortcuts; arbitrary supported widths must render correctly. |
| YYYY-MM-DD | Initial | Typed responsive values | Units, clamp, intrinsic sizes, constraints, and breakpoints are structured data rather than arbitrary CSS. |
| YYYY-MM-DD | Initial | Viewport and container responsiveness | Pages respond to viewport width; reusable nested components may respond to their container width. |
| 2026-08-10 | Public SaaS navigation | Use separate `PublicShell` and `AuthenticatedAppShell` route layouts | Marketing navigation and workspace navigation have different audiences, permissions, content, and responsive behavior and must never be mixed. |
| 2026-08-10 | Initial public pages | Launch Home and Roadmap as the only primary public navigation destinations | Keeps the first SaaS surface focused while providing a clear acquisition path and honest product visibility. |
| 2026-08-10 | Native forms first | Store/manage submissions without requiring an external CRM | Business sites need lead capture now; provider integrations can be added later through adapters. |
| 2026-08-10 | General CMS | Reuse schema-driven list/detail templates beyond the specialized blog | Services, portfolios, teams, testimonials, jobs, locations, and catalogs should not require duplicated pages. |
| 2026-08-10 | Durable visitor routes | Add editable system pages, slug history, validated 301 redirects, and optional internal search | Finished sites need recoverable navigation and content discovery without exposing drafts. |
| 2026-08-10 | Essential components only | Add common business-site elements through safe typed schemas and postpone arbitrary embeds/integrations | Expands practical site output without introducing unbounded HTML/JavaScript or provider complexity. |
| 2026-08-10 | Readiness before publishing | Consolidate accessibility, links, responsiveness, and performance audits before the hosting decision | The site can be evaluated honestly while URL/domain/deployment architecture remains a deliberate follow-up. |
| 2026-08-10 | Defer URL and deployment choice | Do not select hosting, domains, static export, or SSR in this revision | User requested that publishing strategy be discussed after the approved site capabilities are planned. |
| 2026-08-10 | Selection-driven inspector | Clicking an element replaces the fixed right-panel content with that element's inspector and returns to the prior mode on deselect/Back | Keeps the canvas central, makes editing context obvious, and avoids competing panels. |
| 2026-08-10 | Consistent inspector anatomy | Organize element settings into Content, Style, Layout, Responsive, and Advanced capability groups | Buttons, text, images, sections, and future components stay predictable without showing irrelevant controls. |
| 2026-08-10 | Pages before popups | Long-lived workflows receive dedicated routes; one modal is reserved for blocking/transient tasks and popovers for compact anchored choices | Improves navigation, refresh/back behavior, accessibility, and prevents a maze of nested dialogs. |
| 2026-08-10 | Editor-only selection feedback | Use high-contrast outline, type/name label, valid handles, hover boundary, and Layers recovery for locked/hidden elements | The active target remains unmistakable without contaminating preview or public output. |
| 2026-08-10 | Desktop-only visual authoring | Restrict page/blog/CMS/system-template and visual form/layout editing to a desktop-class viewport with a fine pointer | The initial mobile surface lacks reliable room for canvas, sidebars, selection handles, and precise layout control. |
| 2026-08-10 | Two primary previews | Expose `Preview Desktop` and `Preview Mobile` everywhere visual layouts are authored | Gives users an obvious comparison while retaining tablet/custom widths as advanced desktop controls. |
| 2026-08-10 | Mobile preview-only | Mobile/tablet-class editor routes render saved/draft previews and navigation without mutation, inspector, drag/resize, or autosave | Preserves review capability without shipping a cramped or misleading touch editor. |
| 2026-08-10 | Publishing decision completed | Supersede the earlier deferred URL/deployment decision with Coolify-hosted multi-tenant server rendering and Cloudflare for SaaS custom hostnames | User approved the proposed production architecture and requested it in the executable plan. |
| 2026-08-10 | Direct platform subdomains | Use `${projectSlug}.${PLATFORM_ROOT_DOMAIN}` with no `.sites` label | Gives every project the short first-party URL requested by the user. |
| 2026-08-10 | Reserved infrastructure labels | Protect app/api/admin/origin/customers/coolify/status/mail/cdn/assets/static/docs/support and configurable additions | Wildcard project routing must not claim or shadow operational services. |
| 2026-08-10 | One public renderer | Serve all published platform/custom domains from one stateless backend renderer entrypoint, not one container per site | Keeps Coolify/VPS resource count manageable and allows later horizontal scaling without DNS redesign. |
| 2026-08-10 | Immutable atomic publication | Compile an exact project revision to an immutable server-renderable snapshot, then atomically switch the active pointer | Draft/autosave changes and failed builds cannot break a live client site; rollback stays simple. |
| 2026-08-10 | Cloudflare for SaaS adapter | Use a provider abstraction with Cloudflare for SaaS for customer hostname verification and edge SSL | Supports scalable custom domains while keeping provider APIs out of the public request path. |
| 2026-08-10 | Subdomain-first customer onboarding | Officially support `www`/customer subdomains by CNAME; treat universal apex automation as a later capability | Avoids promising apex behavior that varies by DNS provider or requires advanced paid features. |
| 2026-08-10 | Single SaaS origin | Serve marketing, auth, dashboard, builder, and API from `https://${PLATFORM_ROOT_DOMAIN}` using `/app/*` and `/api/*`, not `app.*`/`api.*` | User wants the entire product to remain on one domain and navigate through path routes. |
| 2026-08-10 | Same-origin frontend gateway | Publish only the root domain to the SaaS gateway; proxy `/api/*` internally to backend and serve the React application for other routes | Avoids cross-origin product URLs/CORS while keeping backend private inside the Coolify stack. |
| 2026-08-10 | Technical hosts remain hidden | Keep `origin.*` and `customers.*` only for renderer/Cloudflare routing | Custom-domain infrastructure still needs hostnames, but users should never navigate the SaaS through them. |
| 2026-08-10 | Usage-driven optional modules | Keep optional blocks in the right Elements library but show Forms/Blog/CMS/Search management in the left site sidebar only after committed usage or explicit activation | Preserves discoverability without filling every site with irrelevant administrative navigation. |
| 2026-08-10 | Durable first-use drafts | Adding the first Form creates a stable draft definition and reference while leaving the published snapshot untouched | Navigation and configuration survive reload without making incomplete work public. |
| 2026-08-10 | One persistent site-status center | Use a non-obstructive status pill/popover backed by the same reconciled issue registry as publication preflight | Users see unresolved setup work continuously and cannot receive contradictory readiness results. |
| 2026-08-10 | Reference-aware module cleanup | Delete only unused drafts after confirmation; archive definitions with submissions, published references, or history | Removing a canvas block must never silently destroy business data. |
| 2026-08-10 | Progressive Claude project memory | Keep `CLAUDE.md` short and use `execute-plan-task` plus `project-runbook` skills to load only task-relevant instructions | The execution plan is large; repeated full reads waste context and increase drift risk. |
| 2026-08-10 | Project-scoped Graphify with measured rollout | Install the skill before coding, build the first graph only after Phase 1, use soft query-first behavior, and decide generated-file commits after measuring them | An empty or stale graph cannot save useful context, and strict blocking can obstruct necessary exact-source verification. |
| 2026-08-10 | Ponytail as a reviewed guardrail | Install the plugin but subordinate its simplicity rules to required validation, security, accessibility, tenancy, and tests | Smaller code is useful only when the implementation remains safe and meets the plan. |
| 2026-08-10 | Five reusable bounded subagents | Add navigator, frontend, backend, verifier, and security/tenant roles with least privilege and compact handoffs | These are recurring high-volume boundaries; more generic agents would add routing ambiguity and duplicated context. |
| 2026-08-10 | Canonical repository and two long-lived branches | Use `Gabrielleobeltrao/WebsiteBuilder` as `origin`, integrate on `development`, and promote reviewed green code to production `main` | Keeps active work separate from the deployable baseline without preventing short-lived isolated task branches. |
| 2026-08-10 | Portuguese Claude communication and English technical artifacts | Claude communicates with the user in `pt-BR`; code, Git metadata, documentation, logs, and internal contracts remain in English | Gives the user consistent communication while keeping the repository conventional and maintainable. |
| 2026-08-10 | Bilingual platform with user-level locale | Implement `pt-BR` and `en-US` through namespaced locale files and persist the authenticated preference outside workspace data | The chosen interface language should follow the person across clients and workspaces. |
| 2026-08-10 | Authored content is not auto-translated | Keep SaaS UI localization separate from customer website/blog/form/CMS content | Multilingual published content requires its own URL, SEO, fallback, and editorial model and must not be implied by a UI toggle. |
| 2026-08-10 | P0-T1 | Start from an empty working tree with only `CLAUDE.md`, `IMPLEMENTATION_PLAN.md` and a preinstalled Graphify skill | Nothing existed to preserve, so the target structure in Section 4 was created directly and no user file was overwritten. |
| 2026-08-10 | P0-T4 | Recorded tool versions: Ponytail plugin 4.9.0 from `DietrichGebert/ponytail`, Graphify CLI 0.9.38 installed as a `uv` tool (uv 0.12.3) | Both were already installed and enabled. Hooks were reviewed before use. |
| 2026-08-10 | P0-T4 | Removed the Graphify `hook-guard` PreToolUse hook from `.claude/settings.json` | The task forbids strict blocking mode: intercepting every Bash/Grep/Read/Glob obstructed exact-source verification, which the plan requires before any edit. |
| 2026-08-10 | P0-T5 | GitHub default-branch and branch-protection configuration deferred as a blocker | `gh` is installed but unauthenticated. Git push works through the cached credential helper, so branches exist remotely; repository settings need the owner's GitHub session. |
| 2026-08-10 | P1-T1 | `packages/shared` is consumed as TypeScript source rather than a build artefact | Every consumer is a bundler (Vite, tsup, Vitest), so a `dist` step plus build ordering and a watch process would be machinery with no benefit. |
| 2026-08-10 | P1-T1 | Backend production build uses `tsup` (esbuild) instead of `tsc` emit | It bundles the shared workspace source, which removes monorepo module-resolution problems from the deployed artefact. |
| 2026-08-10 | P1-T4 | Added a `none` variant to `SafeLink` | Section 7 requires an unconfigured-link state for buttons. A discriminated variant keeps every consumer exhaustive, where an optional field would let an unhandled `undefined` reach the renderer. |
| 2026-08-10 | P1-T4 | Added `slug` to `BuilderProject` and `tag`/`decorative` to elements beyond Section 5 | The project slug is required by Section 8 for the platform hostname, and heading level and decorative images are required by the accessibility rules in Section 7. |
| 2026-08-10 | P1-T5 | `/app/*` currently redirects to `/login` with a validated `returnTo` | The authenticated shell arrives in Phase 7. Declaring the route outside the public layout now proves the shells can never be mounted together. |
| 2026-08-10 | P1-T6 | `fallbackLng` disabled | A missing key must fail the parity test, not silently render English inside a Portuguese screen. |
| 2026-08-10 | P1-T6 | Roadmap item IDs are a literal union, not `string` | Adding an item without translating it becomes a compile error rather than a missing string on a live page. |
| 2026-08-10 | P1-T7 | `graphify-out/` is git-ignored in full | `graph.json` is 432 KB and `graph.html` 384 KB, both rewritten by every structural change. The plan itself notes a stale committed graph is worse than a targeted source search. |
| 2026-08-10 | P1-T7 | Graphify runs with `--code-only`; community names stay as placeholders | No LLM API key is configured. AST extraction is complete and queries resolve to correct source paths, which is what the task needs; naming can be regenerated later with a key. |
| 2026-08-10 | P1-T7 | `/run-skill-generator` is not available in this Claude Code build; the run recipe was written into `project-runbook/references/commands.md` instead | The bundled generator does not exist to invoke. The reviewed recipe still exists, is source-linked and is what `/run` discovers. |
| 2026-08-10 | P2-T1 | Backend integration tests run against `mongodb-memory-server` | No MongoDB or Docker exists on this machine, and the plan requires tests that never depend on a developer's personal database. Each test file gets its own ephemeral server. |
| 2026-08-10 | P2-T2 | Project slug uniqueness is global, not per workspace | The slug becomes `${slug}.${PLATFORM_ROOT_DOMAIN}`, so two workspaces claiming one slug would claim one hostname. Collisions get a numeric suffix instead of failing the user's first action. |
| 2026-08-10 | P2-T3 | A malformed project ID answers `404`, not `400` | Distinguishing "badly shaped" from "does not exist" tells an ID prober which shapes are real. |
| 2026-08-10 | P2-T3 | The document endpoint refuses a changed project slug | The slug is public routing identity; changing it needs its own authorised operation with redirect and impact handling (Phase 18), not a side effect of an autosave. |
| 2026-08-10 | P2-T4 | The authenticated area opens only when `VITE_DEV_WORKSPACE` names the seeded workspace | Before Phase 7 there is no session. An explicit developer opt-in keeps the app from ever pretending someone is signed in, and the backend refuses to serve business routes with the seeded resolver in production. |
| 2026-08-10 | P9-T1 | `BreakpointOverride` carries `layout` and `geometry` as named parts instead of `Partial<ResponsiveElementLayout & Geometry>` | The intersection in Section 5 cannot be satisfied: both sides declare `width` and `height`, so it demands a value that is simultaneously a structured length and a number. Naming the parts keeps the same expressive power with a type that can hold a value. |
| 2026-08-10 | P9-T1 | `ResolvedLayout` keeps layout and geometry separate rather than merging them | Flattening let the numeric geometry width overwrite the structured responsive width, silently destroying the value. Caught by a test before any consumer depended on it. |
| 2026-08-10 | P10-T1 | Uploads arrive as a raw body with the filename in a header, not multipart | One file is sent at a time and the frontend controls both ends, so skipping multipart removes a parser and temporary-file handling from a path that accepts untrusted bytes. The declared content type still decides nothing: the pipeline sniffs the actual bytes. |
| 2026-08-10 | P12-T3 | History transactions push their undo step on the first real change rather than when the interaction opens | Pushing on open meant focusing a field and tabbing away created an empty undo step. Opening now records a baseline and pushes it only when something actually changes, so abandoning an interaction leaves history untouched. |

## 15. Progress Log

Append one concise line after each completed task.

| Date | Task | Result | Verification |
|---|---|---|---|
| 2026-08-10 | P0-T1 | Repository inspected; empty tree confirmed, nothing overwritten | `git status --short`, directory listing |
| 2026-08-10 | P0-T2 | Short root `CLAUDE.md`, `execute-plan-task` skill with read-only extraction script, `project-runbook` with three references and a drift check | 6 fixture tests pass; packet for P3-T2 is 499 B vs 222 KB plan (445x smaller) |
| 2026-08-10 | P0-T3 | Five least-privilege subagents with distinct routing descriptions and compact handoff contracts | Definitions discovered by Claude Code; no duplicate names |
| 2026-08-10 | P0-T4 | Ponytail 4.9.0 and Graphify 0.9.38 verified and recorded; `.graphifyignore` added; blocking hook removed | `graphify --version`, hook review, clean diff |
| 2026-08-10 | P0-T5 | Partially complete: `origin`, `main` and `development` reconciled and pushed. Blocked on GitHub settings | `git remote -v`, `git ls-remote --heads origin`, `git branch -vv` |
| 2026-08-10 | P1-T1 | npm workspaces with dev/build/typecheck/test/test:e2e; one root lockfile | `npm run dev` starts API, renderer and frontend; all three answer health checks |
| 2026-08-10 | P1-T2 | React 19 + Vite + Tailwind 4 + react-router, strict TypeScript, accessible shell, test harness | typecheck, 50 tests, production build pass |
| 2026-08-10 | P1-T3 | Express 5 app separated from server, Zod env, redacting logger, error envelope, health, graceful shutdown, renderer entrypoint | 16 backend tests over the real middleware stack; no port bound |
| 2026-08-10 | P1-T4 | Shared contracts: IDs, slug/hostname normalisation, safe links, structured responsive values, document schemas, SEO resolver, API envelopes | 63 tests including dangerous-URL and CSS-injection rejection |
| 2026-08-10 | P1-T5 | `PublicShell` with accessible drawer, landing page in the required order, data-driven roadmap with four honest statuses | Component tests, keyboard tests, 14 E2E across desktop and phone, no overflow at 320px |
| 2026-08-10 | P1-T6 | i18next with typed `pt-BR`/`en-US` namespaces, deterministic locale precedence, `document.lang`, key parity and hardcoded-copy checks | Parity, precedence and both-locale render tests pass; language survives reload in E2E |
| 2026-08-10 | P1-T7 | First code graph: 503 nodes, 741 edges, 26 communities; run/verify recipe documented | Queries resolve to correct source paths; generated output git-ignored after size measurement |
| 2026-08-10 | P2-T1 | Shared Mongo client, workspace-first indexes, unique project slug index, health probe and graceful close | Startup fails clearly on invalid configuration; health reports up/down/not_configured |
| 2026-08-10 | P2-T2 | Project repository with ObjectId/API id mapping, workspace-scoped listing, create, rename, revision-checked save and delete | 15 tests: cross-tenant read/write/delete all blocked, stale save rejected, concurrent saves leave exactly one winner |
| 2026-08-10 | P2-T3 | Project REST API with Zod validation, success/error envelopes and documented status codes | 17 Supertest cases including 409 conflict, dangerous-link rejection and workspace scoping |
| 2026-08-10 | P2-T4 | Typed same-origin fetch client and preliminary site list with create, rename, delete, confirmation dialog and loading/empty/error states | 9 component tests in both locales; request cancellation on workspace change asserted |
| 2026-08-10 | P3-T1 | Zustand document/UI/history/persistence slices with 100-entry snapshot history and transaction boundaries | 8 history tests: transactions collapse, empty transactions leave no step, UI state never enters history |
| 2026-08-10 | P3-T2 | Revision-aware manual save, 1.5s debounced autosave, retry, conflict dialog, navigation guard and persistent save indicator | 14 store tests with fake timers: debounce restarts, manual save cancels autosave, failed save stays dirty, conflict stops retrying |
| 2026-08-10 | P3-T3 | Page create, rename, slug, duplicate, delete, reorder and homepage with invariants enforced | 17 tests: last page cannot be deleted, exactly one homepage always, duplicate regenerates every nested id |
| 2026-08-10 | P3-T4 | Editor shell: top bar, centred canvas workspace, fixed-width right panel, no second left sidebar | 14 component tests including layout, loading, error and both locales |
| 2026-08-10 | P3-T5 | Right-panel mode machine, inspector shell with the five capability groups, overlay manager and desktop authoring gate | Panel machine unit tests plus shell tests for mode return, inspector replacement and the touch/narrow gate |
| 2026-08-10 | P4-T1 | Single screen/logical coordinate module with zoom clamping, fit, rounding and canvas bounds | 12 tests: identical logical geometry for the same gesture at six zoom levels; no off-canvas placement |
| 2026-08-10 | P4-T2 | Shared pure renderer for text, image, button and container plus one model-to-CSS module | 16 tests: markup in content renders as text, dangerous and deleted links yield a disabled button, hidden content excluded |
| 2026-08-10 | P4-T3 | Add, select, delete, duplicate, lock and hide with unique ids and Layers-based recovery | 17 tests: unique nested ids on duplicate, locked elements refuse to move, defaults never full width |
| 2026-08-10 | P4-T4 | Moveable drag and resize with exactly eight handles and one history entry per interaction | Transactions asserted in history tests; geometry commit routed through the constrained coordinate module |
| 2026-08-10 | P4-T5 | Bring forward, send backward, front, back with contiguous z-index normalisation and page height growth | 17 element tests including boundary no-ops and deterministic order after reload |
| 2026-08-10 | P5-T0 | Shared inspector primitives with transaction-grouped continuous controls and component-owned disclosure state | 15 inspector tests: one undo step per editing burst, collapsing a group never touches the document |
| 2026-08-10 | P5-T1 | Text inspector: content, semantic tag, bundled font list, size with allowlisted units, weight, alignment, colour, line height | Structured font size asserted after a unit change; tag change reflected in the rendered heading level |
| 2026-08-10 | P5-T2 | Image inspector: source kind, URL, decorative state, alt, fit, radius | Alt field disappears for a decorative image; empty URL renders a placeholder instead of refetching the page |
| 2026-08-10 | P5-T3 | Button inspector with the typed link editor for internal, external, email, phone and WhatsApp | Unsafe URL warns instead of storing silently; a deleted internal target shows a repairable state |
| 2026-08-10 | P5-T4 | Keyboard shortcuts with the editable-target guard | 8 tests: backspacing in a field never deletes the element, undo and duplicate do not hijack typing, save still works from a field |
| 2026-08-10 | P6-T1 | `/preview/:projectId/*` resolves the homepage, trailing slugs and a project-scoped not-found view | 10 preview tests including an unknown slug and a localized load failure |
| 2026-08-10 | P6-T2 | Preview mounts the shared renderer only: no editor chrome, hidden content excluded, internal links stay inside the preview | Asserted absence of canvas, panel and Save; every preview request is a GET |
| 2026-08-10 | P6-T3 | Preview Desktop and Preview Mobile in the builder top bar and inside preview, using one renderer and one document | Both viewports render the same document; the active one is announced through aria-pressed |
| 2026-08-10 | P7-T1 | Better Auth email/password with the MongoDB adapter, Organization plugin, secure cookies and trusted origins | Auth mounted before the JSON parser so it receives the raw body; 12-character minimum enforced; production refuses to start without a 32-byte secret |
| 2026-08-10 | P7-T2 | Idempotent personal workspace bootstrap with owner membership and authorized listing | A repeated bootstrap creates no second workspace; listing returns only workspaces the user belongs to |
| 2026-08-10 | P7-T3 | Server-side authorization: session, then membership read from the database, then the role matrix | 14 adversarial tests: cross-tenant read/write/delete blocked, role applied per workspace, revoked membership immediate, forged workspace id in body ignored |
| 2026-08-10 | P7-T4 | Real login and signup, `AuthenticatedAppShell` as a sibling layout, workspace switcher, sign out, safe return path | Failed sign-in shows one localized message and never the provider text, so an attempt cannot enumerate accounts |
| 2026-08-10 | P7-T5 | `GET/PUT /me/preferences` keyed by the session user, `Settings -> Language`, and account-first locale precedence | A saved account preference wins; only an account with none is seeded; a failed save keeps the local change and says so |
| 2026-08-10 | P8-T1 | Section create, rename, duplicate, reorder, hide, delete and background, with layout mode owned per section | 18 tests: mode stays scoped to its own section, the last section cannot be deleted, duplication regenerates every nested id |
| 2026-08-10 | P8-T2 | Free sections keep manual geometry for every element type, with no forced full-width sizing | Element defaults and constrained geometry asserted; a button stays 180x48 |
| 2026-08-10 | P8-T6 | Copy, cut and paste through an in-app clipboard with recursive id regeneration and offset placement | 12 shortcut tests including pasting without system clipboard permission and the typing guard |
| 2026-08-10 | P8-T3 | Grid sections: columns, auto-fit with minmax, gaps, padding and alignment as typed fields serialised by the shared layout module | 13 shared tests: auto-fit guards against overflow in a narrow container, out-of-range and CSS-string input rejected |
| 2026-08-10 | P8-T4 | Flex sections: direction, wrap, gap, padding, distribution and alignment, with children given minWidth 0 so they can shrink | Wrapping defaults on so a row cannot force horizontal overflow; start/end mapped to flex-start/flex-end |
| 2026-08-10 | P8-T5 | Container nesting depth limit and warned, undoable, deterministic section conversion | Conversion warns with the affected element count, keeps every element, and preserves geometry through a round trip |
| 2026-08-10 | P9-T1 | One shared resolver for breakpoint inheritance, with base/inherited/override origin reporting | 24 tests: narrowest rule wins, unset keys inherit rather than reset, result independent of stored array order, inputs never mutated |
| 2026-08-10 | P9-T2 | Typed responsive values serialised through one allowlisted path, with structured grid/flex layouts | Arbitrary CSS strings and out-of-range values rejected at the schema; serialisation emits only validated units |
| 2026-08-10 | P9-T3 | Free-layout constraints resolved at arbitrary widths without mutating stored geometry | Left, right, centre, stretch and scale asserted across the sweep; aspect ratio honoured; stored geometry unchanged at every width |
| 2026-08-10 | P9-T9 | Desktop authoring gate and preview-only shell for touch-first and narrow viewports | Gate combines viewport width with pointer precision, mounts no canvas, inspector or autosave, and preserves the unsaved document when a window narrows |
| 2026-08-10 | P9-T1b | Continuous canvas width control with presets, slider and numeric entry driving the shared resolver | 9 tests: intermediate widths reachable, range clamped, width changes never touch the document, overrides apply only where their breakpoint covers |
| 2026-08-10 | P10-T1 | Secure upload pipeline: byte sniffing, autorotation before metadata stripping, responsive WebP variants, atomic storage and workspace-scoped streaming | 37 tests: SVG and corrupt files rejected, orientation applied, transparency kept, no upscaling, partial-failure cleanup leaves nothing behind, cross-tenant read/stream/delete blocked |
| 2026-08-10 | P10-T2 | Reusable media library with upload, search, select, delete, responsive thumbnails and full state coverage | 12 tests: thumbnails request the smallest variant and offer srcset, explicit dimensions prevent layout shift, rejected and oversized uploads explained distinctly, deletion confirmed before any request |
| 2026-08-10 | P10-T3 | Shared header and footer as references resolved at render time by both the canvas and preview | 13 tests: one shared record across pages, an edit reaches every page, a page can hide it locally, a dangling reference resolves to nothing, deletion cleans up every reference |
| 2026-08-10 | P11-T3 | Blog settings per project with disabled default, validated base path and non-destructive deactivation | Disabling hides public routes while every post survives; settings never leak across workspaces |
| 2026-08-10 | P11-T4 | Blog post repository and API with allowlisted Tiptap validation, unique per-project slugs and published-only public reads | 56 tests: raw HTML and unknown node types rejected, drafts never resolve publicly, ownership fields stripped from public responses, cross-tenant and cross-project access blocked |
| 2026-08-10 | P11-T5 | Blog post dashboard with explicit activation, status filters, search, publish/unpublish, confirmed delete and full state coverage | 11 tests: visiting the route never enables the blog, filters and search go through the API rather than the browser, deletion issues no request before confirmation |
| 2026-08-10 | P11-T6 | Post editor as a generated form with Tiptap content and one control per stable field definition | 11 tests: slug follows the title until the author edits it and then stops, values stored by field id survive a label rename, two distinct definitions produce two independent inputs |
| 2026-08-10 | P11-T11a | Typed `SiteFeatureState` lifecycle reconciler derived only from saved records and stamped with its source revision | 20 tests: a caller cannot assert a lifecycle, an incomplete used module stays visible, an unused one never blocks publication, archived data stays reachable, staleness detectable |
| 2026-08-10 | P11-T1 | Site dashboard with always-present core navigation, usage-driven optional module entries and a persistent status panel | 9 tests: an untouched site shows no optional module, a module appears only when the server says it is in use, archived stays hidden, setup badges surface blockers |
| 2026-08-10 | P11-T11 | `SiteFeatureState` lifecycle, server-side reconciler and `GET /projects/:projectId/status` consumed by navigation | 30 tests: lifecycle derived not asserted, stale stored projections recomputed, unused modules never block publication, archived data stays reachable |
| 2026-08-10 | P11-T2 | Navigation menu contract and renderer: id-based internal destinations, one submenu level, configurable collapse width and accessible drawer | 21 tests: a slug change does not break the menu, a broken entry stays visible as plain text, dangerous destinations never produce an href, current page announced, disclosure carries aria-expanded and aria-controls |
| 2026-08-10 | P11-T9 | Blog template draft/published lifecycle with a field-compatibility impact report that blocks only unsafe publications | 14 tests: editing a draft leaves the live document byte-identical, a newly required field blocks and names the exact posts, an optional field never blocks, a refused publication reaches nothing live |
| 2026-08-10 | P11-T7a | Dynamic binding resolver shared by the article template builder, preview and public rendering | 14 tests: a removed field reports missing rather than rendering blank, a label rename keeps resolving, duplication either reuses a binding or forks a new field, two slots on one field ask the author once |
| 2026-08-10 | P11-T10 | Public post rendering through the published template, with rich text walked into React elements rather than injected as HTML | 12 tests: markup inside text renders as literal characters, an unknown node emits its children not itself, a removed binding is flagged, empty values leave no gap, one article landmark |
| 2026-08-10 | P11-T7 | Dynamic field elements carrying a typed binding and an allowlisted display mode, with duplication offering reuse or a new field | 29 tests across bindings and elements: a template cannot request raw HTML, an unknown binding source is rejected, static decoration stays unbound |
| 2026-08-10 | P11-T8 | Post collection element with a structured query, bounded limit and card field list, plus the shared query resolver | 15 tests: an arbitrary sort expression is rejected, the limit is capped, publishing a matching post makes it appear without editing the layout |
| 2026-08-10 | P12-T1 | One SEO resolver for override, site default and safe fallback, shared by preview, renderer, sitemap and exporter | 21 tests: a page cannot opt into indexing the site turned off, a canonical URL is emitted only when a real base is configured, title template tolerates missing placeholders |
| 2026-08-10 | P12-T5 | Deterministic SEO checklist with severities, reporting facts about the document and never predicting ranking | Missing description is an error only when nothing inherits into it; duplicate titles are reported against every route that shares one; noindex is information, not failure |
| 2026-08-10 | P12-T6 | Sitemap and robots generation excluding noindex and uncanonicalised routes, with XML escaping at serialisation | Listing a noindex route would contradict its own directive, so it is excluded; ampersands in URLs are escaped |
| 2026-08-10 | P12-T3 | Page SEO as a right-panel mode with a search preview rendered by the shared resolver | 9 tests: the preview applies the site title template and canonical base, falls back to the site description, is labelled advisory, and index/follow toggle independently |
| 2026-08-10 | P12-T2 | Site-wide SEO defaults with validation, explanations and no ranking promise | 9 tests: an invalid canonical URL is refused before sending, robots directives toggle independently, and changing a default provably leaves a page override intact |
| 2026-08-10 | P12-T4 | Dynamic post metadata and Article JSON-LD derived from the post, with drafts kept out of the index and out of structured data | 13 tests: two posts on one template produce distinct titles and canonicals, a draft is noindex whatever the site default says, JSON-LD escapes characters that could close a script element |
| 2026-08-10 | P13-T2 | Client accounts with person/company types, lead-to-archived lifecycle, filtered listing and archive-only removal | 11 tests: cross-workspace read, update and archive blocked; search cannot act as a pattern; archiving destroys neither the client nor the sites it owns |
| 2026-08-10 | P13-T3 | Sites optionally owned by a client, listed per client or across the workspace, using the same builder and APIs | Client-filtered and workspace-wide listings asserted together, including a direct site with no client |
| 2026-08-10 | P13-T1 | Workspace dashboard aggregates computed in the database, never by loading builder documents | 10 tests: page totals summed with $size, media storage summed across variants, switching workspace changes every number, nothing counted from another tenant |
| 2026-08-10 | P13-T7 | Analytics reported as an explicit not-connected state rather than a zero | Asserted that the payload carries no visit field at all, so a fabricated zero cannot be mistaken for measured traffic |
| 2026-08-10 | P13-T4 | Campaign summaries with client and site scoping, date validation and an active/upcoming view | 10 tests: a campaign cannot end before it starts, a performance field is rejected outright, filters and the dashboard view never cross workspaces |
| 2026-08-10 | P13-T5 | Workspace members, roles and invitations with last-owner protection and no privilege escalation | 16 tests: the only owner cannot be demoted or removed, an admin cannot promote to owner or invite one, an expired or revoked invitation cannot be accepted, acceptance is once only |
| 2026-08-10 | P13-T8 | Consolidated tenant-isolation audit across every repository, aggregate and media stream | 10 cross-module tests with a second workspace holding real data: no listing, id lookup, byte stream, write or aggregate returns anything from it; guessed and malformed ids answer not-found rather than revealing shape |
| 2026-08-10 | P13-T6 | Self-service onboarding with a plan-entitlement boundary and no agency assumptions baked into navigation | 12 tests: a personal workspace hides Clients until one exists, a solo user reaches site creation without a client, storage is checked against the incoming size not only the current total |
| 2026-08-10 | P14-T1a | Form contracts: typed fields, setup checklist, submission validation keyed by field id, and CSV formula neutralisation | 22 tests: undeclared payload properties are ignored so a form is not a write endpoint, control characters are stripped, every formula-leading character is neutralised on export |
| 2026-08-10 | P14-T1 | Form definitions with server-derived status, reference-aware removal and restore | 39 tests: status is recomputed rather than trusted, a definition with submissions is archived not deleted, cross-workspace read and write blocked |
| 2026-08-10 | P14-T2 | Hardened public submission: declared fields only, duplicate suppression, archived forms closed, uniform responses | An unknown and a malformed form id answer identically, so the endpoint reveals nothing about what exists; a suppressed duplicate still reports success so the visitor does not resubmit |
| 2026-08-10 | P14-T3 | Submission lifecycle with new/read/archived/spam, pagination and workspace-scoped retention | Retention deletes only within its own workspace, asserted with a second tenant holding an equally old submission |
| YYYY-MM-DD | Example | Workspace created | `npm run typecheck && npm run build` |