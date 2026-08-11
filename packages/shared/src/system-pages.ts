import { z } from "zod";

/**
 * System pages.
 *
 * These are the states a site must be able to reach whatever the visitor did: nothing found,
 * nothing matched, the form went through, we are working on it. They are ordinary builder pages so
 * they can be branded, but each carries a contract the builder must not let anyone break — a 404
 * that answers 200 is invisible to search engines and to monitoring alike.
 */
export const SYSTEM_PAGE_KINDS = [
  "notFound",
  "searchResults",
  "thankYou",
  "maintenance",
  "emptyResults",
] as const;

export type SystemPageKind = (typeof SYSTEM_PAGE_KINDS)[number];

export type SystemPageContract = {
  /** The status the response must carry, whatever the page contains. */
  statusCode: 200 | 404 | 503;
  /** Fixed path, or null when the page is rendered in place of other content. */
  path: string | null;
  indexable: boolean;
  /** Bindings the page may use that no ordinary page can. */
  bindings: readonly string[];
};

export const SYSTEM_PAGE_CONTRACTS: Record<SystemPageKind, SystemPageContract> = {
  notFound: { statusCode: 404, path: "/404", indexable: false, bindings: ["requestedPath"] },
  // A search results page is a real page that answers 200; it is the *results* that may be empty.
  searchResults: { statusCode: 200, path: "/search", indexable: false, bindings: ["query", "resultCount"] },
  thankYou: { statusCode: 200, path: "/thank-you", indexable: false, bindings: ["formName"] },
  maintenance: { statusCode: 503, path: null, indexable: false, bindings: [] },
  emptyResults: { statusCode: 200, path: null, indexable: false, bindings: ["query"] },
};

export const systemPageSchema = z
  .object({
    kind: z.enum(SYSTEM_PAGE_KINDS),
    /** Ordinary builder sections, so these pages are designed like any other. */
    sections: z.array(z.unknown()),
    seo: z.object({ title: z.string().max(200), description: z.string().max(400) }).strict(),
    updatedAt: z.string(),
  })
  .strict();

export type SystemPage = z.infer<typeof systemPageSchema>;

export type SystemPageIssue =
  | { code: "route-conflict"; kind: SystemPageKind; path: string }
  | { code: "unknown-binding"; kind: SystemPageKind; binding: string }
  | { code: "indexable-system-page"; kind: SystemPageKind };

/**
 * Checks what a builder must not allow.
 *
 * A system page cannot be deleted — it is absent from this check because there is no operation that
 * removes one — but it can be given a path an ordinary page already claims, or a binding it has no
 * value for. Both produce a page that looks right in the editor and is wrong in production.
 */
export function validateSystemPages(input: {
  pages: ReadonlyArray<{ kind: SystemPageKind; usedBindings?: readonly string[]; indexable?: boolean }>;
  ordinaryPaths: ReadonlySet<string>;
}): SystemPageIssue[] {
  const issues: SystemPageIssue[] = [];

  for (const page of input.pages) {
    const contract = SYSTEM_PAGE_CONTRACTS[page.kind];

    if (contract.path !== null && input.ordinaryPaths.has(contract.path)) {
      issues.push({ code: "route-conflict", kind: page.kind, path: contract.path });
    }

    for (const binding of page.usedBindings ?? []) {
      if (!contract.bindings.includes(binding)) {
        issues.push({ code: "unknown-binding", kind: page.kind, binding });
      }
    }

    // Letting a "no results" or "thank you" page into an index fills search results with pages that
    // say nothing about the site.
    if (page.indexable === true && !contract.indexable) {
      issues.push({ code: "indexable-system-page", kind: page.kind });
    }
  }

  return issues;
}

/** The safe default for one system page, used to create it and to reset it. */
export function createDefaultSystemPage(kind: SystemPageKind, copy: { title: string; description: string }): SystemPage {
  return {
    kind,
    sections: [],
    seo: { title: copy.title, description: copy.description },
    updatedAt: "",
  };
}

/**
 * Resolves a system binding against the request that produced the page.
 *
 * Returns an empty string for a binding the page's kind does not own, so a template copied between
 * kinds degrades to blank rather than leaking a value from the wrong context.
 */
export function resolveSystemBinding(
  kind: SystemPageKind,
  binding: string,
  context: { requestedPath?: string; query?: string; resultCount?: number; formName?: string },
): string {
  if (!SYSTEM_PAGE_CONTRACTS[kind].bindings.includes(binding)) return "";

  switch (binding) {
    case "requestedPath":
      return context.requestedPath ?? "";
    case "query":
      return context.query ?? "";
    case "resultCount":
      return String(context.resultCount ?? 0);
    case "formName":
      return context.formName ?? "";
    default:
      return "";
  }
}
