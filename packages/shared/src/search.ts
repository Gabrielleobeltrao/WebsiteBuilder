/**
 * Internal site search.
 *
 * Indexing decides what a stranger can find, so the rule that matters is what is *excluded*: a
 * draft, an unpublished item, a noindex route or a disabled module must never appear. That check
 * happens when the index is built, not when results are rendered — a filter applied at display
 * time is one refactor away from being skipped.
 *
 * This is bounded text search, not semantic search. Calling it anything else would promise
 * behaviour the implementation does not have.
 */
export type SearchableKind = "page" | "post" | "cmsItem";

export type SearchSource = {
  kind: SearchableKind;
  id: string;
  title: string;
  /** Plain text only. Rich text is flattened before it reaches here. */
  body: string;
  path: string;
  /** Excluded from the index when false. */
  indexable: boolean;
  published: boolean;
};

export type SearchDocument = {
  kind: SearchableKind;
  id: string;
  title: string;
  excerpt: string;
  path: string;
  /** Lowercased, accent-folded haystack. Never returned to a visitor. */
  haystack: string;
};

export const MAX_QUERY_LENGTH = 120;
export const MIN_QUERY_LENGTH = 2;
const EXCERPT_LENGTH = 160;

export function foldForSearch(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Builds the index. Everything not publicly visible is dropped here, so a result set can only ever
 * contain content a stranger could already reach by browsing.
 */
export function buildSearchIndex(sources: readonly SearchSource[]): SearchDocument[] {
  return sources
    .filter((source) => source.published && source.indexable)
    .map((source) => ({
      kind: source.kind,
      id: source.id,
      title: source.title,
      excerpt: buildExcerpt(source.body),
      path: source.path,
      haystack: foldForSearch(`${source.title} ${source.body}`),
    }));
}

function buildExcerpt(body: string): string {
  const collapsed = body.replace(/\s+/g, " ").trim();
  return collapsed.length <= EXCERPT_LENGTH ? collapsed : `${collapsed.slice(0, EXCERPT_LENGTH).trimEnd()}…`;
}

export type SearchResult = { kind: SearchableKind; id: string; title: string; excerpt: string; path: string };
export type SearchResponse = { query: string; results: SearchResult[]; total: number; page: number; perPage: number };

/**
 * Runs a query.
 *
 * A too-short query returns nothing rather than everything: matching on one character would return
 * the whole site and read as a broken search. Results are ranked by a title match first, then by
 * how many terms matched, which is stable and explainable — not a relevance score the product
 * cannot justify.
 */
export function search(
  index: readonly SearchDocument[],
  rawQuery: string,
  options: { page?: number; perPage?: number } = {},
): SearchResponse {
  const query = rawQuery.trim().slice(0, MAX_QUERY_LENGTH);
  const page = Math.max(1, options.page ?? 1);
  const perPage = Math.min(50, Math.max(1, options.perPage ?? 10));

  if (query.length < MIN_QUERY_LENGTH) {
    return { query, results: [], total: 0, page, perPage };
  }

  const terms = foldForSearch(query).split(/\s+/).filter((term) => term.length > 0);

  const scored = index
    .map((document) => {
      const foldedTitle = foldForSearch(document.title);
      const matched = terms.filter((term) => document.haystack.includes(term));
      if (matched.length === 0) return null;

      const titleHits = terms.filter((term) => foldedTitle.includes(term)).length;
      return { document, score: titleHits * 10 + matched.length, allTerms: matched.length === terms.length };
    })
    .filter((entry): entry is { document: SearchDocument; score: number; allTerms: boolean } => entry !== null)
    // Documents matching every term rank above partial matches, then by score, then stably by title.
    .sort(
      (a, b) =>
        Number(b.allTerms) - Number(a.allTerms) ||
        b.score - a.score ||
        a.document.title.localeCompare(b.document.title),
    );

  const start = (page - 1) * perPage;
  return {
    query,
    results: scored.slice(start, start + perPage).map((entry) => ({
      kind: entry.document.kind,
      id: entry.document.id,
      title: entry.document.title,
      excerpt: entry.document.excerpt,
      path: entry.document.path,
    })),
    total: scored.length,
    page,
    perPage,
  };
}
