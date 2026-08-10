import { z } from "zod";

/**
 * URL redirects.
 *
 * Changing a slug breaks every link anyone ever shared. A 301 from the old path is what keeps those
 * links working, so slug history is created automatically rather than relying on someone
 * remembering to add a rule.
 *
 * The validation here exists because a bad redirect is worse than none: a loop makes a page
 * unreachable, and an unvalidated destination turns the site's own routing into an open redirect.
 */
export const REDIRECT_DESTINATION_TYPES = ["internalPage", "internalPost", "internalCmsItem", "internalPath"] as const;

export const redirectInputSchema = z
  .object({
    sourcePath: z.string().min(1).max(1000),
    destination: z.discriminatedUnion("type", [
      z.object({ type: z.literal("internalPage"), targetId: z.string().min(1) }).strict(),
      z.object({ type: z.literal("internalPost"), targetId: z.string().min(1) }).strict(),
      z.object({ type: z.literal("internalCmsItem"), targetId: z.string().min(1) }).strict(),
      z.object({ type: z.literal("internalPath"), path: z.string().min(1).max(1000) }).strict(),
    ]),
    automatic: z.boolean(),
  })
  .strict();

export type RedirectInput = z.infer<typeof redirectInputSchema>;

export type Redirect = RedirectInput & { id: string; statusCode: 301 };

/** Paths the product owns. A redirect claiming one would shadow real functionality. */
export const RESERVED_PATHS = ["/", "/sitemap.xml", "/robots.txt", "/api", "/app", "/preview"] as const;

export const MAX_REDIRECT_HOPS = 5;

/**
 * Normalises a path for comparison and storage: leading slash, no trailing slash, lowercase, no
 * query or fragment. Two paths that differ only in those ways are the same route, and treating
 * them as different is how duplicate rules with contradictory destinations appear.
 */
export function normalizeRedirectPath(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed.length === 0 || trimmed.length > 1000) return null;
  if (/[\u0000-\u001f\u007f\s]/.test(trimmed)) return null;

  // A destination must stay inside this site. Anything that could leave the origin is refused.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) return null;
  if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return null;

  const withoutQuery = trimmed.split(/[?#]/)[0] ?? "";
  const withSlash = withoutQuery.startsWith("/") ? withoutQuery : `/${withoutQuery}`;
  const normalized = withSlash.replace(/\/+$/, "").toLowerCase();
  return normalized === "" ? "/" : normalized;
}

export type RedirectIssue =
  | { code: "invalid-source" }
  | { code: "invalid-destination" }
  | { code: "self-redirect" }
  | { code: "reserved-path" }
  | { code: "duplicate-source" }
  | { code: "loop" }
  | { code: "chain-too-long"; hops: number };

/**
 * Validates one rule against the existing set.
 *
 * `resolveDestinationPath` is injected because a redirect to a page id only becomes a path once
 * the document is known — and a rule pointing at a deleted page must be caught here rather than at
 * request time.
 */
export function validateRedirect(input: {
  candidate: RedirectInput;
  existing: readonly Redirect[];
  resolveDestinationPath: (destination: RedirectInput["destination"]) => string | null;
  reservedPaths?: readonly string[];
}): RedirectIssue[] {
  const issues: RedirectIssue[] = [];

  const source = normalizeRedirectPath(input.candidate.sourcePath);
  if (source === null) return [{ code: "invalid-source" }];

  const rawTarget = input.resolveDestinationPath(input.candidate.destination);
  const target = rawTarget === null ? null : normalizeRedirectPath(rawTarget);
  if (target === null) issues.push({ code: "invalid-destination" });

  const reserved = input.reservedPaths ?? RESERVED_PATHS;
  if (reserved.includes(source)) issues.push({ code: "reserved-path" });

  if (target !== null && source === target) issues.push({ code: "self-redirect" });

  if (input.existing.some((rule) => normalizeRedirectPath(rule.sourcePath) === source)) {
    issues.push({ code: "duplicate-source" });
  }

  if (target !== null && issues.length === 0) {
    // Followed from the source with the candidate in play, so the chain is counted the way a
    // visitor experiences it — the new rule's own hop included.
    const follow = followChain(source, [...input.existing, { ...input.candidate, id: "candidate", statusCode: 301 }], {
      resolveDestinationPath: input.resolveDestinationPath,
    });
    if (follow.kind === "loop") issues.push({ code: "loop" });
    if (follow.kind === "too-long") issues.push({ code: "chain-too-long", hops: follow.hops });
  }

  return issues;
}

type ChainResult =
  | { kind: "resolved"; path: string; hops: number }
  | { kind: "loop" }
  | { kind: "too-long"; hops: number };

/** Follows redirects from a path, refusing to cycle and refusing to hop forever. */
export function followChain(
  from: string,
  rules: readonly Redirect[],
  options: {
    resolveDestinationPath: (destination: RedirectInput["destination"]) => string | null;
    start?: string;
    maxHops?: number;
  },
): ChainResult {
  const maxHops = options.maxHops ?? MAX_REDIRECT_HOPS;
  const seen = new Set<string>([options.start ?? from]);

  let current = from;
  for (let hops = 0; hops <= maxHops; hops += 1) {
    if (seen.has(current) && hops > 0) return { kind: "loop" };
    seen.add(current);

    const rule = rules.find((candidate) => normalizeRedirectPath(candidate.sourcePath) === current);
    if (rule === undefined) return { kind: "resolved", path: current, hops };

    const next = options.resolveDestinationPath(rule.destination);
    const normalized = next === null ? null : normalizeRedirectPath(next);
    if (normalized === null) return { kind: "resolved", path: current, hops };
    current = normalized;
  }

  return { kind: "too-long", hops: maxHops };
}

/**
 * Creates the automatic rule for a changed slug.
 *
 * Returns null when the paths are equivalent, so a cosmetic change does not accumulate a
 * meaningless rule that later shows up as a chain.
 */
export function slugChangeRedirect(input: {
  previousPath: string;
  targetId: string;
  type: "internalPage" | "internalPost" | "internalCmsItem";
  newPath: string;
}): RedirectInput | null {
  const from = normalizeRedirectPath(input.previousPath);
  const to = normalizeRedirectPath(input.newPath);
  if (from === null || to === null || from === to) return null;

  return {
    sourcePath: from,
    destination: { type: input.type, targetId: input.targetId },
    automatic: true,
  };
}

/**
 * Collapses a chain so every rule points straight at its final destination.
 *
 * Chains are legitimate as history accumulates, but serving them costs a round trip per hop and
 * risks exceeding the limit. Flattening keeps every old link working at one hop.
 */
export function flattenChains(
  rules: readonly Redirect[],
  resolveDestinationPath: (destination: RedirectInput["destination"]) => string | null,
): Array<{ id: string; sourcePath: string; finalPath: string }> {
  return rules
    .map((rule) => {
      const source = normalizeRedirectPath(rule.sourcePath);
      const immediate = resolveDestinationPath(rule.destination);
      const start = immediate === null ? null : normalizeRedirectPath(immediate);
      if (source === null || start === null) return null;

      const result = followChain(start, rules, { resolveDestinationPath, start: source });
      return result.kind === "resolved" ? { id: rule.id, sourcePath: source, finalPath: result.path } : null;
    })
    .filter((entry): entry is { id: string; sourcePath: string; finalPath: string } => entry !== null);
}
